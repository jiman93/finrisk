CREATE TABLE checkpoint_definitions (
  id VARCHAR(36) PRIMARY KEY,
  control_type VARCHAR(64) NOT NULL UNIQUE,
  label VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  field_schema JSON NOT NULL,
  pipeline_position VARCHAR(32) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  applicable_modes JSON NOT NULL,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  timeout_seconds INTEGER NULL,
  max_retries INTEGER NOT NULL DEFAULT 2,
  circuit_breaker_threshold INTEGER NOT NULL DEFAULT 5,
  circuit_breaker_window_minutes INTEGER NOT NULL DEFAULT 60,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE checkpoint_instances (
  id VARCHAR(36) PRIMARY KEY,
  task_id VARCHAR(36) NOT NULL REFERENCES tasks(id),
  definition_id VARCHAR(36) NOT NULL REFERENCES checkpoint_definitions(id),
  control_type VARCHAR(64) NOT NULL,
  state VARCHAR(32) NOT NULL,
  payload JSON NULL,
  submit_result JSON NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  failed_at TIMESTAMP NULL,
  offered_at TIMESTAMP NULL,
  submitted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT uq_checkpoint_instance_task_definition UNIQUE (task_id, definition_id)
);

CREATE INDEX ix_checkpoint_definitions_position_enabled
  ON checkpoint_definitions (pipeline_position, enabled, sort_order);

CREATE INDEX ix_checkpoint_instances_task_id
  ON checkpoint_instances (task_id);

CREATE INDEX ix_checkpoint_instances_definition_id
  ON checkpoint_instances (definition_id);

CREATE INDEX ix_checkpoint_instances_definition_state
  ON checkpoint_instances (definition_id, state, failed_at);
