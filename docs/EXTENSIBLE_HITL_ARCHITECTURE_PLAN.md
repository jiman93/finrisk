# Extensible HITL Control Architecture - Implementation Plan

## Context

The FinRisk app currently has three hardcoded HITL controls (chunk selector, summary editor, questionnaire) wired through mode-based `if/else` branching in `runTaskFlow()` and `ChatInterface.tsx`. The design framework (SYSTEM_DESIGN_FRAMEWORK.md) already describes a Control Registry pattern and a `ControlBase<TType, TPayload, TResult>` contract, but neither is implemented - controls are still hardcoded in component rendering and store logic.

**What we're building:** A data-driven checkpoint system where:
1. An admin defines checkpoint types + workflow rules in a dashboard
2. Those definitions are stored in the database
3. The pipeline dynamically resolves which checkpoints to inject at runtime
4. The chat UI dynamically renders controls from schema (no deploy needed)
5. Failures at any point are handled with retry, skip, timeout, and circuit-breaker strategies

**Why:** The product advantage is a reusable in-stream control system. Hardcoded controls don't scale. This makes checkpoints a first-class, configurable entity.

---

## Architecture Overview

```
┌─────────────────────┐     ┌──────────────────────┐
│  Admin Dashboard     │────▶│  CheckpointDefinition│
│  (CRUD checkpoint    │     │  (DB table)          │
│   definitions)       │     └──────────┬───────────┘
└─────────────────────┘                │
                                       ▼
┌─────────────────────┐     ┌──────────────────────┐
│  Chat Pipeline       │────▶│  CheckpointResolver  │
│  (runTaskFlow)       │     │  (which checkpoints  │
│                      │◀────│   apply here?)       │
└──────────┬──────────┘     └──────────────────────┘
           │
           ▼
┌─────────────────────┐     ┌──────────────────────┐
│  CheckpointInstance  │────▶│  FailureTracker      │
│  (DB: per-task       │     │  (retry, timeout,    │
│   checkpoint state)  │     │   circuit breaker)   │
└──────────┬──────────┘     └──────────────────────┘
           │
           ▼
┌─────────────────────┐
│  DynamicControl      │
│  Renderer (frontend) │
│  (schema → UI)       │
└─────────────────────┘
```

---

## 1. New Database Models

### 1a. `CheckpointDefinition` model
**File:** `src/backend/app/models/checkpoint_definition.py`

Stores the admin-defined checkpoint type. Each row is a checkpoint "template."

```python
class CheckpointDefinition(Base):
    __tablename__ = "checkpoint_definitions"

    id: str              # UUID PK
    control_type: str    # Unique slug: "chunk_selector", "summary_editor", "risk_ranker", etc.
    label: str           # Display name: "Risk Priority Ranking"
    description: str     # What this checkpoint does (shown in dashboard)

    # Schema for dynamic rendering
    field_schema: dict   # JSON: array of field definitions (see below)

    # Pipeline position
    pipeline_position: str  # Enum: "after_retrieval", "after_generation", "post_generation"
    sort_order: int         # Ordering within same position (0, 10, 20...)

    # Applicability rules
    applicable_modes: list[str]  # JSON: ["hitl_r", "hitl_full"] or ["*"] for all
    required: bool               # Whether workflow blocks without completion

    # Failure configuration
    timeout_seconds: int | None     # Max time before auto-timeout (null = no timeout)
    max_retries: int                # Default 2
    circuit_breaker_threshold: int  # Failures before auto-disable. Default 5
    circuit_breaker_window_minutes: int  # Window for counting failures. Default 60

    # Lifecycle
    enabled: bool           # Admin toggle
    created_at: datetime
    updated_at: datetime
```

