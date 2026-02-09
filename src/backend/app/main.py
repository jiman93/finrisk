from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

import app.models  # noqa: F401
from app.db.database import Base, engine
from app.routers.sessions import router as sessions_router
from app.routers.synthetic import router as synthetic_router
from app.routers.tasks import router as tasks_router

app = FastAPI(
    title="FinRisk HITL API",
    version="0.1.0",
    description="Backend API for FinRisk retrieval, generation, and HITL workflows.",
    docs_url="/swagger",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    _apply_sqlite_compat_migrations()


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(sessions_router)
app.include_router(tasks_router)
app.include_router(synthetic_router)


def _apply_sqlite_compat_migrations() -> None:
    if engine.dialect.name != "sqlite":
        return

    required_columns = {
        "tasks": {
            "pageindex_retrieval_id": "VARCHAR(100)",
            "rejected_node_ids": "JSON",
            "edited_summary": "TEXT",
            "flagged_spans": "JSON",
            "characters_edited": "INTEGER",
            "edit_completed_at": "TIMESTAMP",
        }
    }

    inspector = inspect(engine)
    with engine.begin() as connection:
        for table_name, columns in required_columns.items():
            existing = {column["name"] for column in inspector.get_columns(table_name)}
            for column_name, column_type in columns.items():
                if column_name in existing:
                    continue
                connection.execute(
                    text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}")
                )
