CREATE TABLE participants (
  id VARCHAR(4) PRIMARY KEY,
  "group" VARCHAR(10) NOT NULL,
  phase1_ticker VARCHAR(10) NOT NULL,
  phase2_ticker VARCHAR(10) NOT NULL,
  phase3_ticker VARCHAR(10) NOT NULL
);

CREATE TABLE sessions (
  id VARCHAR(36) PRIMARY KEY,
  participant_id VARCHAR(4) NOT NULL REFERENCES participants(id),
  current_phase INTEGER NOT NULL,
  current_mode VARCHAR(20) NOT NULL,
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP NULL
);

CREATE TABLE tasks (
  id VARCHAR(36) PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL REFERENCES sessions(id),
  phase INTEGER NOT NULL,
  mode VARCHAR(20) NOT NULL,
  ticker VARCHAR(10) NOT NULL,
  query_text TEXT NOT NULL,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP NULL,
  time_on_task_seconds INTEGER NULL,
  pageindex_retrieval_id VARCHAR(100) NULL,
  retrieved_nodes JSON NULL,
  selected_node_ids JSON NULL,
  rejected_node_ids JSON NULL,
  generated_summary TEXT NULL,
  edited_summary TEXT NULL,
  flagged_spans JSON NULL,
  characters_edited INTEGER NULL,
  retrieval_completed_at TIMESTAMP NULL,
  generation_completed_at TIMESTAMP NULL,
  edit_completed_at TIMESTAMP NULL
);
