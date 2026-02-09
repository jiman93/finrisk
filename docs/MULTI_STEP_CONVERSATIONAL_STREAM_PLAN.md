# Plan: Multi-Step Conversational Stream

## Goal
Implement a chat experience that visibly streams intermediate reasoning steps (tool/action cards) before the final answer, similar to PageIndex Chat.

## Target UX
User sends one message, then sees:
1. Assistant intro text (intent)
2. Step card: `Get document structure` (start -> completed)
3. Step card: `Get page content` (start -> completed)
4. Step card: `Synthesize answer` (start -> completed)
5. Final answer with citations

## Scope (Current)
- Use synthetic backend pipeline only (no dependency on real retrieval readiness).
- Keep a single path in UI for now.
- Add deterministic latency + realistic step sequencing.

## Architecture

### Backend (Orchestrator + Stream)
- Add endpoint: `GET /api/synthetic/chat/stream` (SSE) or `WS /api/synthetic/chat/stream`.
- Orchestrator stages:
  1. `plan`
  2. `get_document_structure`
  3. `retrieve_pass_1`
  4. `retrieve_pass_2` (optional)
  5. `generate`
  6. `complete`
- Each stage emits structured events.

### Frontend (Event Renderer)
- Add stream event reducer in chat component/store.
- Render event types as timeline items:
  - assistant text bubbles
  - step cards with state badges (`running`, `completed`, `failed`)
  - final answer block with citations
- Keep composer enabled/disabled based on active run state.

## Event Contract
Use JSON events over SSE with `type` + `payload`:

- `run_started`
- `assistant_message_delta`
- `assistant_message_done`
- `step_started`
- `step_progress` (optional)
- `step_completed`
- `step_failed`
- `retrieval_nodes`
- `final_answer`
- `run_completed`
- `run_failed`

Step payload shape:
- `step_id`
- `label`
- `status`
- `started_at`
- `completed_at`
- `metadata` (latency, node_count, scenario, etc.)

## Implementation Phases

### Phase 1: Streaming Contract
- Define stream schemas in backend (`schemas/synthetic_stream.py`).
- Add typed event union in frontend (`types/stream.ts`).
- DoD: event schema stable and documented.

### Phase 2: Backend Stream Endpoint
- Build synthetic orchestrator generator that yields ordered events with delays.
- Include scenario support (`happy_path`, `empty_completed`, `failed_retrieval`, `limit_reached`).
- DoD: curl can read full event sequence end-to-end.

### Phase 3: Frontend Stream Renderer
- Replace single-shot retrieve/generate calls with stream subscription.
- Render step cards live and update status transitions.
- DoD: user sees multi-step cards + final answer from one prompt.

### Phase 4: Error + Retry UX
- Show failed step card with error detail and retry action.
- Preserve completed steps in transcript.
- DoD: `failed_retrieval` and `limit_reached` scenarios are usable from UI.

### Phase 5: Polish
- Add timing chips (`2.1s`) per step.
- Add collapsible step details (metadata and retrieved snippets).
- DoD: stream feels conversational and inspectable, not raw logs.

## Data/State Model
Chat message stream should support:
- `user_message`
- `assistant_message`
- `tool_step`
- `retrieval_preview`
- `final_answer`
- `error`

Each item should have stable IDs so updates patch existing cards instead of appending duplicates.

## Testing Plan
- Backend:
  - unit tests for event order and schema validity
  - scenario tests for success/failure paths
- Frontend:
  - reducer tests for event-to-UI state transitions
  - manual runbook for each scenario

## Acceptance Criteria
- One prompt triggers visible multi-step stream in order.
- Each step has clear start/completion/failure state.
- Final answer includes citation chips.
- Failure scenarios display actionable retry path.
- Works without real PageIndex/OpenAI calls.

## Out of Scope (for now)
- Real tool-calling with external providers.
- Persistent conversation history across sessions.
- Full study flow integration.

## Proposed Next Action
Implement Phases 1-2 first (stream contract + backend SSE endpoint), then wire frontend in Phase 3.
