from pydantic import BaseModel

from app.schemas.synthetic import SyntheticRetrievedNode


class StreamEventBase(BaseModel):
    type: str
    run_id: str
    timestamp: str


class RunStartedEvent(StreamEventBase):
    query: str
    ticker: str
    scenario: str


class AssistantMessageEvent(StreamEventBase):
    message_id: str
    content: str


class StepStartedEvent(StreamEventBase):
    step_id: str
    label: str


class StepCompletedEvent(StreamEventBase):
    step_id: str
    label: str
    duration_ms: int
    metadata: dict


class StepFailedEvent(StreamEventBase):
    step_id: str
    label: str
    duration_ms: int
    error: str
    status_code: int


class RetrievalNodesEvent(StreamEventBase):
    retrieval_id: str
    doc_id: str
    nodes: list[SyntheticRetrievedNode]


class FinalAnswerEvent(StreamEventBase):
    retrieval_id: str
    generation_id: str
    summary: str
    citations: list[str]


class RunCompletedEvent(StreamEventBase):
    retrieval_id: str
    generation_id: str


class RunFailedEvent(StreamEventBase):
    error: str
    status_code: int
