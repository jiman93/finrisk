from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.checkpoint_definition import CheckpointDefinition
from app.models.checkpoint_instance import CheckpointInstance
from app.models.enums import CheckpointPipelinePosition, CheckpointState
from app.models.task import Task


@dataclass
class ValidationIssue:
    key: str
    message: str


def _mode_is_applicable(definition: CheckpointDefinition, mode_value: str) -> bool:
    modes = definition.applicable_modes or []
    return "*" in modes or mode_value in modes


def get_checkpoint_instance(
    db: Session,
    *,
    task_id: str,
    instance_id: str,
) -> tuple[CheckpointDefinition, CheckpointInstance]:
    instance = db.scalar(
        select(CheckpointInstance).where(
            CheckpointInstance.id == instance_id,
            CheckpointInstance.task_id == task_id,
        )
    )
    if not instance:
        raise ValueError("Checkpoint instance not found")

    definition = db.get(CheckpointDefinition, instance.definition_id)
    if not definition:
        raise ValueError("Checkpoint definition not found")
    return definition, instance


def resolve_checkpoints_for_task(
    db: Session,
    *,
    task_id: str,
    pipeline_position: CheckpointPipelinePosition,
) -> list[tuple[CheckpointDefinition, CheckpointInstance]]:
    task = db.get(Task, task_id)
    if not task:
        raise ValueError("Task not found")

    mode_value = task.mode.value if hasattr(task.mode, "value") else str(task.mode)
    definitions = db.scalars(
        select(CheckpointDefinition)
        .where(
            CheckpointDefinition.enabled.is_(True),
            CheckpointDefinition.pipeline_position == pipeline_position,
        )
        .order_by(CheckpointDefinition.sort_order.asc(), CheckpointDefinition.control_type.asc())
    ).all()

    resolved: list[tuple[CheckpointDefinition, CheckpointInstance]] = []
    now = datetime.utcnow()
    for definition in definitions:
        if not _mode_is_applicable(definition, mode_value):
            continue

        instance = db.scalar(
            select(CheckpointInstance).where(
                CheckpointInstance.task_id == task.id,
                CheckpointInstance.definition_id == definition.id,
            )
        )

        if not instance:
            instance = CheckpointInstance(
                task_id=task.id,
                definition_id=definition.id,
                control_type=definition.control_type,
                state=CheckpointState.offered,
                offered_at=now,
            )
            db.add(instance)
            db.flush()
        elif instance.state == CheckpointState.pending:
            instance.state = CheckpointState.offered
            if not instance.offered_at:
                instance.offered_at = now

        resolved.append((definition, instance))

    return resolved


