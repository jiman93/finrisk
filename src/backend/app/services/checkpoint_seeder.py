from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.checkpoint_definition import CheckpointDefinition
from app.models.enums import CheckpointPipelinePosition


BUILTIN_CHECKPOINT_DEFINITIONS: tuple[dict, ...] = (
    {
        "control_type": "chunk_selector",
        "label": "Chunk Selector",
        "description": "Select which retrieved chunks should be used for generation.",
        "field_schema": [
            {
                "key": "selected_node_ids",
                "type": "chips",
                "label": "Selected node IDs",
                "required": True,
            }
        ],
        "pipeline_position": CheckpointPipelinePosition.after_retrieval,
        "sort_order": 10,
        "applicable_modes": ["hitl_r", "hitl_full"],
        "required": True,
        "timeout_seconds": None,
        "max_retries": 2,
        "circuit_breaker_threshold": 5,
        "circuit_breaker_window_minutes": 60,
    },
    {
        "control_type": "summary_editor",
        "label": "Summary Editor",
        "description": "Edit generated summary before finalization.",
        "field_schema": [
            {
                "key": "edited_text",
                "type": "textarea",
                "label": "Edited summary",
                "required": True,
                "placeholder": "Review and edit the generated summary...",
            }
        ],
        "pipeline_position": CheckpointPipelinePosition.after_generation,
        "sort_order": 20,
        "applicable_modes": ["hitl_g", "hitl_full"],
        "required": True,
        "timeout_seconds": None,
        "max_retries": 2,
        "circuit_breaker_threshold": 5,
        "circuit_breaker_window_minutes": 60,
    },
    {
        "control_type": "questionnaire",
        "label": "Post-Task Questionnaire",
        "description": "Capture post-task confidence and quality feedback.",
        "field_schema": [
            {
                "key": "q_accuracy",
                "type": "select",
                "label": "The summary accurately reflects the company's risk factors",
                "required": True,
                "options": [
                    {"value": "1", "label": "1"},
                    {"value": "2", "label": "2"},
                    {"value": "3", "label": "3"},
                    {"value": "4", "label": "4"},
                    {"value": "5", "label": "5"},
                    {"value": "6", "label": "6"},
                    {"value": "7", "label": "7"},
                ],
            },
            {
                "key": "q_no_errors",
                "type": "select",
                "label": "The summary contains no factual errors",
                "required": True,
                "options": [
                    {"value": "1", "label": "1"},
                    {"value": "2", "label": "2"},
                    {"value": "3", "label": "3"},
                    {"value": "4", "label": "4"},
                    {"value": "5", "label": "5"},
                    {"value": "6", "label": "6"},
                    {"value": "7", "label": "7"},
                ],
            },
            {
                "key": "q_trust",
                "type": "select",
                "label": "I trust this summary for investment decisions",
                "required": True,
                "options": [
                    {"value": "1", "label": "1"},
                    {"value": "2", "label": "2"},
                    {"value": "3", "label": "3"},
                    {"value": "4", "label": "4"},
                    {"value": "5", "label": "5"},
                    {"value": "6", "label": "6"},
                    {"value": "7", "label": "7"},
                ],
            },
        ],
        "pipeline_position": CheckpointPipelinePosition.post_generation,
        "sort_order": 30,
        "applicable_modes": ["hitl_r", "hitl_g", "hitl_full"],
        "required": False,
        "timeout_seconds": None,
        "max_retries": 2,
        "circuit_breaker_threshold": 5,
        "circuit_breaker_window_minutes": 60,
    },
)


def ensure_seed_checkpoint_definitions(db: Session) -> int:
    created = 0
    for definition_data in BUILTIN_CHECKPOINT_DEFINITIONS:
        existing = db.scalar(
            select(CheckpointDefinition).where(
                CheckpointDefinition.control_type == definition_data["control_type"]
            )
        )
        if existing:
            continue
        db.add(CheckpointDefinition(**definition_data))
        created += 1
    return created
