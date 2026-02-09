from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.config import settings
from app.schemas.synthetic import (
    SyntheticGenerateRequest,
    SyntheticGenerateResponse,
    SyntheticRetrieveRequest,
    SyntheticRetrieveResponse,
)
from app.services.mock_retrieval_engine import MockRetrievalError
from app.services.synthetic_pipeline import SyntheticPipelineService
from app.services.synthetic_stream import SyntheticStreamService

router = APIRouter(prefix="/api/synthetic", tags=["synthetic"])

synthetic_pipeline = SyntheticPipelineService()
synthetic_stream = SyntheticStreamService()


def _ensure_enabled() -> None:
    if not settings.synthetic_enabled:
        raise HTTPException(status_code=404, detail="Synthetic pipeline is disabled")


@router.post("/retrieve", response_model=SyntheticRetrieveResponse)
def synthetic_retrieve(payload: SyntheticRetrieveRequest):
    _ensure_enabled()
    try:
        return synthetic_pipeline.retrieve(payload)
    except MockRetrievalError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post("/generate", response_model=SyntheticGenerateResponse)
def synthetic_generate(payload: SyntheticGenerateRequest):
    _ensure_enabled()
    if not payload.retrieved_nodes:
        raise HTTPException(status_code=400, detail="retrieved_nodes cannot be empty")
    return synthetic_pipeline.generate(payload)


@router.get("/chat/stream")
def synthetic_chat_stream(
    query: str = Query(..., min_length=1),
    ticker: str = Query(default="MSFT"),
    scenario: str | None = Query(default=None),
):
    _ensure_enabled()
    return StreamingResponse(
        synthetic_stream.stream(query=query, ticker=ticker, scenario=scenario),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
