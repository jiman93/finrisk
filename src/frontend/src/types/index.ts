export type Mode = "baseline" | "hitl_r" | "hitl_g" | "hitl_full";

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
    }
  | {
      id: string;
      type: "editable_summary";
      taskId: string;
      summary: string;
    };
