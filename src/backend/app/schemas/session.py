from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import GroupType, ModeType


class SessionStartRequest(BaseModel):
    participant_id: str = Field(pattern=r"^P\d{2}$")


class SessionStateResponse(BaseModel):
    session_id: str
    participant_id: str
    group: GroupType
    current_phase: int
    current_mode: ModeType
    current_task_id: str
    current_ticker: str
    current_query: str
    started_at: datetime


class NextPhaseResponse(BaseModel):
    session_id: str
    current_phase: int
    current_mode: ModeType
    current_task_id: str
    current_ticker: str
    current_query: str
