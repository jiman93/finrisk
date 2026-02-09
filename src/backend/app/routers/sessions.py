from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.participant import Participant
from app.models.session import Session as StudySession
from app.models.task import Task
from app.schemas.session import NextPhaseResponse, SessionStartRequest, SessionStateResponse
from app.services.study_setup import QUERIES, get_group, get_phase_modes, get_ticker_sequence

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _build_session_state(db: Session, study_session: StudySession) -> SessionStateResponse:
    participant = db.get(Participant, study_session.participant_id)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")

    current_task = db.scalar(
        select(Task)
        .where(Task.session_id == study_session.id, Task.phase == study_session.current_phase)
        .order_by(Task.started_at.desc())
    )
    if not current_task:
        raise HTTPException(status_code=404, detail="Current task not found")

    return SessionStateResponse(
        session_id=study_session.id,
        participant_id=study_session.participant_id,
        group=participant.group,
        current_phase=study_session.current_phase,
        current_mode=study_session.current_mode,
        current_task_id=current_task.id,
        current_ticker=current_task.ticker,
        current_query=current_task.query_text,
        started_at=study_session.started_at,
    )


def _ensure_participant(db: Session, participant_id: str) -> Participant:
    participant = db.get(Participant, participant_id)
    if participant:
        return participant

    group = get_group(participant_id)
    ticker_seq = get_ticker_sequence(participant_id)
    participant = Participant(
        id=participant_id,
        group=group,
        phase1_ticker=ticker_seq[0],
        phase2_ticker=ticker_seq[1],
        phase3_ticker=ticker_seq[2],
    )
    db.add(participant)
    db.flush()
    return participant


def _create_task_for_phase(db: Session, study_session: StudySession, phase: int) -> Task:
    participant = db.get(Participant, study_session.participant_id)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")

    ticker_by_phase = {
        1: participant.phase1_ticker,
        2: participant.phase2_ticker,
        3: participant.phase3_ticker,
    }
    ticker = ticker_by_phase[phase]
    query = QUERIES[ticker]
    task = Task(
        session_id=study_session.id,
        phase=phase,
        mode=study_session.current_mode,
        ticker=ticker,
        query_text=query,
    )
    db.add(task)
    db.flush()
    return task


@router.post("/start", response_model=SessionStateResponse)
def start_session(payload: SessionStartRequest, db: Session = Depends(get_db)):
    participant = _ensure_participant(db, payload.participant_id)
    modes = get_phase_modes(participant.group)

    study_session = StudySession(
        participant_id=participant.id,
        current_phase=1,
        current_mode=modes[0],
    )
    db.add(study_session)
    db.flush()
    _create_task_for_phase(db, study_session, phase=1)
    db.commit()
    db.refresh(study_session)
    return _build_session_state(db, study_session)


@router.get("/{session_id}", response_model=SessionStateResponse)
def get_session(session_id: str, db: Session = Depends(get_db)):
    study_session = db.get(StudySession, session_id)
    if not study_session:
        raise HTTPException(status_code=404, detail="Session not found")
    return _build_session_state(db, study_session)


@router.post("/{session_id}/next-phase", response_model=NextPhaseResponse)
def next_phase(session_id: str, db: Session = Depends(get_db)):
    study_session = db.get(StudySession, session_id)
    if not study_session:
        raise HTTPException(status_code=404, detail="Session not found")

    participant = db.get(Participant, study_session.participant_id)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")

    modes = get_phase_modes(participant.group)
    if study_session.current_phase >= 3:
        raise HTTPException(status_code=400, detail="Session already at final phase")

    study_session.current_phase += 1
    study_session.current_mode = modes[study_session.current_phase - 1]
    task = _create_task_for_phase(db, study_session, study_session.current_phase)
    db.commit()
    return NextPhaseResponse(
        session_id=study_session.id,
        current_phase=study_session.current_phase,
        current_mode=study_session.current_mode,
        current_task_id=task.id,
        current_ticker=task.ticker,
        current_query=task.query_text,
    )


@router.post("/{session_id}/complete")
def complete_session(session_id: str, db: Session = Depends(get_db)):
    study_session = db.get(StudySession, session_id)
    if not study_session:
        raise HTTPException(status_code=404, detail="Session not found")
    study_session.ended_at = datetime.utcnow()
    db.commit()
    return {"status": "completed", "session_id": session_id}
