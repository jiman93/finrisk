# FinRisk System Design Framework

## Purpose
This document defines the working system design for the FinRisk chat app so we can keep implementation decisions consistent as we move from synthetic mock development to live PageIndex + OpenAI integration.

## Product Frame
- Primary interface: conversational assistant for financial risk analysis.
- Core interaction model: chat-first workflow with explicit, inspectable tool steps.
- Human control: HITL actions are part of the chat timeline, not detached modal flows.

## Core Design Principles
1. Chat is the source of truth.
2. Every meaningful action must be represented in transcript form.
3. Retrieval/generation steps must be visible and stateful (`running`, `completed`, `failed`).
4. Human interventions should be explicit and auditable.
5. Context pane is read-only and supports inspection, not decision entry.
6. System must run in synthetic mode without external dependency.

## High-Level Architecture

### Frontend
- Stack: React + Vite.
- Layout:
  - Left pane: main conversation timeline + composer.
  - Right pane: collapsible context inspector.
- Responsibilities:
  - Render multi-step conversational stream.
  - Render in-stream HITL controls (selection/edit/questionnaire).
  - Maintain local state machine for post-generation decisions.
  - Open right pane with read-only artifacts (citations, selected chunks, edited summary, questionnaire response).

### Backend
- Stack: FastAPI.
- Modes:
  - Synthetic endpoints for deterministic dev/test iteration.
  - Provider-backed endpoints for live retrieval/generation.
- Responsibilities:
  - Return retrieval payload shape compatible with PageIndex-style usage.
  - Simulate latency/scenarios for UI robustness.
  - Expose step-friendly responses usable by stream UI.

### Data Sources
- SEC EDGAR filings (HTML/PDF) for document corpus.
- PageIndex for tree/index/retrieval when live.
- OpenAI for final synthesis when live.

## Conversation State Model

### Transcript Item Types
- `user`: prompt messages.
- `assistant`: bridge/explanatory narration.
- `step`: tool states (`Get document structure`, `Get page content`, `Synthesize answer`).
- `selector`: chunk selection card (HITL-R).
- `answer`: generated/edited summary records.
- `status`: short audit events with optional action buttons.
- `error`: recoverable failures.

### Post-Generation Stages
- `decision`: choose edit vs accept.
- `editing`: in-stream summary edit form.
- `questionnaire`: in-stream questionnaire form.
- `input`: returns to normal query composer.

## HITL Interaction Framework

### HITL-R (Retrieval Control)
- User selects chunks in-stream.
- After submit:
  - selection UI collapses to compact state,
  - transcript logs selected count,
  - action button opens selected set in right pane.

### HITL-G (Generation Control)
- User edits generated summary in-stream.
- On submit:
  - transcript logs edit submitted,
  - right pane can display edited summary via action button.

### Questionnaire
- Questionnaire remains in-stream.
- On submit:
  - transcript logs structured response,
  - right pane can display submitted response via action button.

## Extensible HITL Control Architecture

### Why this matters
- The key product advantage is not a single selector or editor card.
- The advantage is a reusable in-stream control system where new human checkpoints can be added without redesigning the app shell.
- HITL controls are treated as first-class chat events, so each control is visible, auditable, and composable with tool steps.

### Control Contract (Design Standard)
Every HITL control should follow one consistent contract:
- `control_type`: semantic type (for example: `chunk_selector`, `summary_editor`, `questionnaire`, `citation_verifier`).
- `control_id`: unique stable ID for updates and audit logs.
- `state`: lifecycle state (`offered`, `active`, `submitted`, `collapsed`, `failed`).
- `payload`: control-specific data required to render and submit.
- `required`: whether workflow can progress without completion.
- `submit_result`: compact summary stored in transcript after submit.
- `view_action`: optional right-pane read-only action (`View selected`, `View edited`, `View response`).

### Control Lifecycle in Chat
1. Assistant introduces why control is needed.
2. Control is rendered inline in stream (`active`).
3. User submits action.
4. Control collapses to compact transcript record (`collapsed`).
5. Transcript stores outcome and optional `View ...` action for right pane inspection.

This pattern keeps the timeline readable while preserving full traceability.

### Composition Patterns
Controls should be composable in predictable ways:
- Sequential: `selector -> generator -> editor -> questionnaire`.
- Conditional: show control only if confidence/quality threshold is not met.
- Optional branch: user chooses whether to edit or accept.
- Repeatable: a control can be re-issued if user retries a step.

### Separation of Responsibilities
- Chat stream:
  - Owns decision flow and all required input controls.
  - Owns the authoritative run history.
- Right pane:
  - Read-only inspector for artifacts produced by chat actions.
  - Never used for required submission actions.

### Current Controls Implemented
- Retrieval chunk selector (HITL-R).
- Summary editor (HITL-G style intervention).
- Questionnaire capture.

Each already follows the same pattern:
- inline submit,
- transcript record,
- optional `View ...` artifact in right pane.

