from pydantic import BaseModel, Field


class SyntheticRelevantContent(BaseModel):
    page_index: int
    relevant_content: str


class SyntheticRetrievedNode(BaseModel):
    title: str
    node_id: str
    relevant_contents: list[SyntheticRelevantContent]


class SyntheticRetrieveRequest(BaseModel):
    query: str = Field(min_length=1)
    ticker: str = "MSFT"
    scenario: str | None = None


class SyntheticRetrieveResponse(BaseModel):
    retrieval_id: str
    doc_id: str
    status: str
    query: str
    scenario: str
    latency_ms: int
    retrieved_nodes: list[SyntheticRetrievedNode]


class SyntheticGenerateRequest(BaseModel):
    query: str = Field(min_length=1)
    ticker: str = "MSFT"
    retrieval_id: str
    doc_id: str
    scenario: str | None = None
    retrieved_nodes: list[SyntheticRetrievedNode]


class SyntheticGenerateResponse(BaseModel):
    generation_id: str
    retrieval_id: str
    status: str
    scenario: str
    latency_ms: int
    summary: str
    citations: list[str]
