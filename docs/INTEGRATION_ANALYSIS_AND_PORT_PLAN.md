# FinRisk Integration Analysis & Live Port Plan

## Problem Statement

The codebase currently runs **two parallel frontend paths** that consume **two different backend APIs** with **different data shapes**. This was intentional for development speed, but creates confusion about what is "real" and what needs to change when moving to live PageIndex + OpenAI integration.

This document maps the current state, identifies every seam, and defines the migration path.

---

## Current Architecture: Two Parallel Worlds

```
┌──────────────────────────────────────────────────────────────┐
│                        FRONTEND                              │
│                                                              │
│  ┌─────────────────────┐    ┌──────────────────────────┐    │
│  │  ChatInterface.tsx   │    │  studyStore.ts            │    │
│  │  (standalone demo)   │    │  + MessageRenderer.tsx    │    │
│  │                      │    │  (study protocol flow)    │    │
│  │  Local state only    │    │  Zustand global state     │    │
│  │  No DB persistence   │    │  Full DB persistence      │    │
│  └──────────┬───────────┘    └──────────────┬───────────┘    │
│             │                               │                │
│     syntheticRetrieve()              queryTask()             │
│     syntheticGenerate()              generateTask()          │
│             │                        selectNodesTask()       │
│             │                        editSummaryTask()       │
└─────────────┼───────────────────────────────┼────────────────┘
              │                               │
              ▼                               ▼
┌─────────────────────────┐    ┌──────────────────────────────┐
│  /api/synthetic/*       │    │  /api/tasks/*                 │
│  synthetic.py router    │    │  tasks.py router              │
│                         │    │                               │
│  SyntheticPipeline      │    │  PageIndexService (live)      │
│  SyntheticStream (SSE)  │    │  LLMService (live)            │
│  MockRetrievalEngine    │    │  mock_pipeline (fallback)     │
│                         │    │                               │
│  Returns NESTED nodes   │    │  Returns FLAT nodes           │
│  No DB writes           │    │  Full DB writes               │
└─────────────────────────┘    └──────────────────────────────┘
```

### Summary of the Two Paths

| Aspect | Path 1: ChatInterface (Synthetic) | Path 2: studyStore (Task Router) |
|--------|-----------------------------------|----------------------------------|
| **Purpose** | UI prototyping / demo | Actual study protocol |
| **API endpoints** | `/api/synthetic/retrieve`, `/api/synthetic/generate` | `/api/tasks/{id}/query`, `/api/tasks/{id}/generate` |
| **Node shape** | **Nested**: `SyntheticRetrievedNode.relevant_contents[]` | **Flat**: `RetrievalNode` (one per content) |
| **Persistence** | None (React component state) | Full SQLAlchemy Task model |
| **Fallback** | None — pure mock | PageIndex → mock fallback if `enable_mock_fallback=true` |
| **Streaming** | SSE via `/api/synthetic/chat/stream` | None |
| **HITL controls** | Inline selection + edit + questionnaire (all local state) | Selection → select-nodes API, Edit → edit-summary API |
| **Mode system** | None (always shows everything) | `baseline`, `hitl_r`, `hitl_g`, `hitl_full` |
| **Right pane** | Full inspector (citations, selected chunks, edited summary, questionnaire) | Not wired |

---

## The Critical Data Shape Mismatch

This is the single biggest source of confusion. The same concept — "retrieved document chunks" — has **two different JSON shapes**.

### Synthetic shape (nested, multi-content per node)

```json
{
  "retrieved_nodes": [
    {
      "title": "Item 1A. Risk Factors - Regulatory",
      "node_id": "0001",
      "relevant_contents": [
        { "page_index": 14, "relevant_content": "First passage..." },
        { "page_index": 15, "relevant_content": "Second passage..." }
      ]
    }
  ]
}
```

ChatInterface must `flattenChunks()` this into individual selectable items, then `buildGenerateNodes()` to reconstruct the nested form for the generate call.

### Task router shape (flat, one content per node)

