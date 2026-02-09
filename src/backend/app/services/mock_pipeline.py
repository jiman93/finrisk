from app.config import settings
from app.schemas.task import RetrievalNode
from app.services.mock_retrieval_engine import (
    MockRetrievalEngine,
    MockRetrievalError,
    MockRetrievalResult,
)


def mock_pageindex_retrieval(ticker: str, query: str) -> MockRetrievalResult:
    engine = MockRetrievalEngine(
        scenario=settings.mock_retrieval_scenario,
        seed_salt=settings.mock_seed_salt,
    )
    return engine.retrieve(ticker, query)


def mock_retrieval_nodes(ticker: str, query: str) -> list[RetrievalNode]:
    return mock_pageindex_retrieval(ticker, query).nodes


def mock_summary(ticker: str, query: str, nodes: list[RetrievalNode]) -> str:
    citations = []
    for node in nodes:
        citation = f"[{node.title}, Page {node.page_index}]"
        if citation not in citations:
            citations.append(citation)

    key_points = []
    for node in nodes[:5]:
        key_points.append(f"- {node.relevant_content} [{node.title}, Page {node.page_index}]")

    citations_line = " ".join(citations[:8]) if citations else "[No sources]"
    key_points_text = "\n".join(key_points) if key_points else "- No retrieved evidence available."

    return (
        f"Executive overview: For {ticker}, disclosures relevant to '{query}' indicate a multi-factor risk "
        "profile spanning operations, regulation, technology resilience, and external dependencies.\n\n"
        "Key disclosed risk signals:\n"
        f"{key_points_text}\n\n"
        "Potential impact:\n"
        "- Margin pressure from compliance and remediation costs.\n"
        "- Revenue and retention sensitivity if service reliability weakens.\n"
        "- Execution delays when supplier, regulatory, or macro conditions deteriorate.\n\n"
        f"Source attribution: {citations_line}"
    )


__all__ = [
    "MockRetrievalError",
    "MockRetrievalResult",
    "mock_pageindex_retrieval",
    "mock_retrieval_nodes",
    "mock_summary",
]
