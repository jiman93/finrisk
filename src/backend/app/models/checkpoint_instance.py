import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.models.enums import CheckpointState


class CheckpointInstance(Base):
    __tablename__ = "checkpoint_instances"
    __table_args__ = (
        UniqueConstraint("task_id", "definition_id", name="uq_checkpoint_instance_task_definition"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id"), nullable=False, index=True
    )
    definition_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("checkpoint_definitions.id"), nullable=False, index=True
    )
    control_type: Mapped[str] = mapped_column(String(64), nullable=False)
    state: Mapped[CheckpointState] = mapped_column(
        Enum(CheckpointState), default=CheckpointState.pending, nullable=False
    )
    payload: Mapped[dict | None] = mapped_column(JSON)
    submit_result: Mapped[dict | None] = mapped_column(JSON)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text)
    failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    offered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), default=datetime.utcnow, nullable=False
    )

    task = relationship("Task", back_populates="checkpoint_instances")
    definition = relationship("CheckpointDefinition", back_populates="instances")
