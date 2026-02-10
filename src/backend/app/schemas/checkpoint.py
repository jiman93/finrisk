from datetime import datetime
from typing import Any

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
    max_retries: int
    attempt_count: int
    last_error: str | None
    offered_at: datetime | None
    submitted_at: datetime | None


class ResolvedCheckpointsResponse(BaseModel):
    task_id: str
    pipeline_position: CheckpointPipelinePosition
    checkpoints: list[CheckpointInstanceResponse] = Field(default_factory=list)


class CheckpointSubmitRequest(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)


class CheckpointValidationIssue(BaseModel):
    key: str
    message: str


class CheckpointDefinitionCreateRequest(BaseModel):
    control_type: str
    label: str
    description: str = ""
    field_schema: list[FieldDefinition] = Field(default_factory=list)
    pipeline_position: CheckpointPipelinePosition
    sort_order: int = 0
    applicable_modes: list[str] = Field(default_factory=lambda: ["*"])
    required: bool = False
    timeout_seconds: int | None = None
    max_retries: int = 2
    circuit_breaker_threshold: int = 5
    circuit_breaker_window_minutes: int = 60
    enabled: bool = True


class CheckpointDefinitionUpdateRequest(BaseModel):
    label: str | None = None
    description: str | None = None
    field_schema: list[FieldDefinition] | None = None
    pipeline_position: CheckpointPipelinePosition | None = None
    sort_order: int | None = None
    applicable_modes: list[str] | None = None
    required: bool | None = None
    timeout_seconds: int | None = None
    max_retries: int | None = None
    circuit_breaker_threshold: int | None = None
    circuit_breaker_window_minutes: int | None = None
    enabled: bool | None = None


class CheckpointToggleRequest(BaseModel):
    enabled: bool


class CheckpointFieldTypeResponse(BaseModel):
    type: str
    label: str
    description: str