**Field schema format** (the `field_schema` JSON column):
```json
[
  {
    "key": "confidence",
    "type": "select",
    "label": "Confidence in this summary",
    "required": true,
    "options": [
      {"value": "1", "label": "1 - Very low"},
      {"value": "2", "label": "2 - Low"},
      {"value": "3", "label": "3 - Medium"},
      {"value": "4", "label": "4 - High"},
      {"value": "5", "label": "5 - Very high"}
    ]
  },
  {
    "key": "notes",
    "type": "textarea",
    "label": "Additional notes",
    "required": false,
    "placeholder": "Anything unclear?"
  }
]
```

Supported field types: `text`, `textarea`, `select`, `multi_select`, `checkbox`, `radio`, `number`, `range`, `chips` (tag selection).

### 1b. `CheckpointInstance` model
**File:** `src/backend/app/models/checkpoint_instance.py`

Tracks per-task execution of each checkpoint. One row per checkpoint-per-task.

```python
class CheckpointInstance(Base):
    __tablename__ = "checkpoint_instances"

    id: str                        # UUID PK
    task_id: str                   # FK → tasks.id
    definition_id: str             # FK → checkpoint_definitions.id
    control_type: str              # Denormalized from definition for fast lookup

    # Lifecycle state
    state: str                     # "pending" | "offered" | "active" | "submitted" | "collapsed" | "skipped" | "failed" | "timed_out"

    # Data
    payload: dict | None           # JSON: context data sent to frontend for rendering
    submit_result: dict | None     # JSON: user's submission data

    # Failure tracking
    attempt_count: int             # Default 0
    last_error: str | None         # Error message from last failure
    failed_at: datetime | None

    # Timestamps
    offered_at: datetime | None
    submitted_at: datetime | None
    created_at: datetime
```

### 1c. Seed existing controls as CheckpointDefinitions

On startup, seed the three built-in controls so they're managed through the same system:

| control_type | pipeline_position | applicable_modes | required |
|---|---|---|---|
| `chunk_selector` | `after_retrieval` | `["hitl_r", "hitl_full"]` | `true` |
| `summary_editor` | `after_generation` | `["hitl_g", "hitl_full"]` | `true` |
| `questionnaire` | `post_generation` | `["hitl_r", "hitl_g", "hitl_full"]` | `false` |

This ensures backward compatibility - existing controls are now just checkpoint definitions in the database.

---

## 2. Backend API Endpoints

### 2a. Admin Dashboard CRUD
**File:** `src/backend/app/routers/checkpoints.py`

```
GET    /api/checkpoints/definitions          → List all definitions
POST   /api/checkpoints/definitions          → Create new definition
GET    /api/checkpoints/definitions/{id}     → Get one definition
PUT    /api/checkpoints/definitions/{id}     → Update definition
DELETE /api/checkpoints/definitions/{id}     → Soft-delete (set enabled=false)
POST   /api/checkpoints/definitions/{id}/toggle → Enable/disable

GET    /api/checkpoints/field-types          → List supported field types + their config schema
```

### 2b. Pipeline Resolution API
**File:** `src/backend/app/routers/checkpoints.py` (same router, different section)

```
GET    /api/tasks/{task_id}/checkpoints                → Resolve active checkpoints for this task
POST   /api/tasks/{task_id}/checkpoints/{instance_id}/submit  → Submit checkpoint data
POST   /api/tasks/{task_id}/checkpoints/{instance_id}/skip    → Skip optional checkpoint
POST   /api/tasks/{task_id}/checkpoints/{instance_id}/retry   → Retry failed checkpoint
GET    /api/tasks/{task_id}/checkpoints/{instance_id}         → Get checkpoint instance state
```

### 2c. Pydantic Schemas
**File:** `src/backend/app/schemas/checkpoint.py`

