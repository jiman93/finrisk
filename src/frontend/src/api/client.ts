import type {
  EditSummaryResponse,
  FlaggedSpan,
  GenerateResponse,
  NextPhaseResponse,
  QueryResponse,
  SelectNodesResponse,
  SessionState,
  SyntheticGenerateResponse,
  SyntheticRetrieveResponse,
} from "../types";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    let detail = "";
    try {
      const data = (await response.json()) as { detail?: string };
      detail = data.detail ? ` - ${data.detail}` : "";
    } catch {
      detail = "";
    }
    throw new Error(`Request failed: ${response.status}${detail}`);
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
