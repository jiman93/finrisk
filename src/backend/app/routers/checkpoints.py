from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.checkpoint_definition import CheckpointDefinition
from app.models.checkpoint_instance import CheckpointInstance
from app.models.enums import CheckpointPipelinePosition
from app.schemas.checkpoint import (
    CheckpointDefinitionResponse,
    CheckpointDefinitionCreateRequest,
    CheckpointInstanceResponse,
    CheckpointDefinitionUpdateRequest,
    CheckpointFieldTypeResponse,
    CheckpointSubmitRequest,
    CheckpointToggleRequest,
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
    timeout_checkpoint_instance,
    validate_submission,
)

router = APIRouter(tags=["checkpoints"])

SUPPORTED_FIELD_TYPES: tuple[CheckpointFieldTypeResponse, ...] = (
    CheckpointFieldTypeResponse(type="text", label="Text", description="Single-line text input."),
    CheckpointFieldTypeResponse(
        type="textarea", label="Textarea", description="Multi-line text input."
    ),
    CheckpointFieldTypeResponse(
        type="select", label="Select", description="Single select dropdown using options."
    ),
    CheckpointFieldTypeResponse(
        type="multi_select",
        label="Multi Select",
        description="Multiple selection using options.",
    ),
    CheckpointFieldTypeResponse(
        type="checkbox", label="Checkbox", description="Single boolean choice."
    ),
    CheckpointFieldTypeResponse(
        type="radio", label="Radio", description="Single choice from radio options."
    ),
    CheckpointFieldTypeResponse(
        type="number", label="Number", description="Numeric input with optional min/max."
    ),
    CheckpointFieldTypeResponse(
        type="range", label="Range", description="Numeric range input with optional min/max."
    ),
    CheckpointFieldTypeResponse(
        type="chips",
        label="Chips",
        description="Chip/tag multi-select from options or comma-separated input.",
    ),
)


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
        max_retries=definition.max_retries,
        attempt_count=instance.attempt_count,
        last_error=instance.last_error,
        offered_at=instance.offered_at,
        submitted_at=instance.submitted_at,
    )


def _to_validation_issue(issue: ValidationIssue) -> CheckpointValidationIssue:
    return CheckpointValidationIssue(key=issue.key, message=issue.message)


def _normalize_modes(modes: list[str] | None) -> list[str]:
    if not modes:
        return ["*"]
    normalized = [mode.strip() for mode in modes if mode.strip()]
    return normalized or ["*"]


def _field_schema_to_json(field_schema: list[FieldDefinition]) -> list[dict]:
    return [field.model_dump(exclude_none=True) for field in field_schema]


def _update_definition_from_payload(
    definition: CheckpointDefinition,
    payload: CheckpointDefinitionUpdateRequest,
) -> None:
    data = payload.model_dump(exclude_unset=True)
    if "field_schema" in data and data["field_schema"] is not None:
        definition.field_schema = _field_schema_to_json(payload.field_schema or [])
    if "applicable_modes" in data and data["applicable_modes"] is not None:
        definition.applicable_modes = _normalize_modes(payload.applicable_modes)
    if "label" in data:
        definition.label = payload.label or definition.label
    if "description" in data and payload.description is not None:
        definition.description = payload.description
    if "pipeline_position" in data and payload.pipeline_position is not None:
        definition.pipeline_position = payload.pipeline_position
    if "sort_order" in data and payload.sort_order is not None:
        definition.sort_order = payload.sort_order
    if "required" in data and payload.required is not None:
        definition.required = payload.required
    if "timeout_seconds" in data:
        definition.timeout_seconds = payload.timeout_seconds
    if "max_retries" in data and payload.max_retries is not None:
        definition.max_retries = payload.max_retries
    if "circuit_breaker_threshold" in data and payload.circuit_breaker_threshold is not None:
        definition.circuit_breaker_threshold = payload.circuit_breaker_threshold
    if (
        "circuit_breaker_window_minutes" in data
        and payload.circuit_breaker_window_minutes is not None
    ):
        definition.circuit_breaker_window_minutes = payload.circuit_breaker_window_minutes
    if "enabled" in data and payload.enabled is not None:
        definition.enabled = payload.enabled


