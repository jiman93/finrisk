from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.checkpoint_definition import CheckpointDefinition
from app.models.checkpoint_instance import CheckpointInstance
from app.models.enums import CheckpointPipelinePosition
from app.schemas.checkpoint import (
    CheckpointDefinitionResponse,
    CheckpointInstanceResponse,
    CheckpointSubmitRequest,
    CheckpointValidationIssue,
    FieldDefinition,
    ResolvedCheckpointsResponse,
)
from app.services.checkpoint_resolver import (
    ValidationIssue,
    get_checkpoint_instance,
    resolve_checkpoints_for_task,
    retry_checkpoint_instance,
    skip_checkpoint_instance,
    submit_checkpoint_instance,
    validate_submission,
)

router = APIRouter(tags=["checkpoints"])


def _parse_field_schema(raw_schema: list[dict] | None) -> list[FieldDefinition]:
    if not raw_schema:
        return []
    return [FieldDefinition.model_validate(field) for field in raw_schema]


def _to_definition_response(definition: CheckpointDefinition) -> CheckpointDefinitionResponse:
    return CheckpointDefinitionResponse(
        id=definition.id,
        control_type=definition.control_type,
        label=definition.label,
        description=definition.description,
        field_schema=_parse_field_schema(definition.field_schema),
        pipeline_position=definition.pipeline_position,
        sort_order=definition.sort_order,
        applicable_modes=definition.applicable_modes or [],
        required=definition.required,
        timeout_seconds=definition.timeout_seconds,
        max_retries=definition.max_retries,
        circuit_breaker_threshold=definition.circuit_breaker_threshold,
        circuit_breaker_window_minutes=definition.circuit_breaker_window_minutes,
        enabled=definition.enabled,
        created_at=definition.created_at,
        updated_at=definition.updated_at,
    )


def _to_instance_response(
    definition: CheckpointDefinition,
    instance: CheckpointInstance,
) -> CheckpointInstanceResponse:
    return CheckpointInstanceResponse(
        id=instance.id,
        task_id=instance.task_id,
        definition_id=instance.definition_id,
        control_type=instance.control_type,
        label=definition.label,
        state=instance.state,
        field_schema=_parse_field_schema(definition.field_schema),
        payload=instance.payload,
        submit_result=instance.submit_result,
        required=definition.required,
        timeout_seconds=definition.timeout_seconds,
        attempt_count=instance.attempt_count,
        last_error=instance.last_error,
        offered_at=instance.offered_at,
        submitted_at=instance.submitted_at,
    )


def _to_validation_issue(issue: ValidationIssue) -> CheckpointValidationIssue:
    return CheckpointValidationIssue(key=issue.key, message=issue.message)


def _raise_value_error(exc: ValueError) -> None:
    message = str(exc)
    if "not found" in message.lower():
        raise HTTPException(status_code=404, detail=message) from exc
    raise HTTPException(status_code=400, detail=message) from exc


@router.get(
    "/api/checkpoints/definitions",
    response_model=list[CheckpointDefinitionResponse],
)
def list_checkpoint_definitions(
    enabled_only: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    stmt = select(CheckpointDefinition)
    if enabled_only:
        stmt = stmt.where(CheckpointDefinition.enabled.is_(True))
    definitions = db.scalars(
        stmt.order_by(
            CheckpointDefinition.pipeline_position.asc(),
            CheckpointDefinition.sort_order.asc(),
            CheckpointDefinition.control_type.asc(),
        )
    ).all()
    return [_to_definition_response(definition) for definition in definitions]


@router.get(
    "/api/tasks/{task_id}/checkpoints",
    response_model=ResolvedCheckpointsResponse,
)
def resolve_task_checkpoints(
    task_id: str,
    pipeline_position: CheckpointPipelinePosition = Query(...),
    db: Session = Depends(get_db),
):
    try:
        resolved = resolve_checkpoints_for_task(
            db,
            task_id=task_id,
            pipeline_position=pipeline_position,
        )
    except ValueError as exc:
        _raise_value_error(exc)

    db.commit()
    return ResolvedCheckpointsResponse(
        task_id=task_id,
        pipeline_position=pipeline_position,
        checkpoints=[
            _to_instance_response(definition, instance)
            for definition, instance in resolved
        ],
    )


@router.get(
    "/api/tasks/{task_id}/checkpoints/{instance_id}",
    response_model=CheckpointInstanceResponse,
)
def get_task_checkpoint_instance(
    task_id: str,
    instance_id: str,
    db: Session = Depends(get_db),
):
    try:
        definition, instance = get_checkpoint_instance(
            db,
            task_id=task_id,
            instance_id=instance_id,
        )
    except ValueError as exc:
        _raise_value_error(exc)
    return _to_instance_response(definition, instance)


@router.post(
    "/api/tasks/{task_id}/checkpoints/{instance_id}/submit",
    response_model=CheckpointInstanceResponse,
)
def submit_task_checkpoint(
    task_id: str,
    instance_id: str,
    payload: CheckpointSubmitRequest,
    db: Session = Depends(get_db),
):
    try:
        definition, instance = get_checkpoint_instance(
            db,
            task_id=task_id,
            instance_id=instance_id,
        )
    except ValueError as exc:
        _raise_value_error(exc)

    issues = validate_submission(definition, payload.data)
    if issues:
        definition, instance = submit_checkpoint_instance(
            db,
            task_id=task_id,
            instance_id=instance_id,
            data=payload.data,
        )
        db.commit()
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Checkpoint submission validation failed",
                "issues": [_to_validation_issue(issue).model_dump() for issue in issues],
                "attempt_count": instance.attempt_count,
                "max_retries": definition.max_retries,
                "retry_available": instance.attempt_count < definition.max_retries,
            },
        )

    definition, instance = submit_checkpoint_instance(
        db,
        task_id=task_id,
        instance_id=instance_id,
        data=payload.data,
    )
    db.commit()
    return _to_instance_response(definition, instance)


@router.post(
    "/api/tasks/{task_id}/checkpoints/{instance_id}/skip",
    response_model=CheckpointInstanceResponse,
)
def skip_task_checkpoint(
    task_id: str,
    instance_id: str,
    db: Session = Depends(get_db),
):
    try:
        definition, instance = skip_checkpoint_instance(
            db,
            task_id=task_id,
            instance_id=instance_id,
        )
    except ValueError as exc:
        _raise_value_error(exc)
    db.commit()
    return _to_instance_response(definition, instance)


@router.post(
    "/api/tasks/{task_id}/checkpoints/{instance_id}/retry",
    response_model=CheckpointInstanceResponse,
)
def retry_task_checkpoint(
    task_id: str,
    instance_id: str,
    db: Session = Depends(get_db),
):
    try:
        definition, instance = retry_checkpoint_instance(
            db,
            task_id=task_id,
            instance_id=instance_id,
        )
    except ValueError as exc:
        _raise_value_error(exc)
    db.commit()
    return _to_instance_response(definition, instance)