### Planned Control Extensions
The same architecture supports additional controls without changing layout fundamentals:
- Citation validation control (`mark supported / weak / missing`).
- Risk-priority ranking control (drag/reorder with explicit rationale).
- Policy/compliance override control (approve, reject, escalate).
- Source conflict resolver (pick preferred evidence among conflicting chunks).
- Confidence calibration card (assistant confidence vs user confidence capture).

### Implementation Rule for New Controls
When adding a new HITL control:
1. Define `control_type` and payload schema.
2. Add renderer component for `active` state.
3. Add submit handler that emits compact transcript summary.
4. Add collapse behavior after submit.
5. Add optional right-pane `view_action` artifact if useful.
6. Verify required/optional gating rules in workflow state machine.

If a new control cannot follow this contract, it should be treated as an exception and documented explicitly.

### Control Registry Sketch (TypeScript)
Use a typed registry so controls are extensible without hardcoding large `if/else` branches in chat rendering logic.

```ts
type HitlControlType =
  | "chunk_selector"
  | "summary_editor"
  | "questionnaire"
  | "citation_verifier";

type ControlState = "offered" | "active" | "submitted" | "collapsed" | "failed";

interface ControlBase<TType extends HitlControlType, TPayload, TResult> {
  control_type: TType;
  control_id: string;
  state: ControlState;
  required: boolean;
  payload: TPayload;
  submit_result?: TResult;
}

type ChunkSelectorControl = ControlBase<
  "chunk_selector",
  { chunks: Array<{ id: string; title: string; page: number; content: string }> },
  { selected_ids: string[]; rejected_ids: string[] }
>;

type SummaryEditorControl = ControlBase<
  "summary_editor",
  { draft: string; citations: string[] },
  { edited_text: string; changed_chars: number }
>;

type QuestionnaireControl = ControlBase<
  "questionnaire",
  { questions: string[] },
  { confidence: number; citation_helpfulness: "yes" | "partly" | "no"; notes?: string }
>;

type HitlControl = ChunkSelectorControl | SummaryEditorControl | QuestionnaireControl;

interface ControlModule<T extends HitlControl> {
  renderActive: (control: T) => JSX.Element;
  renderCollapsed: (control: T) => JSX.Element;
  submit: (control: T, userInput: unknown) => Promise<T>;
  toTranscriptSummary: (control: T) => string;
  toViewAction?: (control: T) => { label: string; artifact_type: string };
}

type Registry = {
  [K in HitlControl["control_type"]]: ControlModule<Extract<HitlControl, { control_type: K }>>;
};

const CONTROL_REGISTRY: Registry = {
  chunk_selector: chunkSelectorModule,
  summary_editor: summaryEditorModule,
  questionnaire: questionnaireModule,
  citation_verifier: citationVerifierModule, // optional future module
};
```

Minimal integration pattern in chat engine:
1. Read control `control_type`.
2. Load module from `CONTROL_REGISTRY`.
3. Render `active` or `collapsed` view by state.
4. On submit, call module `submit`.
5. Append `toTranscriptSummary` result as a chat status record.
6. If present, expose `toViewAction` artifact for right-pane inspection.

This pattern keeps control behavior modular and lets the chat stream remain stable as new HITL capabilities are added.

## Right Pane Framework (Read-Only Inspector)

### Role
- Strictly inspection/context.
- Never the source of decisions or required data entry.

### Content Types
- Citation source preview.
- Selected chunks snapshot.
- Edited summary snapshot.
- Questionnaire submission snapshot.

### Behavior
- Opened by clicking actionable items from chat.
- Collapsible/expandable to keep focus on main transcript.
- Safe default content when no item is selected.

## Retrieval + Generation Orchestration

### Current Dev Path (Synthetic)
1. User query enters transcript.
2. Step: document structure.
3. Step: page content retrieval.
4. In-stream chunk selection.
5. Step: synthesis.
6. Answer + citations.
7. Optional edit/questionnaire before next query.

### Live Path (Target)
- Replace synthetic retrieve/generate calls with provider-backed calls while preserving UI contracts:
  - PageIndex retrieval output -> same normalized retrieval chunk model.
  - OpenAI synthesis output -> same answer/citation rendering model.
- Keep UI semantics unchanged so migration is backend-led.

## Why This Framework Works
- Preserves auditability: all key actions are visible in one timeline.
- Reduces UI fragmentation: right pane is contextual, not procedural.
- Supports controlled experimentation: synthetic scenarios mimic production behavior.
- De-risks provider instability: UI and interaction logic remain testable even when live retrieval is unreliable.

## Guardrails for Future Changes
1. Do not move mandatory HITL input forms into the right pane.
2. Do not hide tool-step transitions from the transcript.
3. Do not break normalized retrieval chunk contract.
4. Preserve action-to-artifact mapping (`View ...` from chat -> right pane detail).
5. Keep synthetic mode first-class for daily development.

## Reference Pointers
- UI plan: `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/docs/UI_CHAT_HITL_PLAN.md`
- Multi-step stream plan: `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/docs/MULTI_STEP_CONVERSATIONAL_STREAM_PLAN.md`
- Mock retrieval plan: `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/docs/MOCK_RETRIEVAL_WORKFLOW_PLAN.md`