```json
{
  "retrieved_nodes": [
    {
      "node_id": "0001:1",
      "title": "Item 1A. Risk Factors - Regulatory",
      "page_index": 14,
      "relevant_content": "First passage..."
    },
    {
      "node_id": "0001:2",
      "title": "Item 1A. Risk Factors - Regulatory",
      "page_index": 15,
      "relevant_content": "Second passage..."
    }
  ]
}
```

This is already flat. No transform needed for UI selection.

### Why this happened

`normalize_pageindex_nodes()` in `pageindex_service.py` flattens the raw PageIndex response into `RetrievalNode[]`. The task router stores this flat form. But the synthetic pipeline was built before the normalizer existed and returns the raw nested form directly to the frontend.

---

## Service-by-Service Breakdown

### 1. MockRetrievalEngine (`mock_retrieval_engine.py`)

**Role:** Generates deterministic, seeded mock financial risk disclosure content.

**Scenarios supported:**
- `happy_path` — 4-8 nodes, normal content
- `slow_processing` — same data, signals polling delay
- `empty_completed` — no nodes returned
- `failed_retrieval` — raises 502 error
- `limit_reached` — raises 429 error
- `mixed_relevance` — 6-9 nodes, ~32% weak content
- `long_context` — 9-12 nodes, more multi-content nodes

**What stays:** The engine itself is useful for testing even after live integration. The scenario system exercises different UI failure/edge paths.

**What changes:** Nothing — this is a test utility.

### 2. SyntheticPipelineService (`synthetic_pipeline.py`)

**Role:** Wraps MockRetrievalEngine with latency simulation and response shaping.

**What stays:** Useful for demo mode and UI development without credentials.

**What changes:** Should eventually converge its response shape to match the flat `RetrievalNode` contract, or be clearly marked as "demo only."

### 3. SyntheticStreamService (`synthetic_stream.py`)

**Role:** SSE endpoint that streams step-by-step events (run_started, step_started, retrieval_nodes, final_answer, etc.).

**What stays:** The event schema is valuable — it defines the UX for progressive disclosure.

**What changes:** A live streaming service needs to be built that emits the same event types but calls PageIndex + OpenAI instead of mocks. PageIndex supports polling (not streaming), so the live version would emit step events around each poll cycle. OpenAI supports streaming via `stream=true`.

### 4. PageIndexService (`pageindex_service.py`)

**Role:** Live integration with PageIndex.ai retrieval API.

**Current implementation:**
- POST to `/retrieval/` with doc_id + query
- Poll `/retrieval/{id}/` until status=completed
- Normalize raw nodes via `normalize_pageindex_nodes()`
- Supports "thinking" mode (graceful downgrade on 403)
- Configurable poll interval (1s) and timeout (45s)

**Configuration needed:**
- `pageindex_api_key` — API key
- `pageindex_base_url` — endpoint URL
- `pageindex_doc_map` — ticker-to-doc-id mapping (e.g., `"MSFT:doc-abc,AAPL:doc-def"`)

**What stays:** This is the production retrieval path. Already integrated into task router with fallback.

**What changes:** Nothing — already wired. Just needs credentials configured.

### 5. LLMService (`llm_service.py`)

**Role:** Live integration with OpenAI API for summary generation.

**Current implementation:**
- POST to `/chat/completions` with structured prompt
- System prompt: financial analyst assistant
- User prompt: requests 300-500 word summary with 4 sections + citations
- Temperature 0.2 (deterministic)
- Returns `choices[0].message.content`

**Configuration needed:**
- `openai_api_key` — API key
- `openai_base_url` — defaults to `https://api.openai.com/v1`
- `openai_model` — defaults to `gpt-4o-mini`

**What stays:** This is the production generation path. Already integrated into task router with fallback.

**What changes:** Nothing — already wired. Just needs credentials configured.

### 6. mock_pipeline.py

**Role:** Simple fallback functions used by the task router when live services fail.

**Functions:**
- `mock_pageindex_retrieval()` — wraps MockRetrievalEngine
- `mock_retrieval_nodes()` — returns flat RetrievalNode list
- `mock_summary()` — returns templated summary string

**What stays:** Fallback mechanism for resilience.

**What changes:** Nothing.

---

## Configuration: How the System Switches Between Mock and Live

All controlled via `config.py` / environment variables:

