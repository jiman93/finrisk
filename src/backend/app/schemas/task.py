from datetime import datetime

from pydantic import BaseModel


class QueryRequest(BaseModel):
    query: str | None = None


class RetrievalNode(BaseModel):
    node_id: str
    title: str
    page_index: int
    relevant_content: str


class QueryResponse(BaseModel):
    status: str
    task_id: str
    retrieved_nodes: list[RetrievalNode]
    retrieval_completed_at: datetime


class GenerateRequest(BaseModel):
    selected_node_ids: list[str] | None = None


class GenerateResponse(BaseModel):
    task_id: str
    summary: str
    used_node_ids: list[str]
    generation_completed_at: datetime


class SelectNodesRequest(BaseModel):
    selected_node_ids: list[str]
    rejected_node_ids: list[str]
    selection_order: list[str]


class SelectNodesResponse(BaseModel):
    task_id: str
    selected_node_ids: list[str]
    rejected_node_ids: list[str]


class FlaggedSpan(BaseModel):
    start: int
    end: int
    text: str
    reason: str


class EditSummaryRequest(BaseModel):
    edited_text: str
    flagged_spans: list[FlaggedSpan] = []


class EditSummaryResponse(BaseModel):
    task_id: str
    edited_summary: str
    characters_edited: int
    hallucinations_flagged: int
    edit_completed_at: datetime


class CompleteTaskResponse(BaseModel):
    task_id: str
    completed_at: datetime
    time_on_task_seconds: int
