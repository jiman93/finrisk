import type {
  CheckpointInstanceResponse,
  CheckpointPipelinePosition,
  CheckpointValidationIssue,
  EditSummaryResponse,
  FlaggedSpan,
  GenerateResponse,
  NextPhaseResponse,
  QueryResponse,
  ResolvedCheckpointsResponse,
  SelectNodesResponse,
  SessionState,
  SyntheticGenerateResponse,
  SyntheticRetrieveResponse,
} from "../types";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export interface ValidationErrorDetail {
  message: string;
  issues: CheckpointValidationIssue[];
  attempt_count: number;
  max_retries: number;
  retry_available: boolean;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    let detail: unknown = "";
    try {
      const data = (await response.json()) as { detail?: unknown };
      detail = data.detail ?? "";
    } catch {
      detail = "";
    }

    const detailText =
      typeof detail === "string"
        ? detail
        : detail && typeof detail === "object"
          ? JSON.stringify(detail)
          : "";

    throw new ApiError(
      `Request failed: ${response.status}${detailText ? ` - ${detailText}` : ""}`,
      response.status,
      detail
    );
  }
  return response.json() as Promise<T>;
}

export function startSession(participantId: string): Promise<SessionState> {
  return request<SessionState>("/api/sessions/start", {
    method: "POST",
    body: JSON.stringify({ participant_id: participantId }),
  });
}

export function queryTask(taskId: string, query?: string): Promise<QueryResponse> {
  return request<QueryResponse>(`/api/tasks/${taskId}/query`, {
    method: "POST",
    body: JSON.stringify({ query }),
  });
}

export function generateTask(taskId: string): Promise<GenerateResponse> {
  return request<GenerateResponse>(`/api/tasks/${taskId}/generate`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function nextPhase(sessionId: string): Promise<NextPhaseResponse> {
  return request<NextPhaseResponse>(`/api/sessions/${sessionId}/next-phase`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function selectNodesTask(
  taskId: string,
  selectedNodeIds: string[],
  rejectedNodeIds: string[],
  selectionOrder: string[]
): Promise<SelectNodesResponse> {
  return request<SelectNodesResponse>(`/api/tasks/${taskId}/select-nodes`, {
    method: "POST",
    body: JSON.stringify({
      selected_node_ids: selectedNodeIds,
      rejected_node_ids: rejectedNodeIds,
      selection_order: selectionOrder,
    }),
  });
}

export function editSummaryTask(
  taskId: string,
  editedText: string,
  flaggedSpans: FlaggedSpan[]
): Promise<EditSummaryResponse> {
  return request<EditSummaryResponse>(`/api/tasks/${taskId}/edit-summary`, {
    method: "POST",
    body: JSON.stringify({
      edited_text: editedText,
      flagged_spans: flaggedSpans,
    }),
  });
}

export function syntheticRetrieve(
  query: string,
  ticker: string = "MSFT"
): Promise<SyntheticRetrieveResponse> {
  return request<SyntheticRetrieveResponse>("/api/synthetic/retrieve", {
    method: "POST",
    body: JSON.stringify({ query, ticker }),
  });
}

export function syntheticGenerate(
  payload: {
    query: string;
    ticker: string;
    retrieval_id: string;
    doc_id: string;
    retrieved_nodes: SyntheticRetrieveResponse["retrieved_nodes"];
  }
): Promise<SyntheticGenerateResponse> {
  return request<SyntheticGenerateResponse>("/api/synthetic/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function resolveTaskCheckpoints(
  taskId: string,
  pipelinePosition: CheckpointPipelinePosition
): Promise<ResolvedCheckpointsResponse> {
  return request<ResolvedCheckpointsResponse>(
    `/api/tasks/${taskId}/checkpoints?pipeline_position=${pipelinePosition}`,
    { method: "GET" }
  );
}

export function getTaskCheckpoint(
  taskId: string,
  instanceId: string
): Promise<CheckpointInstanceResponse> {
  return request<CheckpointInstanceResponse>(`/api/tasks/${taskId}/checkpoints/${instanceId}`, {
    method: "GET",
  });
}

export function submitTaskCheckpoint(
  taskId: string,
  instanceId: string,
  data: Record<string, unknown>
): Promise<CheckpointInstanceResponse> {
  return request<CheckpointInstanceResponse>(`/api/tasks/${taskId}/checkpoints/${instanceId}/submit`, {
    method: "POST",
    body: JSON.stringify({ data }),
  });
}

export function skipTaskCheckpoint(
  taskId: string,
  instanceId: string
): Promise<CheckpointInstanceResponse> {
  return request<CheckpointInstanceResponse>(`/api/tasks/${taskId}/checkpoints/${instanceId}/skip`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function retryTaskCheckpoint(
  taskId: string,
  instanceId: string
): Promise<CheckpointInstanceResponse> {
  return request<CheckpointInstanceResponse>(`/api/tasks/${taskId}/checkpoints/${instanceId}/retry`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}
