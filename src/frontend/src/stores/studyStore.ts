import { create } from "zustand";

import {
  editSummaryTask,
  generateTask,
  nextPhase,
  queryTask,
  selectNodesTask,
  startSession,
} from "../api/client";
import type { ChatMessage, Mode, SessionState } from "../types";

interface StudyState {
  participantId: string;
  session: SessionState | null;
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  setParticipantId: (participantId: string) => void;
  startAndRunCurrentPhase: () => Promise<void>;
  askQuery: (query: string) => Promise<void>;
  advancePhase: () => Promise<void>;
  submitNodeSelection: (
    taskId: string,
    selectedIds: string[],
    rejectedIds: string[],
    order: string[]
  ) => Promise<void>;
  submitEditedSummary: (taskId: string, editedText: string) => Promise<void>;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useStudyStore = create<StudyState>((set, get) => ({
  participantId: "P01",
  session: null,
  messages: [],
  isLoading: false,
  error: null,
  setParticipantId: (participantId) => set({ participantId }),
  startAndRunCurrentPhase: async () => {
    const { participantId } = get();
    set({ isLoading: true, error: null, messages: [] });
    try {
      const session = await startSession(participantId);
      set({
        session,
        messages: [
          {
            id: makeId("msg"),
            type: "text",
            role: "system",
            content: `Session started for ${session.participant_id} (Group ${session.group}).`,
          },
          {
            id: makeId("msg"),
            type: "text",
            role: "system",
            content: `Phase ${session.current_phase} | Mode ${session.current_mode} | Ticker ${session.current_ticker}`,
          },
        ],
      });

      await runTaskFlow({
        taskId: session.current_task_id,
        query: session.current_query,
        mode: session.current_mode,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      set({ error: message, isLoading: false });
    }
  },
  askQuery: async (query) => {
    const session = get().session;
    const normalizedQuery = query.trim();
    if (!session || !normalizedQuery) {
      return;
    }

    await runTaskFlow({
      taskId: session.current_task_id,
      query: normalizedQuery,
      mode: session.current_mode,
    });
  },
  advancePhase: async () => {
    const { session } = get();
    if (!session) {
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const next = await nextPhase(session.session_id);
      const updated: SessionState = {
        ...session,
        current_phase: next.current_phase,
        current_mode: next.current_mode,
        current_task_id: next.current_task_id,
        current_ticker: next.current_ticker,
        current_query: next.current_query,
      };
      set((state) => ({
        session: updated,
        messages: [
          ...state.messages,
          {
            id: makeId("msg"),
            type: "text",
            role: "system",
            content: `Transitioned to Phase ${next.current_phase} (${next.current_mode}).`,
          },
        ],
      }));
      await runTaskFlow({
        taskId: next.current_task_id,
        query: next.current_query,
        mode: next.current_mode,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      set({ error: message, isLoading: false });
    }
  },
  submitNodeSelection: async (taskId, selectedIds, rejectedIds, order) => {
    const session = get().session;
    if (!session) return;

    set((state) => ({
      isLoading: true,
      messages: [
        ...state.messages,
        { id: "loading-generation", type: "loading", content: "Generating summary..." },
      ],
    }));

    try {
      await selectNodesTask(taskId, selectedIds, rejectedIds, order);
      const generation = await generateTask(taskId);
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== "loading-generation"),
      }));

      if (session.current_mode === "hitl_full") {
        set((state) => ({
          messages: [
            ...state.messages,
            { id: makeId("edit"), type: "editable_summary", taskId, summary: generation.summary },
          ],
          isLoading: false,
        }));
        return;
      }

      set((state) => ({
        messages: [...state.messages, { id: makeId("summary"), type: "summary", summary: generation.summary }],
        isLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      set({
        error: message,
        isLoading: false,
        messages: get().messages.filter((m) => m.id !== "loading-generation"),
      });
    }
  },
  submitEditedSummary: async (taskId, editedText) => {
    set({ isLoading: true, error: null });
    try {
      const result = await editSummaryTask(taskId, editedText, []);
      set((state) => ({
        messages: [
          ...state.messages,
          {
            id: makeId("msg"),
            type: "text",
            role: "assistant",
            content: `Edited summary saved (${result.characters_edited} chars changed, ${result.hallucinations_flagged} flags).`,
          },
          { id: makeId("summary"), type: "summary", summary: result.edited_summary },
        ],
        isLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      set({ error: message, isLoading: false });
    }
  },
}));

interface RunTaskFlowParams {
  taskId: string;
  query: string;
  mode: Mode;
}

async function runTaskFlow({ taskId, query, mode }: RunTaskFlowParams) {
  const retrievalLoadingId = makeId("loading-retrieval");
  const generationLoadingId = makeId("loading-generation");

  useStudyStore.setState((state) => ({
    isLoading: true,
    error: null,
    messages: [
      ...state.messages,
      { id: makeId("msg"), type: "text", role: "user", content: query },
      { id: retrievalLoadingId, type: "loading", content: "Searching document..." },
    ],
  }));

  try {
    const retrieval = await queryTask(taskId, query);
    useStudyStore.setState((state) => ({
      messages: [
        ...state.messages.filter((m) => m.id !== retrievalLoadingId),
        { id: makeId("nodes"), type: "retrieved_nodes", nodes: retrieval.retrieved_nodes },
      ],
    }));

    if (mode === "hitl_r" || mode === "hitl_full") {
      useStudyStore.setState((state) => ({
        messages: [
          ...state.messages,
          {
            id: makeId("selector"),
            type: "selector",
            taskId,
            nodes: retrieval.retrieved_nodes,
          },
        ],
        isLoading: false,
      }));
      return;
    }

    useStudyStore.setState((state) => ({
      messages: [...state.messages, { id: generationLoadingId, type: "loading", content: "Generating summary..." }],
    }));
    const generation = await generateTask(taskId);
    useStudyStore.setState((state) => ({
      messages: state.messages.filter((m) => m.id !== generationLoadingId),
    }));

    if (mode === "hitl_g") {
      useStudyStore.setState((state) => ({
        messages: [
          ...state.messages,
          {
            id: makeId("edit"),
            type: "editable_summary",
            taskId,
            summary: generation.summary,
          },
        ],
        isLoading: false,
      }));
      return;
    }

    useStudyStore.setState((state) => ({
      messages: [...state.messages, { id: makeId("summary"), type: "summary", summary: generation.summary }],
      isLoading: false,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    useStudyStore.setState((state) => ({
      error: message,
      isLoading: false,
      messages: state.messages.filter(
        (m) => m.id !== retrievalLoadingId && m.id !== generationLoadingId
      ),
    }));
  }
}
