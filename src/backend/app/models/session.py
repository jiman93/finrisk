import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.models.enums import ModeType


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    participant_id: Mapped[str] = mapped_column(
        String(4), ForeignKey("participants.id"), nullable=False
    )
    current_phase: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    current_mode: Mapped[ModeType] = mapped_column(
        Enum(ModeType), default=ModeType.baseline, nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), default=datetime.utcnow, nullable=False
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))

    tasks = relationship("Task", back_populates="session", cascade="all, delete-orphan")