```python
class FieldDefinition(BaseModel):
    key: str
    type: str  # text, textarea, select, multi_select, checkbox, radio, number, range, chips
    label: str
    required: bool = False
    placeholder: str | None = None
    options: list[dict] | None = None  # For select/radio/multi_select
    min: float | None = None           # For number/range
    max: float | None = None
    default: Any | None = None

class CheckpointDefinitionCreate(BaseModel):
    control_type: str
    label: str
    description: str = ""
    field_schema: list[FieldDefinition]
    pipeline_position: str  # after_retrieval | after_generation | post_generation
    sort_order: int = 0
    applicable_modes: list[str] = ["*"]
    required: bool = False
    timeout_seconds: int | None = None
    max_retries: int = 2
    circuit_breaker_threshold: int = 5
    circuit_breaker_window_minutes: int = 60

class CheckpointDefinitionResponse(BaseModel):
    id: str
    control_type: str
    label: str
    description: str
    field_schema: list[FieldDefinition]
    pipeline_position: str
    sort_order: int
    applicable_modes: list[str]
    required: bool
    timeout_seconds: int | None
    max_retries: int
    enabled: bool
    created_at: datetime
    updated_at: datetime

class CheckpointInstanceResponse(BaseModel):
    id: str
    task_id: str
    definition_id: str
    control_type: str
    label: str
    state: str
    field_schema: list[FieldDefinition]
    payload: dict | None
    submit_result: dict | None
    required: bool
    timeout_seconds: int | None
    attempt_count: int
    last_error: str | None
    offered_at: datetime | None
    submitted_at: datetime | None

class CheckpointSubmitRequest(BaseModel):
    data: dict  # Key-value pairs matching field_schema keys

class ResolvedCheckpointsResponse(BaseModel):
    task_id: str
    pipeline_position: str
    checkpoints: list[CheckpointInstanceResponse]
```

---

## 3. Checkpoint Resolver Service
**File:** `src/backend/app/services/checkpoint_resolver.py`

Core logic that determines which checkpoints apply to a task and manages their lifecycle.

```python
class CheckpointResolver:
    def resolve(db, task_id: str, pipeline_position: str) -> list[CheckpointInstance]:
        """
        1. Load task to get its mode
        2. Query CheckpointDefinition where:
           - enabled = True
           - pipeline_position matches
           - applicable_modes contains task.mode or "*"
           - circuit breaker is not tripped
        3. For each matching definition:
           - Check if CheckpointInstance already exists for this task+definition
           - If not, create one with state="pending"
           - If exists and state is "failed" with retries remaining, set to "pending"
        4. Return instances ordered by sort_order
        """

    def submit(db, instance_id: str, data: dict) -> CheckpointInstance:
        """
        1. Load instance + definition
        2. Validate data against field_schema (required fields present, types match)
        3. Set state="submitted", submit_result=data, submitted_at=now
        4. Return updated instance
        """

    def skip(db, instance_id: str) -> CheckpointInstance:
        """
        1. Load instance + definition
        2. If definition.required: raise error (cannot skip required)
        3. Set state="skipped"
        4. Return updated instance
        """

    def fail(db, instance_id: str, error: str) -> CheckpointInstance:
        """
        1. Increment attempt_count
        2. Set last_error, failed_at
        3. If attempt_count >= max_retries: state="failed" (terminal)
        4. Else: state="failed" (retryable)
        5. Check circuit breaker: count recent failures for this definition
        6. If threshold exceeded: disable definition, log warning
        """

    def check_circuit_breaker(db, definition_id: str) -> bool:
        """Count failures in window, return True if tripped."""

    def validate_submission(definition: CheckpointDefinition, data: dict) -> list[str]:
        """Validate data keys/types against field_schema. Return list of errors."""
```

---

## 4. Failure Point Strategy (detailed)

### Layer 1: Backend API failures
- **Checkpoint resolution fails**: Return empty list → pipeline proceeds without checkpoints (graceful degradation)
- **Submission validation fails**: Return 422 with field-level errors → frontend shows inline validation
- **Database write fails**: Return 500 → frontend shows error with retry button

### Layer 2: Frontend control failures
- **Render error**: React error boundary around `DynamicControlRenderer` → show fallback card with "Control failed to load" + skip/retry buttons
- **Timeout**: Frontend timer starts when checkpoint enters `active` state. On timeout:
  - If `required`: show "Time expired" message + retry button
  - If optional: auto-skip with `state="timed_out"` and continue pipeline
