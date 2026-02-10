from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.checkpoint_definition import CheckpointDefinition
from app.models.checkpoint_instance import CheckpointInstance
from app.models.enums import CheckpointPipelinePosition, CheckpointState
from app.models.task import Task


def _mode_is_applicable(definition: CheckpointDefinition, mode_value: str) -> bool:
    modes = definition.applicable_modes or []
    return "*" in modes or mode_value in modes


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
