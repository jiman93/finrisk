from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import CheckpointPipelinePosition, CheckpointState


class FieldOption(BaseModel):
    value: str
    label: str


class FieldDefinition(BaseModel):
    key: str
    type: str
    label: str
    required: bool = False
    placeholder: str | None = None
    options: list[FieldOption] | None = None
    min: float | None = None
    max: float | None = None
    default: str | int | float | bool | list[str] | None = None


class CheckpointDefinitionResponse(BaseModel):
    id: str
    control_type: str
    label: str
    description: str
    field_schema: list[FieldDefinition]
    pipeline_position: CheckpointPipelinePosition
    sort_order: int
    applicable_modes: list[str]
    required: bool
    timeout_seconds: int | None
    max_retries: int
    circuit_breaker_threshold: int
    circuit_breaker_window_minutes: int
    enabled: bool
    created_at: datetime
    updated_at: datetime


class CheckpointInstanceResponse(BaseModel):
    id: str
    task_id: str
    definition_id: str
    control_type: str
    label: str
    state: CheckpointState
    field_schema: list[FieldDefinition]
    payload: dict | None
    submit_result: dict | None
    required: bool
    timeout_seconds: int | None
    attempt_count: int
    last_error: str | None
    offered_at: datetime | None
    submitted_at: datetime | None


class ResolvedCheckpointsResponse(BaseModel):
    task_id: str
    pipeline_position: CheckpointPipelinePosition
    checkpoints: list[CheckpointInstanceResponse] = Field(default_factory=list)