- **Network error on submit**: Show inline error + retry button, don't lose form data

### Layer 3: Pipeline-level failures
- **Required checkpoint fails terminally** (max retries exceeded): Block pipeline, show error status in transcript, offer "Contact support" or "Skip anyway" (admin-configurable)
- **Optional checkpoint fails**: Log failure, auto-skip, continue pipeline
- **Circuit breaker trips**: Checkpoint is automatically disabled. Admin dashboard shows alert. Pipeline continues without it.

### Layer 4: Audit trail
- Every state transition is recorded on `CheckpointInstance` (timestamps + attempt_count + last_error)
- Failed checkpoints create a `status` item in the chat transcript for visibility

### State machine for CheckpointInstance:
```
pending → offered → active → submitted → collapsed
                          ↘ failed → (retry) → offered
                          ↘ timed_out → (retry) → offered
                          ↘ skipped (if optional)
```

---

## 5. Frontend Changes

### 5a. New Types
**File:** `src/frontend/src/types/index.ts` (extend existing)

```typescript
// Field definition from backend schema
interface CheckpointFieldDef {
  key: string;
  type: "text" | "textarea" | "select" | "multi_select" | "checkbox" | "radio" | "number" | "range" | "chips";
  label: string;
  required: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  default?: unknown;
}

// Checkpoint instance as received from backend
interface CheckpointInstance {
  id: string;
  task_id: string;
  definition_id: string;
  control_type: string;
  label: string;
  state: "pending" | "offered" | "active" | "submitted" | "collapsed" | "skipped" | "failed" | "timed_out";
  field_schema: CheckpointFieldDef[];
  payload: Record<string, unknown> | null;
  submit_result: Record<string, unknown> | null;
  required: boolean;
  timeout_seconds: number | null;
  attempt_count: number;
  last_error: string | null;
  offered_at: string | null;
  submitted_at: string | null;
}

// New ChatMessage variant for dynamic checkpoints
// Add to ChatMessage union:
| {
    id: string;
    type: "checkpoint";
    instance: CheckpointInstance;
  }

// New ChatItem variant for ChatInterface.tsx:
| {
    id: string;
    kind: "checkpoint";
    instance: CheckpointInstance;
    formData: Record<string, unknown>;
  }
```

### 5b. New API Client Functions
**File:** `src/frontend/src/api/client.ts` (extend existing)

```typescript
// Admin CRUD
export function listCheckpointDefinitions(): Promise<CheckpointDefinitionResponse[]>
export function createCheckpointDefinition(data: CheckpointDefinitionCreate): Promise<CheckpointDefinitionResponse>
export function updateCheckpointDefinition(id: string, data: Partial<CheckpointDefinitionCreate>): Promise<CheckpointDefinitionResponse>
export function toggleCheckpointDefinition(id: string): Promise<CheckpointDefinitionResponse>

// Pipeline
export function resolveCheckpoints(taskId: string, position: string): Promise<ResolvedCheckpointsResponse>
export function submitCheckpoint(taskId: string, instanceId: string, data: Record<string, unknown>): Promise<CheckpointInstanceResponse>
export function skipCheckpoint(taskId: string, instanceId: string): Promise<CheckpointInstanceResponse>
export function retryCheckpoint(taskId: string, instanceId: string): Promise<CheckpointInstanceResponse>
```

### 5c. Dynamic Control Renderer
**File:** `src/frontend/src/components/controls/DynamicControlRenderer.tsx`

This is the key component that makes admin-defined checkpoints render without code changes.

```typescript
interface DynamicControlRendererProps {
  instance: CheckpointInstance;
  onSubmit: (instanceId: string, data: Record<string, unknown>) => void;
  onSkip: (instanceId: string) => void;
  onRetry: (instanceId: string) => void;
  disabled?: boolean;
}
```

**Behavior:**
- Reads `instance.field_schema` and renders each field using a `FieldRenderer` switch
- Manages local form state via `useState`
- Validates required fields before submit
- Shows timeout countdown if `timeout_seconds` is set
- On error state: shows error message + retry/skip buttons
- On submitted state: renders collapsed summary view
- Wraps in React error boundary

