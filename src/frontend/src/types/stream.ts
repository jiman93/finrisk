export interface StreamEventBase {
  type: string;
  run_id: string;
  timestamp: string;
}

export interface RunStartedEvent extends StreamEventBase {
  type: "run_started";
  query: string;
  ticker: string;
  scenario: string;
}

export interface AssistantMessageEvent extends StreamEventBase {
  type: "assistant_message";
  message_id: string;
  content: string;
}

export interface StepStartedEvent extends StreamEventBase {
  type: "step_started";
  step_id: string;
  label: string;
}

export interface StepCompletedEvent extends StreamEventBase {
  type: "step_completed";
  step_id: string;
  label: string;
  duration_ms: number;
  metadata: Record<string, unknown>;
}

export interface StepFailedEvent extends StreamEventBase {
  type: "step_failed";
  step_id: string;
  label: string;
  duration_ms: number;
  error: string;
  status_code: number;
}

export interface FinalAnswerEvent extends StreamEventBase {
  type: "final_answer";
  retrieval_id: string;
  generation_id: string;
  summary: string;
  citations: string[];
}

export interface RunCompletedEvent extends StreamEventBase {
  type: "run_completed";
  retrieval_id: string;
  generation_id: string;
}

export interface RunFailedEvent extends StreamEventBase {
  type: "run_failed";
  error: string;
  status_code: number;
}

export type SyntheticStreamEvent =
  | RunStartedEvent
  | AssistantMessageEvent
  | StepStartedEvent
  | StepCompletedEvent
  | StepFailedEvent
  | FinalAnswerEvent
  | RunCompletedEvent
  | RunFailedEvent;
