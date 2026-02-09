import random
import time
from uuid import uuid4

from app.config import settings
from app.schemas.synthetic import (
    SyntheticGenerateRequest,
    SyntheticGenerateResponse,
    SyntheticRelevantContent,
    SyntheticRetrieveRequest,
    SyntheticRetrieveResponse,
    SyntheticRetrievedNode,
)
from app.services.mock_pipeline import mock_summary
from app.services.mock_retrieval_engine import MockRetrievalEngine, MockRetrievalError
from app.services.pageindex_service import normalize_pageindex_nodes


class SyntheticPipelineService:
    def __init__(self) -> None:
        self.seed_salt = settings.mock_seed_salt

    def retrieve(self, request: SyntheticRetrieveRequest) -> SyntheticRetrieveResponse:
        scenario = (request.scenario or settings.mock_retrieval_scenario).strip().lower()
        engine = MockRetrievalEngine(scenario=scenario, seed_salt=self.seed_salt)

        start = time.perf_counter()
        self._sleep_ms(
            minimum=settings.synthetic_retrieval_latency_min_ms,
            maximum=settings.synthetic_retrieval_latency_max_ms,
        )

        result = engine.retrieve(request.ticker, request.query)
        latency_ms = int((time.perf_counter() - start) * 1000)

        retrieved_nodes = [
            SyntheticRetrievedNode(
                title=str(node.get("title") or "Untitled Section"),
                node_id=str(node.get("node_id") or ""),
                relevant_contents=[
                    SyntheticRelevantContent(
                        page_index=int(content.get("page_index") or 0),
                        relevant_content=str(content.get("relevant_content") or ""),
                    )
                    for content in node.get("relevant_contents") or []
                    if str(content.get("relevant_content") or "").strip()
                ],
            )
            for node in result.raw_nodes
        ]
        retrieved_nodes = [node for node in retrieved_nodes if node.relevant_contents]

        return SyntheticRetrieveResponse(
            retrieval_id=result.retrieval_id,
            doc_id=result.doc_id,
            status=result.status,
            query=result.query,
            scenario=result.scenario,
            latency_ms=latency_ms,
            retrieved_nodes=retrieved_nodes,
        )

    def generate(self, request: SyntheticGenerateRequest) -> SyntheticGenerateResponse:
        scenario = (request.scenario or settings.mock_retrieval_scenario).strip().lower()
        start = time.perf_counter()
        self._sleep_ms(
            minimum=settings.synthetic_generation_latency_min_ms,
            maximum=settings.synthetic_generation_latency_max_ms,
        )

        raw_nodes = [
            {
                "title": node.title,
                "node_id": node.node_id,
                "relevant_contents": [
                    {
                        "page_index": content.page_index,
                        "relevant_content": content.relevant_content,
                    }
                    for content in node.relevant_contents
                ],
            }
            for node in request.retrieved_nodes
        ]
        normalized = normalize_pageindex_nodes(request.ticker, raw_nodes)
        summary = mock_summary(request.ticker, request.query, normalized)
        citations = self._extract_citations(request.retrieved_nodes)
        latency_ms = int((time.perf_counter() - start) * 1000)

        return SyntheticGenerateResponse(
            generation_id=f"gen-mock-{uuid4().hex[:18]}",
            retrieval_id=request.retrieval_id,
            status="completed",
            scenario=scenario,
            latency_ms=latency_ms,
            summary=summary,
            citations=citations,
        )

    @staticmethod
    def _sleep_ms(minimum: int, maximum: int) -> None:
        lower = max(0, minimum)
        upper = max(lower, maximum)
        duration_ms = random.randint(lower, upper)
        time.sleep(duration_ms / 1000.0)

    @staticmethod
    def _extract_citations(nodes: list[SyntheticRetrievedNode]) -> list[str]:
        citations: list[str] = []
        seen = set()
        for node in nodes:
            for content in node.relevant_contents:
                citation = f"[{node.title}, Page {content.page_index}]"
                if citation in seen:
                    continue
                seen.add(citation)
                citations.append(citation)
        return citations


__all__ = ["MockRetrievalError", "SyntheticPipelineService"]
