# FinRisk Plan: PageIndex-Shaped Mock Retrieval + UI Workflow Simulation

## Objective
Create a realistic mock retrieval layer that mirrors PageIndex legacy endpoint behavior so we can iterate UI chat workflows without relying on live retrieval readiness or incurring retrieval charges.

## Why This Plan
- Current UI flow depends on retrieval shape and timing behavior.
- Live PageIndex can return `retrieval_ready=false` and empty nodes.
- We need deterministic + varied mock scenarios to validate chat/HITL UX quickly.

## Alignment Targets
- Keep frontend contract stable (`QueryResponse` -> `retrieved_nodes[]` normalized shape).
- Simulate PageIndex lifecycle realistically:
1. submit retrieval job
2. poll status (`processing` -> `completed`/`failed`)
3. normalized nodes exposed to UI
- Support controlled scenario switching for demos and regression checks.

## Canonical Mock Model (Endpoint-Like)
Represent raw mock payloads close to PageIndex legacy structure:

```json
{
  "retrieval_id": "sr-mock-abc123",
  "doc_id": "pi-mock-msft",
  "status": "completed",
  "query": "What are the key cybersecurity risks?",
  "retrieved_nodes": [
    {
      "title": "ITEM 1A. Risk Factors",
      "node_id": "0005",
      "relevant_contents": [
        {
          "page_index": 26,
          "relevant_content": "..."
        }
      ]
    }
  ]
}
```

Normalized UI-facing output remains:
- `node_id`
- `title`
- `page_index`
- `relevant_content`

## Mock Data Strategy (Faker + Domain Templates)
Use synthetic generation with financial-risk templates:
- Faker for variable company phrasing, geo/segment labels, durations, counts.
- Domain phrase banks for:
  - regulatory/compliance risks
  - cyber/technology reliability
  - supply chain/macro risks
  - execution/operations risks
- Deterministic seeding by `ticker + query` for reproducible UI snapshots.

## Workflow Scenario Matrix
Support switchable scenarios via env/config (e.g., `MOCK_SCENARIO=`):

1. `happy_path`
- processing -> completed
- 4-8 retrieved snippets
- summary generation succeeds

2. `slow_processing`
- extended processing polls before completion
- validates loading UX and cancellation behavior

3. `empty_completed`
- completed with zero nodes
- validates empty-state + retry affordance

4. `failed_retrieval`
- status failed/error
- validates error banner + recovery path

5. `limit_reached`
- simulated 403-like failure metadata
- validates quota messaging in UI

6. `mixed_relevance`
- some high/low relevance snippets
- validates selector UX and node curation

7. `long_context`
- long text blocks and many nodes
- validates truncation, expansion, scrolling

## Chat Workflow Coverage
Use scenarios to test these UI flows:
1. Baseline: retrieve -> summarize
2. HITL-R: retrieve -> user select/reject/reorder -> summarize
3. HITL-G: retrieve -> summarize draft -> user edits -> finalize
4. HITL-Full: retrieve curate + edit summary
5. Failure-recovery path: fail -> retry -> complete

## Implementation Phases

### Phase A: Spec + Contracts
- Define raw mock retrieval schema and status transitions.
- Define scenario config and deterministic seed rules.
- Keep existing API response models unchanged for frontend.

### Phase B: Mock Engine
- Build `MockRetrievalEngine` with scenario handlers.
- Add synthetic content generators (faker + risk templates).
- Emit realistic `retrieval_id`, `doc_id`, node IDs, page indices.

### Phase C: Backend Integration
- Route fallback through scenario engine.
- Include mock metadata in logs (not required in UI response yet).
- Keep generation mock tied to selected nodes and citations.

### Phase D: UI Test Harness
- Add dev controls (optional) to choose scenario quickly.
- Capture screenshots/fixtures per scenario for regression.
- Validate chat stream behavior for loading/error/empty/full states.

### Phase E: Stabilization
- Freeze a default scenario set for daily dev.
- Add lightweight tests for schema invariants and deterministic outputs.

## Acceptance Criteria
- Mock retrieval responses resemble PageIndex lifecycle and node structure.
- UI can test all target chat/HITL flows without live provider dependency.
- Scenario outputs are deterministic when seeded.
- No retrieval API charges needed for routine UI development.

## Risks and Mitigations
- Risk: fake text looks generic.
  - Mitigation: combine faker with domain phrase templates + seeded variation.
- Risk: drift between mock and real API shape.
  - Mitigation: keep normalization boundary explicit and versioned.
- Risk: scenario complexity bloats backend.
  - Mitigation: keep scenario handlers modular and focused.

## Out of Scope (for this plan)
- Replacing real PageIndex integration.
- Changing frontend message contract immediately.
- Building production analytics around mock usage.

## Proposed Next Step (after approval)
1. Implement Phase A+B only (mock engine + scenario config).
2. Validate with 3 scenarios first: `happy_path`, `empty_completed`, `failed_retrieval`.
3. Then wire remaining scenarios for full UI workflow testing.
