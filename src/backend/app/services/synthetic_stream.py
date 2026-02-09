from __future__ import annotations

from datetime import UTC, datetime
import json
import random
import time
from typing import Iterator
from uuid import uuid4

from app.config import settings
from app.schemas.synthetic import (
    SyntheticGenerateRequest,
    SyntheticRetrievedNode,
    SyntheticRetrieveRequest,
)
from app.services.mock_retrieval_engine import MockRetrievalError
from app.services.synthetic_pipeline import SyntheticPipelineService


class SyntheticStreamService:
    def __init__(self) -> None:
        self.pipeline = SyntheticPipelineService()

    def stream(self, query: str, ticker: str, scenario: str | None = None) -> Iterator[str]:
        scenario_name = (scenario or settings.mock_retrieval_scenario).strip().lower()
        run_id = f"run-mock-{uuid4().hex[:12]}"
        message_id = f"msg-{uuid4().hex[:10]}"

        yield self._sse(
            {
                "type": "run_started",
                "run_id": run_id,
                "timestamp": self._ts(),
                "query": query,
                "ticker": ticker,
                "scenario": scenario_name,
            }
        )
        yield self._sse(
            {
                "type": "assistant_message",
                "run_id": run_id,
                "timestamp": self._ts(),
                "message_id": message_id,
                "content": (
                    "I'll help you find relevant information from this document. "
                    "Let me check the structure first, then retrieve key sections before synthesizing the answer."
                ),
            }
        )

        structure_step = "step-document-structure"
        step_start = time.perf_counter()
        yield self._step_started(run_id, structure_step, "Get document structure")
        self._sleep_ms(220, 540)
        yield self._step_completed(
            run_id,
            structure_step,
            "Get document structure",
            step_start,
            {"sections_scanned": random.randint(18, 34)},
        )

        retrieve_req = SyntheticRetrieveRequest(query=query, ticker=ticker, scenario=scenario_name)

        retrieval_step_1 = "step-page-content-1"
        step_start = time.perf_counter()
        yield self._step_started(run_id, retrieval_step_1, "Get page content")
        try:
            retrieval = self.pipeline.retrieve(retrieve_req)
        except MockRetrievalError as exc:
            yield self._step_failed(
                run_id,
                retrieval_step_1,
                "Get page content",
                step_start,
                str(exc),
                exc.status_code,
            )
            yield self._run_failed(run_id, str(exc), exc.status_code)
            return
        yield self._step_completed(
            run_id,
            retrieval_step_1,
            "Get page content",
            step_start,
            {"latency_ms": retrieval.latency_ms, "node_count": len(retrieval.retrieved_nodes)},
        )

        first_batch, second_batch = self._split_nodes(retrieval.retrieved_nodes)
        if first_batch:
            yield self._sse(
                {
                    "type": "retrieval_nodes",
                    "run_id": run_id,
                    "timestamp": self._ts(),
                    "retrieval_id": retrieval.retrieval_id,
                    "doc_id": retrieval.doc_id,
                    "nodes": [node.model_dump() for node in first_batch],
                }
            )

        if second_batch:
            retrieval_step_2 = "step-page-content-2"
            step_start = time.perf_counter()
            yield self._step_started(run_id, retrieval_step_2, "Get page content")
            self._sleep_ms(260, 620)
            yield self._step_completed(
                run_id,
                retrieval_step_2,
                "Get page content",
                step_start,
                {"node_count": len(second_batch), "pass": 2},
            )
            yield self._sse(
                {
                    "type": "retrieval_nodes",
                    "run_id": run_id,
                    "timestamp": self._ts(),
                    "retrieval_id": retrieval.retrieval_id,
                    "doc_id": retrieval.doc_id,
                    "nodes": [node.model_dump() for node in second_batch],
                }
            )

        if not retrieval.retrieved_nodes:
            message = "No relevant sections were found for this query."
            yield self._run_failed(run_id, message, 422)
            return

        generation_step = "step-synthesize-answer"
        step_start = time.perf_counter()
        yield self._step_started(run_id, generation_step, "Synthesize answer")
        generation = self.pipeline.generate(
            SyntheticGenerateRequest(
                query=query,
                ticker=ticker,
                retrieval_id=retrieval.retrieval_id,
                doc_id=retrieval.doc_id,
                scenario=scenario_name,
                retrieved_nodes=retrieval.retrieved_nodes,
            )
        )
        yield self._step_completed(
            run_id,
            generation_step,
            "Synthesize answer",
            step_start,
            {"latency_ms": generation.latency_ms, "citation_count": len(generation.citations)},
        )

        yield self._sse(
            {
                "type": "final_answer",
                "run_id": run_id,
                "timestamp": self._ts(),
                "retrieval_id": retrieval.retrieval_id,
                "generation_id": generation.generation_id,
                "summary": generation.summary,
                "citations": generation.citations,
            }
        )
        yield self._sse(
            {
                "type": "run_completed",
                "run_id": run_id,
                "timestamp": self._ts(),
                "retrieval_id": retrieval.retrieval_id,
                "generation_id": generation.generation_id,
            }
        )

    @staticmethod
    def _split_nodes(nodes: list[SyntheticRetrievedNode]) -> tuple[list[SyntheticRetrievedNode], list[SyntheticRetrievedNode]]:
        if not nodes:
            return [], []
        pivot = max(1, len(nodes) // 2)
        return nodes[:pivot], nodes[pivot:]

    @staticmethod
    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    @staticmethod
    def _ts() -> str:
        return datetime.now(UTC).isoformat()

    @staticmethod
    def _sleep_ms(minimum: int, maximum: int) -> None:
        lower = max(0, minimum)
        upper = max(lower, maximum)
        duration_ms = random.randint(lower, upper)
        time.sleep(duration_ms / 1000)

    def _step_started(self, run_id: str, step_id: str, label: str) -> str:
        return self._sse(
            {
                "type": "step_started",
                "run_id": run_id,
                "timestamp": self._ts(),
                "step_id": step_id,
                "label": label,
            }
        )

    def _step_completed(
        self,
        run_id: str,
        step_id: str,
        label: str,
        started_at: float,
        metadata: dict,
    ) -> str:
        duration_ms = int((time.perf_counter() - started_at) * 1000)
        return self._sse(
            {
                "type": "step_completed",
                "run_id": run_id,
                "timestamp": self._ts(),
                "step_id": step_id,
                "label": label,
                "duration_ms": duration_ms,
                "metadata": metadata,
            }
        )

    def _step_failed(
        self,
        run_id: str,
        step_id: str,
        label: str,
        started_at: float,
        error: str,
        status_code: int,
    ) -> str:
        duration_ms = int((time.perf_counter() - started_at) * 1000)
        return self._sse(
            {
                "type": "step_failed",
                "run_id": run_id,
                "timestamp": self._ts(),
                "step_id": step_id,
                "label": label,
                "duration_ms": duration_ms,
                "error": error,
                "status_code": status_code,
            }
        )

    def _run_failed(self, run_id: str, error: str, status_code: int) -> str:
        return self._sse(
            {
                "type": "run_failed",
                "run_id": run_id,
                "timestamp": self._ts(),
                "error": error,
                "status_code": status_code,
            }
        )
