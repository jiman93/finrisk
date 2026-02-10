import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.models.enums import ModeType


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sessions.id"), nullable=False
    )
    phase: Mapped[int] = mapped_column(Integer, nullable=False)
    mode: Mapped[ModeType] = mapped_column(Enum(ModeType), nullable=False)
    ticker: Mapped[str] = mapped_column(String(10), nullable=False)
    query_text: Mapped[str] = mapped_column(Text, nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), default=datetime.utcnow, nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    time_on_task_seconds: Mapped[int | None] = mapped_column(Integer)
    pageindex_retrieval_id: Mapped[str | None] = mapped_column(String(100))
    retrieved_nodes: Mapped[list[dict] | None] = mapped_column(JSON)
    selected_node_ids: Mapped[list[str] | None] = mapped_column(JSON)
    rejected_node_ids: Mapped[list[str] | None] = mapped_column(JSON)
    generated_summary: Mapped[str | None] = mapped_column(Text)
    edited_summary: Mapped[str | None] = mapped_column(Text)
    flagged_spans: Mapped[list[dict] | None] = mapped_column(JSON)
    characters_edited: Mapped[int | None] = mapped_column(Integer)
    retrieval_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    generation_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    edit_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))

    session = relationship("Session", back_populates="tasks")
    checkpoint_instances = relationship(
        "CheckpointInstance",
        back_populates="task",
        cascade="all, delete-orphan",
    )