**FieldRenderer component** (`src/frontend/src/components/controls/FieldRenderer.tsx`):
Maps field type → input element:
- `text` → `<input type="text">`
- `textarea` → `<textarea>`
- `select` → `<select>` with options
- `multi_select` → checkboxes group
- `checkbox` → single checkbox
- `radio` → radio button group
- `number` → `<input type="number">`
- `range` → `<input type="range">`
- `chips` → clickable chip/tag selection

### 5d. Checkpoint Error Boundary
**File:** `src/frontend/src/components/controls/CheckpointErrorBoundary.tsx`

Catches render errors in dynamic controls. Shows:
- Error message
- "Skip" button (if optional)
- "Retry" button
- Reports error back to backend via `fail()` endpoint

### 5e. Admin Dashboard Page
**File:** `src/frontend/src/components/admin/CheckpointDashboard.tsx`

Simple admin page with:
- List of all checkpoint definitions (enabled/disabled toggle)
- "Create new checkpoint" form with:
  - Name, description, control_type slug
  - Pipeline position dropdown (after_retrieval, after_generation, post_generation)
  - Field builder (add/remove/reorder fields with type/label/required/options config)
  - Mode applicability checkboxes
  - Required toggle
  - Timeout, retry, circuit breaker config
- Edit existing checkpoint definitions
- Status indicators (circuit breaker status, recent failure count)

### 5f. Pipeline Orchestration Changes
**File:** `src/frontend/src/stores/studyStore.ts`

Refactor `runTaskFlow()` to call checkpoint resolution at each pipeline position:

```typescript
async function runTaskFlow({ taskId, query, mode }: RunTaskFlowParams) {
  // ... existing retrieval logic ...

  // After retrieval: resolve checkpoints at "after_retrieval"
  const afterRetrievalCheckpoints = await resolveCheckpoints(taskId, "after_retrieval");
  for (const checkpoint of afterRetrievalCheckpoints.checkpoints) {
    // Inject checkpoint message into transcript
    // For built-in types (chunk_selector), use existing component
    // For dynamic types, use DynamicControlRenderer
    // Wait for submission before continuing (if required)
  }

  // ... existing generation logic ...

  // After generation: resolve checkpoints at "after_generation"
  const afterGenCheckpoints = await resolveCheckpoints(taskId, "after_generation");
  // ... same pattern ...

  // Post generation: resolve checkpoints at "post_generation"
  const postGenCheckpoints = await resolveCheckpoints(taskId, "post_generation");
  // ... same pattern ...
}
```

The key change: instead of `if (mode === "hitl_r")` branching, the pipeline asks the backend "what checkpoints should appear here?" and the backend consults the database.

### 5g. ChatInterface.tsx Changes

Extend the `ChatItem` union to include a `checkpoint` kind. In the rendering loop, add:

```typescript
if (item.kind === "checkpoint") {
  // Check if this is a built-in control type with a custom renderer
  if (item.instance.control_type === "chunk_selector") {
    return <SectionSelectorMessage ... />;  // Existing component
  }
  if (item.instance.control_type === "summary_editor") {
    return <EditableSummaryMessage ... />;  // Existing component
  }
  // For all other types: dynamic renderer
  return <DynamicControlRenderer instance={item.instance} ... />;
}
```

This preserves existing rich controls while supporting new dynamic ones.

---

## 6. File Change Summary

### New Files (Backend)
| File | Purpose |
|---|---|
| `src/backend/app/models/checkpoint_definition.py` | CheckpointDefinition model |
| `src/backend/app/models/checkpoint_instance.py` | CheckpointInstance model |
| `src/backend/app/schemas/checkpoint.py` | Pydantic schemas for checkpoint API |
| `src/backend/app/routers/checkpoints.py` | Admin CRUD + pipeline resolution endpoints |
| `src/backend/app/services/checkpoint_resolver.py` | Resolution, validation, failure, circuit breaker logic |
| `src/backend/app/services/checkpoint_seeder.py` | Seed built-in checkpoint definitions on startup |

