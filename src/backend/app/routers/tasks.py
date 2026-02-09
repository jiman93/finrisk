from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.db.database import get_db
from app.models.task import Task
from app.schemas.task import (
    CompleteTaskResponse,
    EditSummaryRequest,
    EditSummaryResponse,
    GenerateRequest,
    GenerateResponse,
    QueryRequest,
    QueryResponse,
    RetrievalNode,
    SelectNodesRequest,
    SelectNodesResponse,
)
from app.services.llm_service import LLMService, LLMServiceError
from app.services.mock_pipeline import (
    MockRetrievalError,
    mock_pageindex_retrieval,
    mock_summary,
)
from app.services.pageindex_service import PageIndexError, PageIndexService

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

pageindex_service = PageIndexService()
llm_service = LLMService()


@router.post("/{task_id}/query", response_model=QueryResponse)
def query_task(task_id: str, payload: QueryRequest, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    query = payload.query or task.query_text
    task.query_text = query
    retrieval_id: str | None = None
    try:
        retrieval = pageindex_service.retrieve(task.ticker, query)
        nodes = retrieval.nodes
        retrieval_id = retrieval.retrieval_id
    except PageIndexError:
        if not settings.enable_mock_fallback:
            raise HTTPException(status_code=503, detail="PageIndex retrieval failed and fallback is disabled")
        try:
            mock_retrieval = mock_pageindex_retrieval(task.ticker, query)
        except MockRetrievalError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        nodes = mock_retrieval.nodes
        retrieval_id = mock_retrieval.retrieval_id

    if not nodes:
        if not settings.enable_mock_fallback:
            raise HTTPException(status_code=502, detail="Retrieval returned no nodes")
        try:
            mock_retrieval = mock_pageindex_retrieval(task.ticker, query)
        except MockRetrievalError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        nodes = mock_retrieval.nodes
        retrieval_id = mock_retrieval.retrieval_id

    task.retrieved_nodes = [node.model_dump() for node in nodes]
    if retrieval_id:
        task.pageindex_retrieval_id = retrieval_id
    task.retrieval_completed_at = datetime.utcnow()
    db.commit()
    db.refresh(task)

    return QueryResponse(
        status="completed",
        task_id=task.id,
        retrieved_nodes=nodes,
        retrieval_completed_at=task.retrieval_completed_at,
    )


@router.post("/{task_id}/generate", response_model=GenerateResponse)
def generate_summary(task_id: str, payload: GenerateRequest, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not task.retrieved_nodes:
        raise HTTPException(status_code=400, detail="Run retrieval before generation")

    selected_ids = (
        payload.selected_node_ids
        or task.selected_node_ids
        or [node["node_id"] for node in task.retrieved_nodes]
    )
    selected_nodes = [node for node in task.retrieved_nodes if node["node_id"] in selected_ids]
    if not selected_nodes:
        raise HTTPException(status_code=400, detail="No nodes selected for generation")

    nodes = [RetrievalNode(**node) for node in selected_nodes]
    try:
        summary = llm_service.generate_summary(task.ticker, task.query_text, nodes)
    except LLMServiceError:
        if not settings.enable_mock_fallback:
            raise HTTPException(status_code=503, detail="LLM generation failed and fallback is disabled")
        summary = mock_summary(task.ticker, task.query_text, nodes)

    task.selected_node_ids = selected_ids
    task.generated_summary = summary
    task.generation_completed_at = datetime.utcnow()
    db.commit()
    db.refresh(task)

    return GenerateResponse(
        task_id=task.id,
        summary=summary,
        used_node_ids=selected_ids,
        generation_completed_at=task.generation_completed_at,
    )


@router.post("/{task_id}/select-nodes", response_model=SelectNodesResponse)
def select_nodes(task_id: str, payload: SelectNodesRequest, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not task.retrieved_nodes:
        raise HTTPException(status_code=400, detail="Run retrieval before selecting nodes")

    ordered_selected = [node_id for node_id in payload.selection_order if node_id in payload.selected_node_ids]
    task.selected_node_ids = ordered_selected
    task.rejected_node_ids = payload.rejected_node_ids
    db.commit()
    db.refresh(task)
    return SelectNodesResponse(
        task_id=task.id,
        selected_node_ids=task.selected_node_ids or [],
        rejected_node_ids=task.rejected_node_ids or [],
    )


@router.post("/{task_id}/edit-summary", response_model=EditSummaryResponse)
def edit_summary(task_id: str, payload: EditSummaryRequest, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not task.generated_summary:
        raise HTTPException(status_code=400, detail="Generate summary before editing")

    original = task.generated_summary
    edited = payload.edited_text
    characters_edited = abs(len(edited) - len(original))

    task.edited_summary = edited
    task.characters_edited = characters_edited
    task.flagged_spans = [span.model_dump() for span in payload.flagged_spans]
    task.edit_completed_at = datetime.utcnow()
    db.commit()
    db.refresh(task)

    return EditSummaryResponse(
        task_id=task.id,
        edited_summary=task.edited_summary,
        characters_edited=task.characters_edited or 0,
        hallucinations_flagged=len(task.flagged_spans or []),
        edit_completed_at=task.edit_completed_at,
    )


@router.post("/{task_id}/complete", response_model=CompleteTaskResponse)
def complete_task(task_id: str, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.completed_at = datetime.utcnow()
    task.time_on_task_seconds = int((task.completed_at - task.started_at).total_seconds())
    db.commit()
    db.refresh(task)
    return CompleteTaskResponse(
        task_id=task.id,
        completed_at=task.completed_at,
        time_on_task_seconds=task.time_on_task_seconds,
    )
