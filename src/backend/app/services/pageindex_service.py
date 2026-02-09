import time
from dataclasses import dataclass

import httpx

from app.config import settings
from app.schemas.task import RetrievalNode


class PageIndexError(RuntimeError):
    pass


@dataclass
class RetrievalResult:
    retrieval_id: str
    nodes: list[RetrievalNode]


def normalize_pageindex_nodes(ticker: str, raw_nodes: list[dict]) -> list[RetrievalNode]:
    normalized: list[RetrievalNode] = []
    for raw in raw_nodes:
        node_id = str(raw.get("node_id") or "")
        title = str(raw.get("title") or "Untitled Section")

        relevant_contents = raw.get("relevant_contents") or []
        if not relevant_contents:
            text = str(raw.get("text") or "")
            page_index = int(raw.get("page_index") or 0)
            if text:
                normalized.append(
                    RetrievalNode(
                        node_id=node_id or f"{ticker}-{len(normalized)+1:03d}",
                        title=title,
                        page_index=page_index,
                        relevant_content=text,
                    )
                )
            continue

        for idx, content in enumerate(relevant_contents, start=1):
            relevant_content = str(content.get("relevant_content") or "")
            page_index = int(content.get("page_index") or raw.get("page_index") or 0)
            if not relevant_content:
                continue
            normalized.append(
                RetrievalNode(
                    node_id=f"{node_id}:{idx}" if node_id else f"{ticker}-{len(normalized)+1:03d}",
                    title=title,
                    page_index=page_index,
                    relevant_content=relevant_content,
                )
            )
    return normalized


class PageIndexService:
    def __init__(self) -> None:
        self.base_url = settings.pageindex_base_url.rstrip("/")
        self.api_key = settings.pageindex_api_key
        self.poll_interval_seconds = settings.pageindex_poll_interval_seconds
        self.poll_timeout_seconds = settings.pageindex_poll_timeout_seconds
        self.enable_thinking = settings.pageindex_enable_thinking
        self.doc_map = self._parse_doc_map(settings.pageindex_doc_map)

    @staticmethod
    def _parse_doc_map(raw: str) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for item in [part.strip() for part in raw.split(",") if part.strip()]:
            if ":" not in item:
                continue
            ticker, doc_id = item.split(":", 1)
            mapping[ticker.strip().upper()] = doc_id.strip()
        return mapping

    def has_credentials(self) -> bool:
        return bool(self.api_key and self.doc_map)

    def get_doc_id(self, ticker: str) -> str:
        doc_id = self.doc_map.get(ticker.upper())
        if not doc_id:
            raise PageIndexError(f"No PageIndex doc_id configured for ticker {ticker}")
        return doc_id

    def retrieve(self, ticker: str, query: str) -> RetrievalResult:
        if not self.api_key:
            raise PageIndexError("PAGEINDEX_API_KEY is not configured")
        doc_id = self.get_doc_id(ticker)

        headers = {"api_key": self.api_key}
        payload = {"doc_id": doc_id, "query": query}
        if self.enable_thinking:
            payload["thinking"] = True

        try:
            with httpx.Client(timeout=30) as client:
                submit = client.post(f"{self.base_url}/retrieval/", headers=headers, json=payload)
                if submit.status_code == 403 and self.enable_thinking:
                    detail = submit.json().get("detail", "")
                    if str(detail).lower() == "limitreached":
                        # Graceful downgrade to standard retrieval when thinking quota is exhausted.
                        payload.pop("thinking", None)
                        submit = client.post(f"{self.base_url}/retrieval/", headers=headers, json=payload)

                submit.raise_for_status()
                retrieval_id = submit.json().get("retrieval_id")
                if not retrieval_id:
                    raise PageIndexError("PageIndex retrieval response missing retrieval_id")

                deadline = time.time() + self.poll_timeout_seconds
                while time.time() < deadline:
                    poll = client.get(f"{self.base_url}/retrieval/{retrieval_id}/", headers=headers)
                    poll.raise_for_status()
                    data = poll.json()
                    status = data.get("status")
                    if status == "completed":
                        return RetrievalResult(
                            retrieval_id=retrieval_id,
                            nodes=normalize_pageindex_nodes(ticker, data.get("retrieved_nodes", [])),
                        )
                    if status in {"failed", "error"}:
                        raise PageIndexError(f"PageIndex retrieval failed (status={status})")
                    time.sleep(self.poll_interval_seconds)
        except httpx.HTTPError as exc:
            raise PageIndexError(f"PageIndex HTTP error: {exc}") from exc

        raise PageIndexError("PageIndex retrieval polling timed out")
