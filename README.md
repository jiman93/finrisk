# FinRisk HITL Prototype

This workspace contains a same-session MVP scaffold for the FinRisk HITL system.

## Structure

- `src/backend`: FastAPI service with session/task orchestration and real provider adapters (with mock fallback).
- `src/frontend`: React + Vite chat-style UI that drives baseline flow.
- `src/backend/migrations`: SQL migration files.
- `docs`: design and implementation references.

## Design Docs

- System framework: `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/docs/SYSTEM_DESIGN_FRAMEWORK.md`
- UI plan: `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/docs/UI_CHAT_HITL_PLAN.md`
- Multi-step stream plan: `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/docs/MULTI_STEP_CONVERSATIONAL_STREAM_PLAN.md`
- Mock retrieval workflow plan: `/Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/docs/MOCK_RETRIEVAL_WORKFLOW_PLAN.md`

## Quick start

1. Backend
```bash
cd /Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/src/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Swagger UI: `http://127.0.0.1:8000/swagger`
OpenAPI JSON: `http://127.0.0.1:8000/openapi.json`

2. Frontend
```bash
cd /Users/zulhafizzaini/Desktop/Programming/prototype/finrisk/src/frontend
npm install
npm run dev
```

3. Open the frontend:
- Click `Start Session` to run the current phase.
- Click `Next Phase` to move through Phase 2 and Phase 3.
- For `HITL-R` and `HITL-Full`, select nodes before generation.
- For `HITL-G` and `HITL-Full`, edit and submit the draft summary.

## Provider wiring

- Retrieval uses PageIndex when `PAGEINDEX_API_KEY` and `PAGEINDEX_DOC_MAP` are configured.
- Generation uses OpenAI when `OPENAI_API_KEY` is configured.
- If providers are not configured (or fail) and `ENABLE_MOCK_FALLBACK=true`, mock retrieval/generation is used.
- Set `ENABLE_MOCK_FALLBACK=false` to force hard failure when provider calls fail.
- Mock retrieval scenarios can be selected with `MOCK_RETRIEVAL_SCENARIO`:
  - `happy_path`
  - `slow_processing`
  - `empty_completed`
  - `failed_retrieval`
  - `limit_reached`
  - `mixed_relevance`
  - `long_context`
- Optional deterministic control: set `MOCK_SEED_SALT` to keep mock outputs stable across runs.
- Optional per-query override for quick testing:
  - `scenario:empty_completed::what are key risks?`
  - `scenario:failed_retrieval::what are key risks?`

## Synthetic Pipeline (UI Infra)

Use backend-only synthetic endpoints for UI iteration without PageIndex/OpenAI calls:

- `POST /api/synthetic/retrieve`
- `POST /api/synthetic/generate`
- `GET /api/synthetic/chat/stream?query=...&ticker=MSFT` (SSE multi-step conversational stream)

Environment knobs:
- `SYNTHETIC_ENABLED=true`
- `SYNTHETIC_RETRIEVAL_LATENCY_MIN_MS=450`
- `SYNTHETIC_RETRIEVAL_LATENCY_MAX_MS=1300`
- `SYNTHETIC_GENERATION_LATENCY_MIN_MS=650`
- `SYNTHETIC_GENERATION_LATENCY_MAX_MS=1700`
- `MOCK_RETRIEVAL_SCENARIO=happy_path` (or other supported scenarios)

## Environment

Copy `.env.example` to `.env` and update values as needed.

## EDGAR data ingest

Download 10-K HTML from SEC EDGAR:

```bash
cd /Users/zulhafizzaini/Desktop/Programming/prototype/finrisk
export SEC_USER_AGENT="Your Name your-email@example.com"
python3 scripts/download_10k_html.py --year 2024 --tickers MSFT AAPL TSLA JPM PFE WMT XOM BA
```

With layout-preserving PDF conversion (Playwright):

```bash
pip install -r scripts/requirements-data.txt
playwright install chromium
python3 scripts/download_10k_html.py --year 2024 --tickers MSFT AAPL TSLA JPM PFE WMT XOM BA --convert-pdf --pdf-renderer auto
```

If your local Python has TLS certificate issues, install `certifi` and retry, or use:

```bash
python3 scripts/download_10k_html.py --year 2024 --tickers MSFT --insecure-skip-tls-verify
```

If a ticker has no filing in the requested year, allow fallback to latest filing:

```bash
python3 scripts/download_10k_html.py --year 2024 --tickers JPM --allow-latest-if-missing-year
```

Outputs:
- HTML files: `data/10k_html/`
- PDF files: `data/10k_pdfs/`
- Manifest: `data/metadata/edgar_10k_manifest.json`

## PageIndex indexing

Submit generated PDFs to PageIndex and produce ticker -> `doc_id` mapping:

```bash
cd /Users/zulhafizzaini/Desktop/Programming/prototype/finrisk
export PAGEINDEX_API_KEY="your-pageindex-key"
python3 scripts/index_pageindex_documents.py --tickers MSFT
```

Batch all tickers:

```bash
python3 scripts/index_pageindex_documents.py
```

Outputs:
- Index manifest: `data/metadata/pageindex_index_manifest.json`
- Env snippet: `data/metadata/pageindex_doc_map.env` (contains `PAGEINDEX_DOC_MAP=...`)
