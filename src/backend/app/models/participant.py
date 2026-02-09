from sqlalchemy import Enum, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base
from app.models.enums import GroupType


class Participant(Base):
    __tablename__ = "participants"

    id: Mapped[str] = mapped_column(String(4), primary_key=True)  # P01-P16
    group: Mapped[GroupType] = mapped_column(Enum(GroupType), nullable=False)
    phase1_ticker: Mapped[str] = mapped_column(String(10), nullable=False)
    phase2_ticker: Mapped[str] = mapped_column(String(10), nullable=False)
    phase3_ticker: Mapped[str] = mapped_column(String(10), nullable=False)
