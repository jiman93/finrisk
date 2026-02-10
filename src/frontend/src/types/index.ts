export type Mode = "baseline" | "hitl_r" | "hitl_g" | "hitl_full";
export type CheckpointPipelinePosition = "after_retrieval" | "after_generation" | "post_generation";
export type CheckpointState =
  | "pending"
  | "offered"
  | "active"
  | "submitted"
  | "collapsed"
  | "skipped"
  | "failed"
  | "timed_out";

export interface SessionState {
  session_id: string;
  participant_id: string;
  group: "A" | "B";
  current_phase: number;
  current_mode: Mode;
  current_task_id: string;
  current_ticker: string;
  current_query: string;
  started_at: string;
}

export interface RetrievalNode {
  node_id: string;
  title: string;
  page_index: number;
  relevant_content: string;
}

export interface QueryResponse {
  status: string;
  task_id: string;
  retrieved_nodes: RetrievalNode[];
  retrieval_completed_at: string;
}

export interface SyntheticRelevantContent {
  page_index: number;
  relevant_content: string;
}

export interface SyntheticRetrievedNode {
  title: string;
  node_id: string;
  relevant_contents: SyntheticRelevantContent[];
}

export interface SyntheticRetrieveResponse {
  retrieval_id: string;
  doc_id: string;
  status: string;
  query: string;
  scenario: string;
  latency_ms: number;
  retrieved_nodes: SyntheticRetrievedNode[];
}

export interface SyntheticGenerateResponse {
  generation_id: string;
  retrieval_id: string;
  status: string;
  scenario: string;
  latency_ms: number;
  summary: string;
  citations: string[];
}

export interface CheckpointFieldOption {
  value: string;
  label: string;
}

export interface CheckpointFieldDefinition {
  key: string;
  type: string;
  label: string;
  required: boolean;
  placeholder?: string | null;
  options?: CheckpointFieldOption[] | null;
  min?: number | null;
  max?: number | null;
  default?: string | number | boolean | string[] | null;
}

export interface CheckpointDefinitionResponse {
  id: string;
  control_type: string;
  label: string;
  description: string;
  field_schema: CheckpointFieldDefinition[];
  pipeline_position: CheckpointPipelinePosition;
  sort_order: number;
  applicable_modes: string[];
  required: boolean;
  timeout_seconds: number | null;
  max_retries: number;
  circuit_breaker_threshold: number;
  circuit_breaker_window_minutes: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CheckpointDefinitionCreateRequest {
  control_type: string;
  label: string;
  description?: string;
  field_schema: CheckpointFieldDefinition[];
  pipeline_position: CheckpointPipelinePosition;
  sort_order?: number;
  applicable_modes?: string[];
  required?: boolean;
  timeout_seconds?: number | null;
  max_retries?: number;
  circuit_breaker_threshold?: number;
  circuit_breaker_window_minutes?: number;
  enabled?: boolean;
}

export interface CheckpointDefinitionUpdateRequest {
  label?: string;
  description?: string;
  field_schema?: CheckpointFieldDefinition[];
  pipeline_position?: CheckpointPipelinePosition;
  sort_order?: number;
  applicable_modes?: string[];
  required?: boolean;
  timeout_seconds?: number | null;
  max_retries?: number;
  circuit_breaker_threshold?: number;
  circuit_breaker_window_minutes?: number;
  enabled?: boolean;
}

export interface CheckpointFieldTypeResponse {
  type: string;
  label: string;
  description: string;
}

export interface CheckpointInstanceResponse {
  id: string;
  task_id: string;
  definition_id: string;
  control_type: string;
  label: string;
  state: CheckpointState;
  field_schema: CheckpointFieldDefinition[];
  payload: Record<string, unknown> | null;
  submit_result: Record<string, unknown> | null;
  required: boolean;
  timeout_seconds: number | null;
  max_retries: number;
  attempt_count: number;
  last_error: string | null;
  offered_at: string | null;
  submitted_at: string | null;
}

export interface ResolvedCheckpointsResponse {
  task_id: string;
  pipeline_position: CheckpointPipelinePosition;
  checkpoints: CheckpointInstanceResponse[];
}

export interface CheckpointValidationIssue {
  key: string;
  message: string;
}

export interface GenerateResponse {
  task_id: string;
  summary: string;
  used_node_ids: string[];
  generation_completed_at: string;
}

export interface NextPhaseResponse {
  session_id: string;
  current_phase: number;
  current_mode: Mode;
  current_task_id: string;
  current_ticker: string;
  current_query: string;
}

export interface SelectNodesResponse {
  task_id: string;
  selected_node_ids: string[];
  rejected_node_ids: string[];
}

export interface FlaggedSpan {
  start: number;
  end: number;
  text: string;
  reason: string;
}

export interface EditSummaryResponse {
  task_id: string;
  edited_summary: string;
  characters_edited: number;
  hallucinations_flagged: number;
  edit_completed_at: string;
}

export type ChatMessage =
  | {
      id: string;
      type: "text";
      role: "system" | "user" | "assistant";
      content: string;
    }
  | {
      id: string;
      type: "loading";
      content: string;
    }
  | {
      id: string;
      type: "retrieved_nodes";
      nodes: RetrievalNode[];
    }
  | {
      id: string;
      type: "summary";
      summary: string;
      editable?: boolean;
    }
  | {
      id: string;
      type: "selector";
      taskId: string;
      nodes: RetrievalNode[];
      checkpointId?: string;
    }
  | {
      id: string;
      type: "editable_summary";
      taskId: string;
      summary: string;
    }
  | {
      id: string;
      type: "checkpoint";
      taskId: string;
      pipelinePosition?: CheckpointPipelinePosition;
      checkpoint: CheckpointInstanceResponse;
      initialData?: Record<string, unknown>;
      submitError?: string;
      fieldErrors?: Record<string, string>;
      submitting?: boolean;
    };