def _raise_value_error(exc: ValueError) -> None:
    message = str(exc)
    if "not found" in message.lower():
        raise HTTPException(status_code=404, detail=message) from exc
    raise HTTPException(status_code=400, detail=message) from exc


@router.get(
    "/api/checkpoints/field-types",
    response_model=list[CheckpointFieldTypeResponse],
)
def list_checkpoint_field_types():
    return list(SUPPORTED_FIELD_TYPES)


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


@router.post(
    "/api/checkpoints/definitions",
    response_model=CheckpointDefinitionResponse,
    status_code=201,
)
def create_checkpoint_definition(
    payload: CheckpointDefinitionCreateRequest,
    db: Session = Depends(get_db),
):
    existing = db.scalar(
        select(CheckpointDefinition).where(
            CheckpointDefinition.control_type == payload.control_type
        )
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Checkpoint control_type '{payload.control_type}' already exists",
        )

    definition = CheckpointDefinition(
        control_type=payload.control_type,
        label=payload.label,
        description=payload.description,
        field_schema=_field_schema_to_json(payload.field_schema),
        pipeline_position=payload.pipeline_position,
        sort_order=payload.sort_order,
        applicable_modes=_normalize_modes(payload.applicable_modes),
        required=payload.required,
        timeout_seconds=payload.timeout_seconds,
        max_retries=payload.max_retries,
        circuit_breaker_threshold=payload.circuit_breaker_threshold,
        circuit_breaker_window_minutes=payload.circuit_breaker_window_minutes,
        enabled=payload.enabled,
    )
    db.add(definition)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Duplicate checkpoint control_type") from exc
    db.refresh(definition)
    return _to_definition_response(definition)


@router.get(
    "/api/checkpoints/definitions/{definition_id}",
    response_model=CheckpointDefinitionResponse,
)
def get_checkpoint_definition(
    definition_id: str,
    db: Session = Depends(get_db),
):
    definition = db.get(CheckpointDefinition, definition_id)
    if not definition:
        raise HTTPException(status_code=404, detail="Checkpoint definition not found")
    return _to_definition_response(definition)


@router.put(
    "/api/checkpoints/definitions/{definition_id}",
    response_model=CheckpointDefinitionResponse,
)
def update_checkpoint_definition(
    definition_id: str,
    payload: CheckpointDefinitionUpdateRequest,
    db: Session = Depends(get_db),
):
    definition = db.get(CheckpointDefinition, definition_id)
    if not definition:
        raise HTTPException(status_code=404, detail="Checkpoint definition not found")

    _update_definition_from_payload(definition, payload)
    db.commit()
    db.refresh(definition)
    return _to_definition_response(definition)


@router.post(
    "/api/checkpoints/definitions/{definition_id}/toggle",
    response_model=CheckpointDefinitionResponse,
)
def toggle_checkpoint_definition(
    definition_id: str,
    payload: CheckpointToggleRequest,
    db: Session = Depends(get_db),
):
    definition = db.get(CheckpointDefinition, definition_id)
    if not definition:
        raise HTTPException(status_code=404, detail="Checkpoint definition not found")

    definition.enabled = payload.enabled
    db.commit()
    db.refresh(definition)
    return _to_definition_response(definition)


@router.delete(
    "/api/checkpoints/definitions/{definition_id}",
    response_model=CheckpointDefinitionResponse,
)
def delete_checkpoint_definition(
    definition_id: str,
    db: Session = Depends(get_db),
):
    definition = db.get(CheckpointDefinition, definition_id)
    if not definition:
        raise HTTPException(status_code=404, detail="Checkpoint definition not found")

    definition.enabled = False
    db.commit()
    db.refresh(definition)
    return _to_definition_response(definition)


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


@router.post(
    "/api/tasks/{task_id}/checkpoints/{instance_id}/timeout",
    response_model=CheckpointInstanceResponse,
)
def timeout_task_checkpoint(
    task_id: str,
    instance_id: str,
    db: Session = Depends(get_db),
):
    try:
        definition, instance = timeout_checkpoint_instance(
            db,
            task_id=task_id,
            instance_id=instance_id,
        )
    except ValueError as exc:
        _raise_value_error(exc)
    db.commit()
    return _to_instance_response(definition, instance)
