import { create } from "zustand";

import {
  ApiError,
  editSummaryTask,
  generateTask,
  nextPhase,
  queryTask,
  resolveTaskCheckpoints,
  retryTaskCheckpoint,
  selectNodesTask,
  skipTaskCheckpoint,
  startSession,
  submitTaskCheckpoint,
  timeoutTaskCheckpoint,
} from "../api/client";
import type {
  ChatMessage,
  CheckpointInstanceResponse,
  CheckpointPipelinePosition,
  Mode,
  SessionState,
} from "../types";

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
  submitCheckpoint: (taskId: string, checkpointId: string, data: Record<string, unknown>) => Promise<void>;
  skipCheckpoint: (taskId: string, checkpointId: string) => Promise<void>;
  retryCheckpoint: (taskId: string, checkpointId: string) => Promise<void>;
  timeoutCheckpoint: (taskId: string, checkpointId: string) => Promise<void>;
}

interface ValidationErrorDetail {
  message: string;
  issues?: Array<{ key?: string; message?: string }>;
  attempt_count?: number;
}

interface RunTaskFlowParams {
  taskId: string;
  query: string;
  mode: Mode;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function checkpointIsFinal(checkpoint: CheckpointInstanceResponse): boolean {
  return (
    checkpoint.state === "submitted" ||
    checkpoint.state === "skipped" ||
    checkpoint.state === "collapsed"
  );
}

function parseValidation(error: unknown): {
  message: string;
  fieldErrors: Record<string, string>;
  attemptCount?: number;
} {
  if (!(error instanceof ApiError)) {
    return {
      message: error instanceof Error ? error.message : "Checkpoint submit failed",
      fieldErrors: {},
    };
  }

  const detail = error.detail;
  if (!detail || typeof detail !== "object") {
    return { message: error.message, fieldErrors: {} };
  }

  const payload = detail as ValidationErrorDetail;
  const issues = Array.isArray(payload.issues) ? payload.issues : [];
  const fieldErrors = issues.reduce<Record<string, string>>((acc, issue) => {
    if (!issue?.key) {
      return acc;
    }
    acc[issue.key] = issue.message ?? "Invalid value";
    return acc;
  }, {});

  return {
    message: payload.message ?? error.message,
    fieldErrors,
    attemptCount: payload.attempt_count,
  };
}

function appendTextMessage(content: string, role: "system" | "assistant" = "assistant") {
  useStudyStore.setState((state) => ({
    messages: [
      ...state.messages,
      {
        id: makeId("msg"),
        type: "text",
        role,
        content,
      },
    ],
  }));
}

function appendCheckpointMessages(
  taskId: string,
  pipelinePosition: CheckpointPipelinePosition,
  checkpoints: CheckpointInstanceResponse[],
  summarySeed?: string
) {
  if (checkpoints.length === 0) {
    return;
  }

  useStudyStore.setState((state) => {
    const existingCheckpointIds = new Set(
      state.messages
        .filter((message): message is Extract<ChatMessage, { type: "checkpoint" }> => message.type === "checkpoint")
        .filter((message) => message.taskId === taskId)
        .map((message) => message.checkpoint.id)
    );

    const additions: ChatMessage[] = checkpoints
      .filter((checkpoint) => !existingCheckpointIds.has(checkpoint.id))
      .map((checkpoint) => ({
        id: makeId("checkpoint"),
        type: "checkpoint",
        taskId,
        pipelinePosition,
        checkpoint,
        initialData:
          checkpoint.control_type === "summary_editor" && summarySeed
            ? { edited_text: summarySeed }
            : undefined,
      }));

    if (additions.length === 0) {
      return {};
    }

    return {
      messages: [...state.messages, ...additions],
    };
  });
}

function patchCheckpointMessage(
  taskId: string,
  checkpointId: string,
  patch: Partial<Extract<ChatMessage, { type: "checkpoint" }>>,
  checkpointPatch?: Partial<CheckpointInstanceResponse>
) {
  useStudyStore.setState((state) => ({
    messages: state.messages.map((message) => {
      if (message.type !== "checkpoint" || message.taskId !== taskId || message.checkpoint.id !== checkpointId) {
        return message;
      }

      return {
        ...message,
        ...patch,
        checkpoint: checkpointPatch
          ? {
              ...message.checkpoint,
              ...checkpointPatch,
            }
          : message.checkpoint,
      };
    }),
  }));
}

function hasPendingCheckpoints(taskId: string, pipelinePosition: CheckpointPipelinePosition): boolean {
  const { messages } = useStudyStore.getState();
  return messages.some((message) => {
    if (message.type !== "checkpoint" || message.taskId !== taskId) {
      return false;
    }
    if (message.pipelinePosition !== pipelinePosition) {
      return false;
    }
    return !checkpointIsFinal(message.checkpoint);
  });
}

async function resolveAndAppendPostGeneration(taskId: string) {
  const postGeneration = await resolveTaskCheckpoints(taskId, "post_generation");
  appendCheckpointMessages(taskId, "post_generation", postGeneration.checkpoints);

  if (postGeneration.checkpoints.length === 0) {
    appendTextMessage("Task flow completed.", "system");
  }
}

async function runGenerationStage(taskId: string) {
  const generationLoadingId = makeId("loading-generation");

  useStudyStore.setState((state) => ({
    messages: [
      ...state.messages,
      { id: generationLoadingId, type: "loading", content: "Generating summary..." },
    ],
  }));

  try {
    const generation = await generateTask(taskId);

    useStudyStore.setState((state) => ({
      messages: [
        ...state.messages.filter((message) => message.id !== generationLoadingId),
        {
          id: makeId("summary"),
          type: "summary",
          summary: generation.summary,
        },
      ],
    }));

    const afterGeneration = await resolveTaskCheckpoints(taskId, "after_generation");
    appendCheckpointMessages(taskId, "after_generation", afterGeneration.checkpoints, generation.summary);

    if (afterGeneration.checkpoints.length === 0) {
      await resolveAndAppendPostGeneration(taskId);
    }

    useStudyStore.setState({ isLoading: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    useStudyStore.setState((state) => ({
      error: message,
      isLoading: false,
      messages: state.messages.filter((entry) => entry.id !== generationLoadingId),
    }));
  }
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
    set({ isLoading: true, error: null });

    try {
      await selectNodesTask(taskId, selectedIds, rejectedIds, order);

      const selectorMessage = get().messages.find(
        (message): message is Extract<ChatMessage, { type: "selector" }> =>
          message.type === "selector" && message.taskId === taskId
      );
      if (selectorMessage?.checkpointId) {
        await submitTaskCheckpoint(taskId, selectorMessage.checkpointId, {
          selected_node_ids: selectedIds,
        });
      }

      set((state) => ({
        messages: state.messages.filter(
          (message) =>
            !(
              message.type === "selector" &&
              message.taskId === taskId
            )
        ),
      }));

      if (hasPendingCheckpoints(taskId, "after_retrieval")) {
        appendTextMessage("Complete remaining retrieval checkpoints before generation.", "system");
        set({ isLoading: false });
        return;
      }

      await runGenerationStage(taskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      set({ error: message, isLoading: false });
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
  submitCheckpoint: async (taskId, checkpointId, data) => {
    patchCheckpointMessage(taskId, checkpointId, {
      submitting: true,
      submitError: undefined,
      fieldErrors: undefined,
    });

    try {
      const updated = await submitTaskCheckpoint(taskId, checkpointId, data);
      patchCheckpointMessage(
        taskId,
        checkpointId,
        {
          submitting: false,
          submitError: undefined,
          fieldErrors: undefined,
        },
        updated
      );

      const message = get().messages.find(
        (entry): entry is Extract<ChatMessage, { type: "checkpoint" }> =>
          entry.type === "checkpoint" && entry.taskId === taskId && entry.checkpoint.id === checkpointId
      );
      const pipelinePosition = message?.pipelinePosition;

      if (updated.control_type === "summary_editor") {
        const editedText = String(data.edited_text ?? "");
        set((state) => ({
          messages: [
            ...state.messages,
            { id: makeId("summary"), type: "summary", summary: editedText || "(empty summary)" },
          ],
        }));
      }

      if (pipelinePosition === "after_retrieval") {
        if (!hasPendingCheckpoints(taskId, "after_retrieval")) {
          await runGenerationStage(taskId);
        }
      } else if (pipelinePosition === "after_generation") {
        if (!hasPendingCheckpoints(taskId, "after_generation")) {
          await resolveAndAppendPostGeneration(taskId);
          set({ isLoading: false });
        }
      } else if (pipelinePosition === "post_generation") {
        if (!hasPendingCheckpoints(taskId, "post_generation")) {
          appendTextMessage("Task flow completed.", "system");
          set({ isLoading: false });
        }
      }
    } catch (error) {
      const validation = parseValidation(error);
      patchCheckpointMessage(
        taskId,
        checkpointId,
        {
          submitting: false,
          submitError: validation.message,
          fieldErrors: validation.fieldErrors,
        },
        {
          state: "failed",
          last_error: validation.message,
          attempt_count: validation.attemptCount,
        }
      );
      set({ error: validation.message, isLoading: false });
    }
  },
  skipCheckpoint: async (taskId, checkpointId) => {
    patchCheckpointMessage(taskId, checkpointId, { submitting: true, submitError: undefined, fieldErrors: undefined });

    try {
      const updated = await skipTaskCheckpoint(taskId, checkpointId);
      patchCheckpointMessage(taskId, checkpointId, { submitting: false }, updated);

      const message = get().messages.find(
        (entry): entry is Extract<ChatMessage, { type: "checkpoint" }> =>
          entry.type === "checkpoint" && entry.taskId === taskId && entry.checkpoint.id === checkpointId
      );
      const pipelinePosition = message?.pipelinePosition;

      if (pipelinePosition === "after_retrieval" && !hasPendingCheckpoints(taskId, "after_retrieval")) {
        await runGenerationStage(taskId);
      } else if (
        pipelinePosition === "after_generation" &&
        !hasPendingCheckpoints(taskId, "after_generation")
      ) {
        await resolveAndAppendPostGeneration(taskId);
        set({ isLoading: false });
      } else if (pipelinePosition === "post_generation" && !hasPendingCheckpoints(taskId, "post_generation")) {
        appendTextMessage("Task flow completed.", "system");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Checkpoint skip failed";
      patchCheckpointMessage(
        taskId,
        checkpointId,
        { submitting: false, submitError: message },
        { state: "failed", last_error: message }
      );
      set({ error: message, isLoading: false });
    }
  },
  retryCheckpoint: async (taskId, checkpointId) => {
    patchCheckpointMessage(taskId, checkpointId, { submitting: true, submitError: undefined, fieldErrors: undefined });

    try {
      const updated = await retryTaskCheckpoint(taskId, checkpointId);
      patchCheckpointMessage(taskId, checkpointId, { submitting: false }, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Checkpoint retry failed";
      patchCheckpointMessage(taskId, checkpointId, { submitting: false, submitError: message });
      set({ error: message, isLoading: false });
    }
  },
  timeoutCheckpoint: async (taskId, checkpointId) => {
    patchCheckpointMessage(taskId, checkpointId, { submitting: true, submitError: undefined, fieldErrors: undefined });

    try {
      const timedOut = await timeoutTaskCheckpoint(taskId, checkpointId);
      patchCheckpointMessage(taskId, checkpointId, { submitting: false }, timedOut);

      if (!timedOut.required) {
        const skipped = await skipTaskCheckpoint(taskId, checkpointId);
        patchCheckpointMessage(taskId, checkpointId, { submitting: false }, skipped);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Checkpoint timeout failed";
      patchCheckpointMessage(taskId, checkpointId, { submitting: false, submitError: message });
      set({ error: message, isLoading: false });
    }
  },
}));

async function runTaskFlow({ taskId, query }: RunTaskFlowParams) {
  const retrievalLoadingId = makeId("loading-retrieval");

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
        ...state.messages.filter((message) => message.id !== retrievalLoadingId),
        { id: makeId("nodes"), type: "retrieved_nodes", nodes: retrieval.retrieved_nodes },
      ],
    }));

    const afterRetrieval = await resolveTaskCheckpoints(taskId, "after_retrieval");
    const chunkSelector = afterRetrieval.checkpoints.find(
      (checkpoint) => checkpoint.control_type === "chunk_selector"
    );
    const dynamicRetrievalCheckpoints = afterRetrieval.checkpoints.filter(
      (checkpoint) => checkpoint.control_type !== "chunk_selector"
    );

    appendCheckpointMessages(taskId, "after_retrieval", dynamicRetrievalCheckpoints);

    if (chunkSelector) {
      useStudyStore.setState((state) => ({
        messages: [
          ...state.messages,
          {
            id: makeId("selector"),
            type: "selector",
            taskId,
            nodes: retrieval.retrieved_nodes,
            checkpointId: chunkSelector.id,
          },
        ],
        isLoading: false,
      }));
      return;
    }

    if (dynamicRetrievalCheckpoints.length > 0) {
      useStudyStore.setState({ isLoading: false });
      return;
    }

    await runGenerationStage(taskId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    useStudyStore.setState((state) => ({
      error: message,
      isLoading: false,
      messages: state.messages.filter((entry) => entry.id !== retrievalLoadingId),
    }));
  }
}
