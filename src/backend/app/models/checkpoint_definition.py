import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.models.enums import CheckpointPipelinePosition


class CheckpointDefinition(Base):
    __tablename__ = "checkpoint_definitions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    control_type: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    field_schema: Mapped[list[dict]] = mapped_column(JSON, default=list, nullable=False)
    pipeline_position: Mapped[CheckpointPipelinePosition] = mapped_column(
        Enum(CheckpointPipelinePosition), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    applicable_modes: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    timeout_seconds: Mapped[int | None] = mapped_column(Integer)
    max_retries: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    circuit_breaker_threshold: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    circuit_breaker_window_minutes: Mapped[int] = mapped_column(
        Integer, default=60, nullable=False
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    instances = relationship("CheckpointInstance", back_populates="definition")
