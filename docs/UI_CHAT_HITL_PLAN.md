# FinRisk UI Plan (PageIndex-Style + HITL Chat Stream)

## Goal
Build a chat-native UI that feels close to PageIndex Chat visually, while supporting FinRisk-specific HITL interactions directly inside the message stream (retrieval control, generation editing, questionnaires, phase transitions).

## Product Direction
- Visual language: PageIndex-like professional assistant UI (dark-neutral surfaces, high-contrast text, restrained accents, clean spacing).
- Interaction model: single conversation timeline; no side panels required for core study flow.
- Core difference from PageIndex Chat: assistant messages can become interactive HITL task cards.

## UX Principles
- `Chat-first`: every system state appears as a chat message.
- `Progressive control`: baseline is read-only, control increases by phase/mode.
- `Auditability`: every user action should map to a clear event in the timeline.
- `Low cognitive load`: one primary action per interactive message.
- `Study-safe`: prevent skipping mandatory steps (selection/edit/questionnaire).

## Current Baseline (Already Implemented)
- Session start + phase advance controls.
- Message renderer with:
  - `text`
  - `loading`
  - `retrieved_nodes`
  - `selector`
  - `summary`
  - `editable_summary`
- Zustand store orchestration for baseline, HITL-R, HITL-G, HITL-Full.

## Target Information Architecture
- `Top bar`: participant, phase, mode, ticker, status.
- `Message stream`: append-only timeline of all assistant/system/user interactions.
- `Input/footer`: context-aware controls (disabled while blocking interaction is active).

## Message Taxonomy (Final)
- `TextMessage`: narrative, prompts, transitions.
- `LoadingMessage`: retrieval/generation in progress.
- `RetrievedNodesMessage`: read-only evidence list.
- `SectionSelectorMessage` (HITL-R/HITL-Full): accept/reject/reorder nodes.
- `SummaryMessage`: read-only generated or finalized summary.
- `EditableSummaryMessage` (HITL-G/HITL-Full): edit + flag hallucination spans.
- `QuestionnaireMessage`: post-task Likert (blocking).
- `PhaseTransitionMessage`: facilitator script + continue button (blocking).
- `SessionCompleteMessage`: SUS/TLX/trust instruments (blocking).
- `ErrorMessage`: recoverable failure + retry action.

## Visual Theme Plan (PageIndex-Like)
- Palette:
  - Background: near-black + graphite layers.
  - Text: light neutral with muted secondary tone.
  - Accent: single cool accent (blue/cyan) for actionable elements.
  - Semantic states: success/alert/error chips.
- Typography:
  - Clean sans stack, medium weight for headers, compact line-height for message bodies.
- Components:
  - Rounded cards, subtle borders, low-glow focus states, lightweight hover transitions.
- Motion:
  - Small entrance fade/slide for new messages.
  - Loading indicators aligned with assistant “thinking” feel.

## Phase Plan

### Phase 1: Foundation Theming
Files:
- `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/src/frontend/src/index.css`
- `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/src/frontend/src/App.tsx`
- `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/src/frontend/src/components/ChatInterface.tsx`

Scope:
- Replace inline-heavy styling with theme tokens (`:root` CSS variables).
- Establish PageIndex-like dark layout and message container styling.
- Add responsive breakpoints for mobile readability.

Definition of done:
- Entire app follows one coherent theme.
- No raw hardcoded colors in top-level layout components.

### Phase 2: Message System Hardening
Files:
- `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/src/frontend/src/types/index.ts`
- `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/src/frontend/src/components/MessageRenderer.tsx`
- `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/src/frontend/src/components/messages/*`

Scope:
- Normalize message data contracts for all planned message types.
- Add explicit blocking states for mandatory HITL tasks.
- Introduce error/retry message card pattern.

Definition of done:
- Renderer supports full taxonomy with predictable fallbacks.
- Each message type has consistent spacing, title, metadata, action row.

### Phase 3: HITL-R Retrieval Control UX
Files:
- `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/src/frontend/src/components/messages/SectionSelectorMessage.tsx`
- `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/src/frontend/src/stores/studyStore.ts`

Scope:
- Improve card readability (title, page badge, preview collapse).
- Implement reorder interaction (drag handles or deterministic move-up/move-down).
- Show live selected count and disabled submit until valid selection.

Definition of done:
- User can accept/reject/reorder without leaving chat.
- Submitted order reaches backend exactly as displayed.

### Phase 4: HITL-G Generation Control UX
Files:
- `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/src/frontend/src/components/messages/EditableSummaryMessage.tsx`
- `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/src/frontend/src/stores/studyStore.ts`

Scope:
- Rich editing surface with citation highlight tokens.
- Hallucination flag workflow (select span -> reason -> tag).
- Real-time edit count and final submit confirmation.

Definition of done:
- Edited text + flags are captured and submitted in one action.
- Final summary reappears as immutable record message in stream.

### Phase 5: Study Orchestration Cards
Files:
- New message components under:
  - `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/src/frontend/src/components/messages/QuestionnaireMessage.tsx`
  - `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/src/frontend/src/components/messages/PhaseTransitionMessage.tsx`
  - `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/src/frontend/src/components/messages/SessionCompleteMessage.tsx`
- Store/API updates in:
  - `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/src/frontend/src/stores/studyStore.ts`
  - `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/src/frontend/src/api/client.ts`

Scope:
- Add post-task and post-session required forms.
- Add phase intro cards with continue actions.
- Enforce progression rules in store.

Definition of done:
- A full 3-phase run is possible without manual backend/admin intervention.

### Phase 6: QA + Accessibility + Polish
Scope:
- Keyboard navigation for selectors and form controls.
- Color contrast checks for dark theme.
- Empty/error/loading behavior checks for each mode.
- Mobile viewport pass.

Definition of done:
- All modes pass a manual script:
  - Baseline
  - HITL-R
  - HITL-G
  - HITL-Full

## Event Logging Hooks (UI Side)
- Emit typed events on:
  - node select/reject/reorder
  - summary edit submit
  - hallucination flag add/remove
  - questionnaire submit
  - phase transition confirm
- Store event payload shape with timestamp and task/session IDs.

## Suggested Implementation Order (This Session)
1. Phase 1 theming and layout tokenization.
2. Phase 3 SectionSelector UX improvements.
3. Phase 4 EditableSummary UX improvements.
4. Add PhaseTransition/Questionnaire message types.

## Risks + Mitigation
- Risk: PageIndex retrieval instability blocks end-to-end tests.
  - Mitigation: keep `ENABLE_MOCK_FALLBACK=true` for UI development lanes.
- Risk: Inline styling slows iteration consistency.
  - Mitigation: centralize all style tokens in `index.css` and component class patterns.
- Risk: Complex HITL states produce invalid transitions.
  - Mitigation: enforce guard rails in `studyStore` before each state mutation.

## Success Criteria
- UI resembles PageIndex Chat quality/feel.
- All HITL controls operate inside chat stream.
- Full study flow can be demonstrated with either real retrieval or mock fallback.