```
┌─────────────────────────────────────────────────────┐
│              Feature Flag Decision Tree               │
│                                                       │
│  synthetic_enabled = True                             │
│  └─ /api/synthetic/* endpoints are active             │
│     └─ ChatInterface.tsx can call them                │
│                                                       │
│  pageindex_api_key = "" (empty)                       │
│  pageindex_doc_map = "" (empty)                       │
│  └─ PageIndexService.has_credentials() = False        │
│     └─ Task router skips live retrieval               │
│                                                       │
│  openai_api_key = "" (empty)                          │
│  └─ LLMService.has_credentials() = False              │
│     └─ Task router skips live generation              │
│                                                       │
│  enable_mock_fallback = True                          │
│  └─ Task router uses mock_pipeline as fallback        │
│                                                       │
│  CURRENT STATE: Everything runs on mocks              │
│                                                       │
│  TO ENABLE LIVE:                                      │
│  1. Set pageindex_api_key + pageindex_doc_map         │
│  2. Set openai_api_key                                │
│  3. Optionally set synthetic_enabled = False          │
│  4. Keep enable_mock_fallback = True (safety net)     │
└─────────────────────────────────────────────────────┘
```

---

## What Needs to Change for the Port (and What Doesn't)

### Things that are ALREADY CORRECT and don't need changes

1. **Task router fallback logic** — already tries live → falls back to mock. Just add credentials.
2. **PageIndexService** — fully implemented with polling, timeout, normalization.
3. **LLMService** — fully implemented with structured prompts.
4. **RetrievalNode contract** — the flat `{ node_id, title, page_index, relevant_content }` shape is the canonical schema. Task router already uses it end-to-end.
5. **Backend models** — Task model stores all HITL data correctly.
6. **Config system** — credential-based activation already works.

### Things that NEED changes

#### Change 1: Converge ChatInterface to use the Task Router path

**Problem:** ChatInterface calls `/api/synthetic/*` directly and handles a different data shape. When the synthetic router is disabled, ChatInterface breaks completely.

**Solution:** ChatInterface should be refactored to either:
- **(A) Use studyStore** — integrate with the Zustand store and use the same `queryTask`/`generateTask` functions. This is the recommended path since the study flow is the real product.
- **(B) Use a unified API layer** — create a frontend service that abstracts whether data comes from synthetic or task router, always returning the flat `RetrievalNode` shape.

**Recommended: Option A.** ChatInterface becomes a "consumer view" that reads from studyStore. The right-pane inspector, citation panel, and post-generation stages move into the study flow.

#### Change 2: Eliminate the nested node shape from the frontend

**Problem:** `SyntheticRetrievedNode` has a `relevant_contents[]` array. `RetrievalNode` is flat. The frontend has `flattenChunks()` and `buildGenerateNodes()` to bridge this gap.

**Solution:** After Change 1, the frontend only ever receives `RetrievalNode[]` (flat). Remove:
- `SyntheticRetrievedNode` type
- `SyntheticRelevantContent` type
- `flattenChunks()` function
- `buildGenerateNodes()` function

These become unnecessary because the task router already returns flat nodes.

#### Change 3: Port the right-pane inspector to the study flow

**Problem:** ChatInterface has a full right-pane inspector (citations, selected chunks, edited summary, questionnaire). The study flow (`studyStore` + `MessageRenderer`) doesn't have this.

**Solution:** Extract the right-pane logic from ChatInterface into a shared component. Wire it to the study flow's chat items. The `StatusAction` pattern (view_selected, view_edited, view_questionnaire) already exists — just needs to be connected.

#### Change 4: Build live streaming

**Problem:** `synthetic_stream.py` provides SSE events for the ChatInterface's step-by-step UX. There's no live equivalent.

**Solution:** Create a `LiveStreamService` that:
1. Emits the same SSE event types as `SyntheticStreamService`
2. Wraps `PageIndexService.retrieve()` calls — emits `step_started`/`step_completed` around poll cycles
3. Wraps `LLMService.generate_summary()` — uses OpenAI's streaming API (`stream=true`) to emit token-by-token or chunk-by-chunk progress
4. Falls back to `SyntheticStreamService` if credentials missing