### New Files (Frontend)
| File | Purpose |
|---|---|
| `src/frontend/src/components/controls/DynamicControlRenderer.tsx` | Schema-driven control renderer |
| `src/frontend/src/components/controls/FieldRenderer.tsx` | Individual field type → input mapping |
| `src/frontend/src/components/controls/CheckpointErrorBoundary.tsx` | Error boundary for dynamic controls |
| `src/frontend/src/components/controls/CheckpointTimeoutBar.tsx` | Countdown timer bar component |
| `src/frontend/src/components/admin/CheckpointDashboard.tsx` | Admin dashboard for managing definitions |
| `src/frontend/src/components/admin/FieldSchemaBuilder.tsx` | Visual field schema builder for dashboard |

### Modified Files
| File | Change |
|---|---|
| `src/backend/app/main.py` | Register checkpoints router, call seeder on startup |
| `src/backend/app/models/__init__.py` | Import new models |
| `src/frontend/src/types/index.ts` | Add CheckpointFieldDef, CheckpointInstance, ChatMessage "checkpoint" variant |
| `src/frontend/src/api/client.ts` | Add checkpoint CRUD + pipeline API functions |
| `src/frontend/src/stores/studyStore.ts` | Refactor `runTaskFlow()` to use checkpoint resolution |
| `src/frontend/src/components/ChatInterface.tsx` | Add checkpoint rendering in ChatItem loop, refactor PostGenerationStage |
| `src/frontend/src/components/MessageRenderer.tsx` | Add checkpoint message type handling |

---

## 7. Implementation Order

1. **Backend models** → CheckpointDefinition + CheckpointInstance + migrations
2. **Backend schemas** → Pydantic request/response models
3. **Checkpoint resolver service** → Core resolution + validation + failure logic
4. **Checkpoint seeder** → Seed built-in controls from hardcoded definitions
5. **Backend router** → Admin CRUD + pipeline resolution endpoints
6. **Backend main.py** → Register router + seeder
7. **Frontend types** → Add checkpoint types to `types/index.ts`
8. **Frontend API client** → Add checkpoint API functions
9. **FieldRenderer** → Dynamic field type rendering
10. **DynamicControlRenderer** → Schema-driven control with timeout + error handling
11. **CheckpointErrorBoundary** → Error boundary wrapper
12. **CheckpointTimeoutBar** → Visual countdown
13. **Store refactor** → `runTaskFlow()` uses checkpoint resolution
14. **ChatInterface + MessageRenderer** → Render checkpoint items in transcript
15. **Admin dashboard** → CheckpointDashboard + FieldSchemaBuilder
16. **End-to-end testing** → Create a custom checkpoint from dashboard, verify it appears in chat

---

## 8. Verification Plan

1. **Unit test checkpoint resolver**: Mock DB, verify resolution for different modes/positions
2. **Unit test submission validation**: Verify required field enforcement, type checking
3. **Unit test circuit breaker**: Simulate repeated failures, verify auto-disable
4. **API test admin CRUD**: Create/update/toggle/list definitions via `/api/checkpoints/definitions`
5. **API test pipeline resolution**: Call `/api/tasks/{id}/checkpoints?position=after_retrieval` and verify correct checkpoints returned
6. **Frontend test DynamicControlRenderer**: Render with various field_schema configs, verify all field types render
7. **Integration test**: Start session → run query → verify checkpoint appears in chat → submit → verify collapsed state → verify transcript record
8. **Failure test**: Trigger timeout, verify skip/retry behavior. Trigger circuit breaker, verify checkpoint disabled.
9. **Dashboard test**: Create new checkpoint definition, start new session, verify it appears in chat flow
10. **Backward compatibility test**: Run existing study flow (baseline, hitl_r, hitl_g, hitl_full modes) and verify selector/editor/questionnaire still work as before