def validate_submission(
    definition: CheckpointDefinition,
    data: dict[str, Any],
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    field_schema = definition.field_schema or []
    expected_keys = {
        str(field.get("key") or "")
        for field in field_schema
        if str(field.get("key") or "").strip()
    }

    for key in data.keys():
        if key not in expected_keys:
            issues.append(ValidationIssue(key=key, message="Unexpected field"))

    for field in field_schema:
        key = str(field.get("key") or "").strip()
        if not key:
            continue

        field_type = str(field.get("type") or "").strip()
        required = bool(field.get("required") or False)
        value = data.get(key)

        if required and _is_empty_value(value):
            issues.append(ValidationIssue(key=key, message="This field is required"))
            continue
        if value is None:
            continue

        issues.extend(_validate_field_type(field, key, field_type, value))

    return issues


def submit_checkpoint_instance(
    db: Session,
    *,
    task_id: str,
    instance_id: str,
    data: dict[str, Any],
) -> tuple[CheckpointDefinition, CheckpointInstance]:
    definition, instance = get_checkpoint_instance(db, task_id=task_id, instance_id=instance_id)
    issues = validate_submission(definition, data)
    if issues:
        attempt_count = instance.attempt_count + 1
        issue_text = "; ".join(f"{issue.key}: {issue.message}" for issue in issues)
        instance.attempt_count = attempt_count
        instance.last_error = issue_text
        instance.state = CheckpointState.failed
        instance.failed_at = datetime.utcnow()
        return definition, instance

    instance.submit_result = data
    instance.state = CheckpointState.submitted
    instance.submitted_at = datetime.utcnow()
    instance.last_error = None
    return definition, instance


def skip_checkpoint_instance(
    db: Session,
    *,
    task_id: str,
    instance_id: str,
) -> tuple[CheckpointDefinition, CheckpointInstance]:
    definition, instance = get_checkpoint_instance(db, task_id=task_id, instance_id=instance_id)
    if definition.required:
        raise ValueError("Required checkpoints cannot be skipped")

    instance.state = CheckpointState.skipped
    instance.last_error = None
    return definition, instance


def retry_checkpoint_instance(
    db: Session,
    *,
    task_id: str,
    instance_id: str,
) -> tuple[CheckpointDefinition, CheckpointInstance]:
    definition, instance = get_checkpoint_instance(db, task_id=task_id, instance_id=instance_id)
    if instance.state not in {CheckpointState.failed, CheckpointState.timed_out, CheckpointState.skipped}:
        raise ValueError("Only failed, timed out, or skipped checkpoints can be retried")
    if instance.attempt_count >= definition.max_retries:
        raise ValueError("Retry limit reached")

    instance.state = CheckpointState.offered
    instance.last_error = None
    instance.failed_at = None
    instance.offered_at = datetime.utcnow()
    return definition, instance


def timeout_checkpoint_instance(
    db: Session,
    *,
    task_id: str,
    instance_id: str,
) -> tuple[CheckpointDefinition, CheckpointInstance]:
    definition, instance = get_checkpoint_instance(db, task_id=task_id, instance_id=instance_id)
    if instance.state in {CheckpointState.submitted, CheckpointState.skipped, CheckpointState.collapsed}:
        raise ValueError("Completed checkpoints cannot be timed out")

    instance.attempt_count = instance.attempt_count + 1
    instance.state = CheckpointState.timed_out
    instance.last_error = "Checkpoint timed out"
    instance.failed_at = datetime.utcnow()
    return definition, instance


def _is_empty_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


def _validate_field_type(
    field: dict[str, Any],
    key: str,
    field_type: str,
    value: Any,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    options = field.get("options") or []
    option_values = {
        str(option.get("value"))
        for option in options
        if isinstance(option, dict) and option.get("value") is not None
    }

    if field_type in {"text", "textarea"}:
        if not isinstance(value, str):
            issues.append(ValidationIssue(key=key, message="Expected a string"))
        return issues

    if field_type in {"select", "radio"}:
        if not isinstance(value, str):
            issues.append(ValidationIssue(key=key, message="Expected a string option"))
            return issues
        if option_values and value not in option_values:
            issues.append(ValidationIssue(key=key, message="Value is not in allowed options"))
        return issues

    if field_type in {"multi_select", "chips"}:
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            issues.append(ValidationIssue(key=key, message="Expected an array of strings"))
            return issues
        if option_values:
            unknown = [item for item in value if item not in option_values]
            if unknown:
                issues.append(ValidationIssue(key=key, message="Contains values not in allowed options"))
        return issues

    if field_type == "checkbox":
        if not isinstance(value, bool):
            issues.append(ValidationIssue(key=key, message="Expected a boolean"))
        return issues

    if field_type in {"number", "range"}:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            issues.append(ValidationIssue(key=key, message="Expected a numeric value"))
            return issues

        field_min = field.get("min")
        field_max = field.get("max")
        if field_min is not None and value < field_min:
            issues.append(ValidationIssue(key=key, message=f"Value must be >= {field_min}"))
        if field_max is not None and value > field_max:
            issues.append(ValidationIssue(key=key, message=f"Value must be <= {field_max}"))
        return issues

    issues.append(ValidationIssue(key=key, message=f"Unsupported field type '{field_type}'"))
    return issues