Event contract stays identical, only the data source changes. This is the design principle from `SYSTEM_DESIGN_FRAMEWORK.md`: "Keep UI semantics unchanged so migration is backend-led."

#### Change 5: Unify the questionnaire into the study flow

**Problem:** The questionnaire in ChatInterface is pure local state. In the study flow, there's no questionnaire endpoint or persistence.

**Solution:** Add a `/api/tasks/{id}/questionnaire` endpoint that stores the questionnaire response in the Task model (add `questionnaire_response` JSON column). The frontend submits to this endpoint and gets back a persisted record.

---

## Migration Order

### Phase 1: Backend is already ready (minimal changes)

The task router already handles live ↔ mock switching based on credentials. To go live:

```bash
# .env
PAGEINDEX_API_KEY=your-key
PAGEINDEX_DOC_MAP=MSFT:doc-xxx,AAPL:doc-yyy,...
OPENAI_API_KEY=your-key
ENABLE_MOCK_FALLBACK=true   # keep as safety net
```

That's it. The backend switches to live retrieval and generation. If live fails, mock fallback kicks in. No code changes needed.

### Phase 2: Frontend convergence

1. **Merge ChatInterface features into study flow** — right pane, step cards, citation inspector, post-generation stages
2. **studyStore becomes the single source of truth** — all chat state flows through Zustand
3. **Remove direct synthetic API calls from frontend** — ChatInterface uses studyStore instead
4. **Clean up synthetic types** — remove `SyntheticRetrievedNode`, `flattenChunks`, `buildGenerateNodes`

### Phase 3: Live streaming

1. Build `LiveStreamService` wrapping PageIndex polling + OpenAI streaming
2. Same SSE event contract as `SyntheticStreamService`
3. Frontend consumes the same event types regardless of source
4. Add `/api/chat/stream` endpoint that auto-selects live vs. synthetic based on config

### Phase 4: Cleanup

1. Gate `/api/synthetic/*` behind a `SYNTHETIC_ENABLED=true` dev flag
2. Mark ChatInterface as deprecated demo component (or remove it)
3. The study flow is now the only production UI path

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| PageIndex API unavailability | No retrieval | `enable_mock_fallback=true` auto-switches to mock |
| OpenAI API unavailability | No generation | `enable_mock_fallback=true` auto-switches to mock summary |
| PageIndex rate limiting (429) | Blocked retrieval | MockRetrievalEngine already simulates this scenario; fallback handles it |
| Data shape regression | Frontend crashes | The flat `RetrievalNode` is the canonical contract — validated by Pydantic on the backend |
| Polling timeout (PageIndex) | Stuck retrieval step | 45s timeout configured; `PageIndexError` triggers fallback |
| LLM response quality | Bad summaries | Temperature 0.2 for consistency; structured prompt enforces format |

---

## File Impact Summary

### No changes needed (backend already handles live)
- `src/backend/app/services/pageindex_service.py` ✓
- `src/backend/app/services/llm_service.py` ✓
- `src/backend/app/routers/tasks.py` ✓
- `src/backend/app/services/mock_pipeline.py` ✓
- `src/backend/app/config.py` ✓

### Keep as-is for dev/testing
- `src/backend/app/services/mock_retrieval_engine.py` — test utility
- `src/backend/app/services/synthetic_pipeline.py` — dev/demo mode
- `src/backend/app/services/synthetic_stream.py` — SSE event contract reference
- `src/backend/app/routers/synthetic.py` — dev/demo endpoints

### Frontend changes needed for port
- `src/frontend/src/components/ChatInterface.tsx` — refactor to use studyStore
- `src/frontend/src/stores/studyStore.ts` — add right-pane, step cards, streaming support
- `src/frontend/src/types/index.ts` — remove synthetic-only types after convergence
- `src/frontend/src/api/client.ts` — add questionnaire endpoint, streaming client

### New files needed
- `src/backend/app/services/live_stream.py` — live SSE streaming service
- `src/backend/app/routers/stream.py` — unified streaming endpoint
- `src/frontend/src/components/RightPaneInspector.tsx` — extracted from ChatInterface
- `src/frontend/src/hooks/useStreamEvents.ts` — SSE event consumer hook
