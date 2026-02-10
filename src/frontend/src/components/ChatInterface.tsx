import { FormEvent, useState } from "react";

import {
  ApiError,
  nextPhase,
  resolveTaskCheckpoints,
  retryTaskCheckpoint,
  skipTaskCheckpoint,
  startSession,
  submitTaskCheckpoint,
  timeoutTaskCheckpoint,
  syntheticGenerate,
  syntheticRetrieve,
  type ValidationErrorDetail,
} from "../api/client";
import CheckpointErrorBoundary from "./controls/CheckpointErrorBoundary";
import DynamicControlRenderer from "./controls/DynamicControlRenderer";
import type {
  CheckpointInstanceResponse,
  CheckpointPipelinePosition,
  SyntheticRetrieveResponse,
} from "../types";

interface ChatInterfaceProps {
  onPromptLogged: (prompt: string) => void;
}

interface RetrievalChunk {
  chunkId: string;
  nodeId: string;
  title: string;
  pageIndex: number;
  relevantContent: string;
}

interface CitationDetail {
  citation: string;
  title: string;
  pageIndex: number;
  relevantContent: string;
}

interface QuestionnaireDraft {
  qAccuracy: string;
  qNoErrors: string;
  qTrust: string;
  notes: string;
}

interface TaskRunContext {
  taskId: string;
  ticker: string;
}

type StepStatus = "running" | "completed" | "failed";

type StatusActionType = "view_selected" | "view_edited" | "view_questionnaire";

interface StatusAction {
  label: string;
  type: StatusActionType;
}

type ChatItem =
  | { id: string; kind: "user"; content: string }
  | { id: string; kind: "assistant"; content: string }
  | { id: string; kind: "step"; label: string; status: StepStatus; meta?: string }
  | {
      id: string;
      kind: "selector";
      query: string;
      taskId: string;
      ticker: string;
      retrievalId: string;
      docId: string;
      scenario: string;
      chunks: RetrievalChunk[];
      selectedChunkIds: string[];
      checkpointId?: string;
      submitted: boolean;
      submitting?: boolean;
      submitError?: string;
      fieldErrors?: Record<string, string>;
    }
  | {
      id: string;
      kind: "checkpoint";
      taskId: string;
      pipelinePosition: CheckpointPipelinePosition;
      instance: CheckpointInstanceResponse;
      initialData?: Record<string, unknown>;
      submitting?: boolean;
      submitError?: string;
      fieldErrors?: Record<string, string>;
    }
  | { id: string; kind: "status"; content: string; action?: StatusAction }
  | {
      id: string;
      kind: "answer";
      summary: string;
      citations: string[];
      label?: string;
    }
  | { id: string; kind: "error"; content: string };

type PanelContent =
  | { type: "none" }
  | { type: "citation"; detail: CitationDetail }
  | { type: "selected"; chunks: RetrievalChunk[] }
  | { type: "edited"; summary: string }
  | { type: "questionnaire"; response: QuestionnaireDraft };

const DEFAULT_PARTICIPANT_ID = "P13";

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function flattenChunks(payload: SyntheticRetrieveResponse): RetrievalChunk[] {
  return payload.retrieved_nodes.flatMap((node) =>
    node.relevant_contents.map((content, index) => ({
      chunkId: `${node.node_id}:${index + 1}`,
      nodeId: node.node_id,
      title: node.title,
      pageIndex: content.page_index,
      relevantContent: content.relevant_content,
    }))
  );
}

function buildGenerateNodes(chunks: RetrievalChunk[], selectedChunkIds: string[]) {
  const selectedSet = new Set(selectedChunkIds);
  const selectedChunks = chunks.filter((chunk) => selectedSet.has(chunk.chunkId));

  const grouped = new Map<
    string,
    {
      title: string;
      node_id: string;
      relevant_contents: Array<{ page_index: number; relevant_content: string }>;
    }
  >();

  for (const chunk of selectedChunks) {
    const existing = grouped.get(chunk.nodeId);
    if (existing) {
      existing.relevant_contents.push({
        page_index: chunk.pageIndex,
        relevant_content: chunk.relevantContent,
      });
      continue;
    }

    grouped.set(chunk.nodeId, {
      title: chunk.title,
      node_id: chunk.nodeId,
      relevant_contents: [{ page_index: chunk.pageIndex, relevant_content: chunk.relevantContent }],
    });
  }

  return Array.from(grouped.values());
}

function findCitationDetail(citation: string, chunks: RetrievalChunk[]): CitationDetail | null {
  const match = citation.match(/^\[(.+),\s*Page\s*(\d+)\]$/i);
  if (!match) {
    return null;
  }

  const title = match[1].trim();
  const pageIndex = Number.parseInt(match[2], 10);
  if (Number.isNaN(pageIndex)) {
    return null;
  }

  const chunk = chunks.find((entry) => entry.title === title && entry.pageIndex === pageIndex);
  if (!chunk) {
    return {
      citation,
      title,
      pageIndex,
      relevantContent: "No excerpt was cached for this citation in the current run.",
    };
  }

  return {
    citation,
    title,
    pageIndex,
    relevantContent: chunk.relevantContent,
  };
}

function parseValidationDetail(error: unknown): {
  message: string;
  fieldErrors: Record<string, string>;
  attemptCount?: number;
  maxRetries?: number;
  retryAvailable?: boolean;
} {
  if (!(error instanceof ApiError)) {
    return {
      message: error instanceof Error ? error.message : "Submission failed",
      fieldErrors: {},
    };
  }

  const detail = error.detail;
  if (!detail || typeof detail !== "object") {
    return { message: error.message, fieldErrors: {} };
  }

  const payload = detail as Partial<ValidationErrorDetail> & {
    issues?: Array<{ key?: string; message?: string }>;
  };

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
    maxRetries: payload.max_retries,
    retryAvailable: payload.retry_available,
  };
}

export default function ChatInterface({ onPromptLogged }: ChatInterfaceProps) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [canAskNextQuery, setCanAskNextQuery] = useState(true);
  const [cachedChunks, setCachedChunks] = useState<RetrievalChunk[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelContent, setPanelContent] = useState<PanelContent>({ type: "none" });

  const [lastSelectedChunks, setLastSelectedChunks] = useState<RetrievalChunk[]>([]);
  const [lastEditedSummary, setLastEditedSummary] = useState("");
  const [lastQuestionnaire, setLastQuestionnaire] = useState<QuestionnaireDraft | null>(null);

  function openPanel(content: PanelContent) {
    setPanelContent(content);
    setPanelOpen(true);
  }

  function openCitation(citation: string) {
    const detail = findCitationDetail(citation, cachedChunks);
    if (!detail) {
      return;
    }
    openPanel({ type: "citation", detail });
  }

  function handleStatusAction(action: StatusAction) {
    if (action.type === "view_selected") {
      openPanel({ type: "selected", chunks: lastSelectedChunks });
      return;
    }
    if (action.type === "view_edited") {
      openPanel({ type: "edited", summary: lastEditedSummary });
      return;
    }
    if (action.type === "view_questionnaire" && lastQuestionnaire) {
      openPanel({ type: "questionnaire", response: lastQuestionnaire });
    }
  }

  async function bootstrapTaskContext(): Promise<TaskRunContext> {
    const session = await startSession(DEFAULT_PARTICIPANT_ID);
    await nextPhase(session.session_id);
    const phaseThree = await nextPhase(session.session_id);

    return {
      taskId: phaseThree.current_task_id,
      ticker: phaseThree.current_ticker,
    };
  }

  async function resolveCheckpointInstances(
    taskId: string,
    pipelinePosition: CheckpointPipelinePosition
  ): Promise<CheckpointInstanceResponse[]> {
    const resolved = await resolveTaskCheckpoints(taskId, pipelinePosition);
    return resolved.checkpoints;
  }

  function appendCheckpointItems(
    taskId: string,
    pipelinePosition: CheckpointPipelinePosition,
    checkpoints: CheckpointInstanceResponse[],
    summarySeed: string
  ) {
    if (checkpoints.length === 0) {
      return;
    }

    setItems((prev) => [
      ...prev,
      ...checkpoints.map((checkpoint) => ({
        id: makeId("checkpoint"),
        kind: "checkpoint" as const,
        taskId,
        pipelinePosition,
        instance: checkpoint,
        initialData:
          checkpoint.control_type === "summary_editor"
            ? { edited_text: summarySeed }
            : undefined,
        submitting: false,
        submitError: undefined,
        fieldErrors: undefined,
      })),
    ]);
  }

  function markCheckpointSubmitting(itemId: string, submitting: boolean) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.kind !== "checkpoint" || item.id !== itemId) {
          return item;
        }
        return {
          ...item,
          submitting,
          submitError: undefined,
          fieldErrors: undefined,
        };
      })
    );
  }

  function setCheckpointError(
    itemId: string,
    message: string,
    fieldErrors: Record<string, string>,
    attemptCount?: number
  ) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.kind !== "checkpoint" || item.id !== itemId) {
          return item;
        }
        return {
          ...item,
          submitting: false,
          submitError: message,
          fieldErrors,
          instance: {
            ...item.instance,
            state: "failed",
            last_error: message,
            attempt_count: attemptCount ?? item.instance.attempt_count,
          },
        };
      })
    );
  }

  function updateCheckpointInstance(itemId: string, instance: CheckpointInstanceResponse) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.kind !== "checkpoint" || item.id !== itemId) {
          return item;
        }
        return {
          ...item,
          instance,
          submitting: false,
          submitError: undefined,
          fieldErrors: undefined,
        };
      })
    );
  }

  function completeFlowMessage() {
    setItems((prev) => [
      ...prev,
      {
        id: makeId("status"),
        kind: "status",
        content: "HITL flow completed. You can start the next retrieval query.",
      },
    ]);
    setCanAskNextQuery(true);
  }

  async function resolvePostGenerationControls(taskId: string, summarySeed: string) {
    const postGeneration = await resolveCheckpointInstances(taskId, "post_generation");
    if (postGeneration.length === 0) {
      completeFlowMessage();
      return;
    }

    setItems((prev) => [
      ...prev,
      {
        id: makeId("assistant"),
        kind: "assistant",
        content: "Before moving on, please complete the post-task checkpoint.",
      },
    ]);
    appendCheckpointItems(taskId, "post_generation", postGeneration, summarySeed);
  }

  async function runGenerationFromSelection(params: {
    selectorId: string;
    taskId: string;
    query: string;
    ticker: string;
    retrievalId: string;
    docId: string;
    chunks: RetrievalChunk[];
    selectedChunkIds: string[];
  }) {
    const generationStepId = makeId("step");
    const generateNodes = buildGenerateNodes(params.chunks, params.selectedChunkIds);

    setItems((prev) => [
      ...prev,
      { id: generationStepId, kind: "step", label: "Synthesize answer", status: "running" },
    ]);

    setIsBusy(true);
    try {
      const generation = await syntheticGenerate({
        query: params.query,
        ticker: params.ticker,
        retrieval_id: params.retrievalId,
        doc_id: params.docId,
        retrieved_nodes: generateNodes,
      });

      setItems((prev) =>
        prev.map((item) =>
          item.kind === "step" && item.id === generationStepId
            ? {
                ...item,
                status: "completed",
                meta: `${generation.citations.length} citations • ${generation.latency_ms} ms`,
              }
            : item
        )
      );

      setItems((prev) => [
        ...prev,
        {
          id: makeId("answer"),
          kind: "answer",
          label: "Generated summary",
          summary: generation.summary,
          citations: generation.citations,
        },
      ]);

      const afterGeneration = await resolveCheckpointInstances(params.taskId, "after_generation");
      if (afterGeneration.length > 0) {
        setItems((prev) => [
          ...prev,
          {
            id: makeId("assistant"),
            kind: "assistant",
            content: "Please review and complete the generation checkpoint.",
          },
        ]);
        appendCheckpointItems(params.taskId, "after_generation", afterGeneration, generation.summary);
      } else {
        await resolvePostGenerationControls(params.taskId, generation.summary);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Generation failed";
      setItems((prev) =>
        prev.map((item) =>
          item.kind === "step" && item.id === generationStepId
            ? { ...item, status: "failed", meta: "Request failed" }
            : item
        )
      );
      setItems((prev) => [...prev, { id: makeId("error"), kind: "error", content: message }]);
      setCanAskNextQuery(true);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = draft.trim();
    if (!query || isBusy || !canAskNextQuery) {
      return;
    }

    const structureStepId = makeId("step");
    const retrievalStepId = makeId("step");

    setDraft("");
    setCanAskNextQuery(false);
    onPromptLogged(query);
    setIsBusy(true);

    setItems((prev) => [
      ...prev,
      { id: makeId("user"), kind: "user", content: query },
      {
        id: makeId("assistant"),
        kind: "assistant",
        content:
          "I'll help with that. Let me first inspect the document structure and then fetch relevant passages.",
      },
      { id: structureStepId, kind: "step", label: "Get document structure", status: "running" },
    ]);

    try {
      const taskContext = await bootstrapTaskContext();

      await sleep(320);
      setItems((prev) =>
        prev.map((item) =>
          item.kind === "step" && item.id === structureStepId
            ? { ...item, status: "completed", meta: "34 sections scanned" }
            : item
        )
      );

      setItems((prev) => [
        ...prev,
        {
          id: makeId("assistant"),
          kind: "assistant",
          content: `Now I'll pull passages relevant to "${query}".`,
        },
        { id: retrievalStepId, kind: "step", label: "Get page content", status: "running" },
      ]);

      const retrieval = await syntheticRetrieve(query, taskContext.ticker);
      const chunks = flattenChunks(retrieval);
      setCachedChunks(chunks);

      setItems((prev) =>
        prev.map((item) =>
          item.kind === "step" && item.id === retrievalStepId
            ? {
                ...item,
                status: "completed",
                meta: `${chunks.length} chunks • ${retrieval.latency_ms} ms`,
              }
            : item
        )
      );

      const checkpoints = await resolveCheckpointInstances(taskContext.taskId, "after_retrieval");
      const chunkSelector = checkpoints.find((checkpoint) => checkpoint.control_type === "chunk_selector");
      const dynamicAfterRetrieval = checkpoints.filter(
        (checkpoint) => checkpoint.control_type !== "chunk_selector"
      );

      if (dynamicAfterRetrieval.length > 0) {
        appendCheckpointItems(taskContext.taskId, "after_retrieval", dynamicAfterRetrieval, "");
      }

      setItems((prev) => [
        ...prev,
        {
          id: makeId("assistant"),
          kind: "assistant",
          content:
            "I found candidate chunks. Choose what to include in the final summary before generation.",
        },
        {
          id: makeId("selector"),
          kind: "selector",
          query,
          taskId: taskContext.taskId,
          ticker: taskContext.ticker,
          retrievalId: retrieval.retrieval_id,
          docId: retrieval.doc_id,
          scenario: retrieval.scenario,
          chunks,
          selectedChunkIds: chunks.map((chunk) => chunk.chunkId),
          checkpointId: chunkSelector?.id,
          submitted: false,
          submitting: false,
        },
      ]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Retrieval failed";
      setItems((prev) =>
        prev.map((item) =>
          item.kind === "step" && item.id === retrievalStepId
            ? { ...item, status: "failed", meta: "Request failed" }
            : item
        )
      );
      setItems((prev) => [...prev, { id: makeId("error"), kind: "error", content: message }]);
      setCanAskNextQuery(true);
    } finally {
      setIsBusy(false);
    }
  }

  function toggleChunk(selectorId: string, chunkId: string) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.kind !== "selector" || item.id !== selectorId || item.submitted) {
          return item;
        }
        const selected = new Set(item.selectedChunkIds);
        if (selected.has(chunkId)) {
          selected.delete(chunkId);
        } else {
          selected.add(chunkId);
        }
        return { ...item, selectedChunkIds: Array.from(selected), submitError: undefined, fieldErrors: {} };
      })
    );
  }

  async function submitSelection(selectorId: string) {
    const selector = items.find(
      (item): item is Extract<ChatItem, { kind: "selector" }> =>
        item.kind === "selector" && item.id === selectorId
    );

    if (!selector || selector.submitted || selector.selectedChunkIds.length === 0 || isBusy) {
      return;
    }

    const selectedChunks = selector.chunks.filter((chunk) =>
      selector.selectedChunkIds.includes(chunk.chunkId)
    );
    const selectedNodeIds = Array.from(new Set(selectedChunks.map((chunk) => chunk.nodeId)));

    setItems((prev) =>
      prev.map((item) =>
        item.kind === "selector" && item.id === selectorId
          ? { ...item, submitting: true, submitError: undefined, fieldErrors: {} }
          : item
      )
    );

    try {
      if (selector.checkpointId) {
        await submitTaskCheckpoint(selector.taskId, selector.checkpointId, {
          selected_node_ids: selectedNodeIds,
        });
      }

      setLastSelectedChunks(selectedChunks);

      setItems((prev) =>
        prev.map((item) =>
          item.kind === "selector" && item.id === selectorId
            ? { ...item, submitted: true, submitting: false }
            : item
        )
      );

      setItems((prev) => [
        ...prev,
        {
          id: makeId("status"),
          kind: "status",
          content: `${selectedChunks.length} chunk${selectedChunks.length > 1 ? "s" : ""} selected.`,
          action: { label: "View selected chunks", type: "view_selected" },
        },
      ]);

      await runGenerationFromSelection({
        selectorId,
        taskId: selector.taskId,
        query: selector.query,
        ticker: selector.ticker,
        retrievalId: selector.retrievalId,
        docId: selector.docId,
        chunks: selector.chunks,
        selectedChunkIds: selector.selectedChunkIds,
      });
    } catch (caught) {
      const validation = parseValidationDetail(caught);
      setItems((prev) =>
        prev.map((item) => {
          if (item.kind !== "selector" || item.id !== selectorId) {
            return item;
          }
          return {
            ...item,
            submitting: false,
            submitError: validation.message,
            fieldErrors: validation.fieldErrors,
          };
        })
      );
    }
  }

  async function handleCheckpointSubmit(itemId: string, data: Record<string, unknown>) {
    const checkpointItem = items.find(
      (item): item is Extract<ChatItem, { kind: "checkpoint" }> =>
        item.kind === "checkpoint" && item.id === itemId
    );
    if (!checkpointItem) {
      return;
    }

    markCheckpointSubmitting(itemId, true);

    try {
      const updated = await submitTaskCheckpoint(
        checkpointItem.taskId,
        checkpointItem.instance.id,
        data
      );
      updateCheckpointInstance(itemId, updated);

      if (checkpointItem.instance.control_type === "summary_editor") {
        const edited = String(data.edited_text ?? "").trim();
        if (edited) {
          setLastEditedSummary(edited);
          setItems((prev) => [
            ...prev,
            {
              id: makeId("status"),
              kind: "status",
              content: "Edited summary submitted.",
              action: { label: "View edited summary", type: "view_edited" },
            },
          ]);
        }

        await resolvePostGenerationControls(checkpointItem.taskId, edited);
        return;
      }

      if (checkpointItem.instance.control_type === "questionnaire") {
        const response: QuestionnaireDraft = {
          qAccuracy: String(data.q_accuracy ?? ""),
          qNoErrors: String(data.q_no_errors ?? ""),
          qTrust: String(data.q_trust ?? ""),
          notes: String(data.notes ?? ""),
        };

        setLastQuestionnaire(response);
        setItems((prev) => [
          ...prev,
          {
            id: makeId("status"),
            kind: "status",
            content: `Questionnaire submitted: accuracy ${response.qAccuracy}/7, no-errors ${response.qNoErrors}/7, trust ${response.qTrust}/7.`,
            action: { label: "View questionnaire", type: "view_questionnaire" },
          },
        ]);
        completeFlowMessage();
        return;
      }

      if (checkpointItem.pipelinePosition === "after_generation") {
        await resolvePostGenerationControls(checkpointItem.taskId, String(data.edited_text ?? ""));
        return;
      }

      if (checkpointItem.pipelinePosition === "post_generation") {
        completeFlowMessage();
      }
    } catch (caught) {
      const validation = parseValidationDetail(caught);
      setCheckpointError(itemId, validation.message, validation.fieldErrors, validation.attemptCount);
    }
  }

  async function handleCheckpointSkip(itemId: string) {
    const checkpointItem = items.find(
      (item): item is Extract<ChatItem, { kind: "checkpoint" }> =>
        item.kind === "checkpoint" && item.id === itemId
    );
    if (!checkpointItem) {
      return;
    }

    markCheckpointSubmitting(itemId, true);

    try {
      const updated = await skipTaskCheckpoint(checkpointItem.taskId, checkpointItem.instance.id);
      updateCheckpointInstance(itemId, updated);

      setItems((prev) => [
        ...prev,
        {
          id: makeId("status"),
          kind: "status",
          content: `${checkpointItem.instance.label} skipped.`,
        },
      ]);

      if (checkpointItem.pipelinePosition === "post_generation") {
        completeFlowMessage();
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Skip failed";
      setCheckpointError(itemId, message, {});
    }
  }

  async function handleCheckpointRetry(itemId: string) {
    const checkpointItem = items.find(
      (item): item is Extract<ChatItem, { kind: "checkpoint" }> =>
        item.kind === "checkpoint" && item.id === itemId
    );
    if (!checkpointItem) {
      return;
    }

    markCheckpointSubmitting(itemId, true);

    try {
      const updated = await retryTaskCheckpoint(checkpointItem.taskId, checkpointItem.instance.id);
      updateCheckpointInstance(itemId, updated);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Retry failed";
      setCheckpointError(itemId, message, {});
    }
  }

  async function handleCheckpointTimeout(itemId: string) {
    const checkpointItem = items.find(
      (item): item is Extract<ChatItem, { kind: "checkpoint" }> =>
        item.kind === "checkpoint" && item.id === itemId
    );
    if (!checkpointItem) {
      return;
    }

    if (
      checkpointItem.instance.state === "submitted" ||
      checkpointItem.instance.state === "collapsed" ||
      checkpointItem.instance.state === "skipped"
    ) {
      return;
    }

    markCheckpointSubmitting(itemId, true);

    try {
      const timedOut = await timeoutTaskCheckpoint(checkpointItem.taskId, checkpointItem.instance.id);
      updateCheckpointInstance(itemId, timedOut);

      if (timedOut.required) {
        setItems((prev) => [
          ...prev,
          {
            id: makeId("status"),
            kind: "status",
            content: `${timedOut.label} timed out. Retry is required to continue.`,
          },
        ]);
        return;
      }

      const skipped = await skipTaskCheckpoint(checkpointItem.taskId, checkpointItem.instance.id);
      updateCheckpointInstance(itemId, skipped);
      setItems((prev) => [
        ...prev,
        {
          id: makeId("status"),
          kind: "status",
          content: `${timedOut.label} timed out and was auto-skipped.`,
        },
      ]);

      if (checkpointItem.pipelinePosition === "post_generation") {
        completeFlowMessage();
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Timeout handling failed";
      setCheckpointError(itemId, message, {});
    }
  }

  return (
    <section className="pi-chat-shell">
      <div className={`pi-workspace ${panelOpen ? "" : "pane-collapsed"}`}>
        <div className="pi-left-pane">
          {!panelOpen ? (
            <button type="button" className="pi-open-pane-btn" onClick={() => setPanelOpen(true)}>
              Open Context
            </button>
          ) : null}

          <div className="pi-chat-stream">
            {items.length === 0 ? (
              <div className="pi-empty-center">
                <div className="pi-empty-icon">◔</div>
                <div className="pi-empty-title">Select documents to start</div>
                <div className="pi-doc-row">
                  <div className="pi-doc-card active">
                    <div className="pi-doc-thumb" />
                    <div className="pi-doc-meta">
                      <div className="pi-doc-kicker">PDF / 73 Pages</div>
                      <div className="pi-doc-name">financial-stability-report-20251107.pdf</div>
                      <div className="pi-doc-caption">
                        This document is the November 2025 Financial Stability Report.
                      </div>
                    </div>
                  </div>
                  <button className="pi-upload-card" type="button">
                    Upload Documents
                  </button>
                </div>
              </div>
            ) : (
              <div className="pi-transcript">
                <div className="pi-top-doc-anchor">
                  <div className="pi-doc-card compact">
                    <div className="pi-doc-thumb" />
                    <div className="pi-doc-meta">
                      <div className="pi-doc-name">financial-stability-report-20251107.pdf</div>
                      <div className="pi-doc-kicker">73 pages</div>
                    </div>
                  </div>
                </div>

                {items.map((item) => {
                  if (item.kind === "user") {
                    return (
                      <div key={item.id} className="pi-user-bubble">
                        {item.content}
                      </div>
                    );
                  }

                  if (item.kind === "assistant") {
                    return (
                      <div key={item.id} className="pi-assistant-text">
                        {item.content}
                      </div>
                    );
                  }

                  if (item.kind === "step") {
                    const icon = item.status === "running" ? "⟳" : item.status === "completed" ? "✓" : "!";
                    const meta =
                      item.meta ??
                      (item.status === "running"
                        ? "Running..."
                        : item.status === "completed"
                          ? "Completed"
                          : "Failed");
                    return (
                      <div key={item.id} className={`pi-step-card ${item.status}`}>
                        <div className="pi-step-left">
                          <span className="pi-step-icon">{icon}</span>
                          <span>{item.label}</span>
                        </div>
                        <div className="pi-step-right">{meta}</div>
                      </div>
                    );
                  }

                  if (item.kind === "selector") {
                    if (item.submitted) {
                      return (
                        <div key={item.id} className="pi-selector-card">
                          <div className="pi-selector-header">
                            <span>Chunk selection submitted</span>
                            <span className="pi-selector-meta">
                              {item.selectedChunkIds.length} selected
                            </span>
                          </div>
                          <button
                            type="button"
                            className="pi-secondary-btn"
                            onClick={() => openPanel({ type: "selected", chunks: lastSelectedChunks })}
                          >
                            View selected chunks
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div key={item.id} className="pi-selector-card">
                        <div className="pi-selector-header">
                          <span>Select chunks for HITL-R</span>
                          <span className="pi-selector-meta">
                            {item.selectedChunkIds.length}/{item.chunks.length} selected
                          </span>
                        </div>

                        <div className="pi-selector-list">
                          {item.chunks.map((chunk) => {
                            const checked = item.selectedChunkIds.includes(chunk.chunkId);
                            return (
                              <label key={chunk.chunkId} className="pi-selector-item">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={isBusy || Boolean(item.submitting)}
                                  onChange={() => toggleChunk(item.id, chunk.chunkId)}
                                />
                                <div>
                                  <div className="pi-selector-title">{chunk.title}</div>
                                  <div className="pi-selector-content">{chunk.relevantContent}</div>
                                  <button
                                    type="button"
                                    className="pi-citation-chip pi-citation-chip-btn"
                                    onClick={() => openCitation(`[${chunk.title}, Page ${chunk.pageIndex}]`)}
                                  >
                                    [{chunk.title}, Page {chunk.pageIndex}]
                                  </button>
                                </div>
                              </label>
                            );
                          })}
                        </div>

                        {item.submitError ? <div className="pi-error-inline">{item.submitError}</div> : null}

                        <button
                          className="pi-action-btn"
                          disabled={isBusy || Boolean(item.submitting) || item.selectedChunkIds.length === 0}
                          onClick={() => void submitSelection(item.id)}
                        >
                          {item.submitting ? "Submitting..." : "Submit Selection"}
                        </button>
                      </div>
                    );
                  }

                  if (item.kind === "checkpoint") {
                    return (
                      <CheckpointErrorBoundary
                        key={item.id}
                        instanceId={item.instance.id}
                        label={item.instance.label}
                        required={item.instance.required}
                        onRetry={() => {
                          void handleCheckpointRetry(item.id);
                        }}
                        onSkip={() => {
                          void handleCheckpointSkip(item.id);
                        }}
                      >
                        <DynamicControlRenderer
                          instance={item.instance}
                          initialData={item.initialData}
                          fieldErrors={item.fieldErrors}
                          submitError={item.submitError}
                          submitting={item.submitting}
                          onSubmit={(data) => handleCheckpointSubmit(item.id, data)}
                          onSkip={() => handleCheckpointSkip(item.id)}
                          onRetry={() => handleCheckpointRetry(item.id)}
                          onTimeout={() => handleCheckpointTimeout(item.id)}
                        />
                      </CheckpointErrorBoundary>
                    );
                  }

                  if (item.kind === "status") {
                    return (
                      <div key={item.id} className="pi-run-meta pi-status-row">
                        <span>{item.content}</span>
                        {item.action ? (
                          <button
                            type="button"
                            className="pi-status-action-btn"
                            onClick={() => handleStatusAction(item.action as StatusAction)}
                          >
                            {item.action.label}
                          </button>
                        ) : null}
                      </div>
                    );
                  }

                  if (item.kind === "answer") {
                    return (
                      <div key={item.id} className="pi-answer-card">
                        {item.label ? <div className="pi-answer-label">{item.label}</div> : null}
                        <div className="pi-answer-text">{item.summary}</div>
                        {item.citations.length > 0 ? (
                          <div className="pi-citation-row">
                            {item.citations.slice(0, 8).map((citation) => (
                              <button
                                key={citation}
                                type="button"
                                className="pi-citation-chip pi-citation-chip-btn"
                                onClick={() => openCitation(citation)}
                              >
                                {citation}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  }

                  return (
                    <div key={item.id} className="pi-error-inline">
                      {item.content}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {canAskNextQuery ? (
            <form className="pi-composer-wrap" onSubmit={handleSubmit}>
              <div className="pi-composer">
                <input
                  className="pi-composer-input"
                  placeholder="Ask a question..."
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={isBusy}
                />
                <div className="pi-composer-footer">
                  <button type="button" className="pi-doc-btn">
                    + Add documents
                  </button>
                  <button className="pi-send-btn" type="submit" disabled={!draft.trim() || isBusy}>
                    ↑
                  </button>
                </div>
              </div>
              <div className="pi-disclaimer">PageIndex can make mistakes, please check the response.</div>
            </form>
          ) : (
            <div className="pi-composer-wrap">
              <div className="pi-run-meta">Complete the in-stream checkpoints above to continue.</div>
            </div>
          )}
        </div>

        {panelOpen ? (
          <aside className="pi-right-pane">
            <div className="pi-right-header">
              <div className="pi-right-file">financial-stability-report-20251107.pdf</div>
              <button type="button" className="pi-close-pane-btn" onClick={() => setPanelOpen(false)}>
                Close
              </button>
            </div>
            <div className="pi-right-body">
              {panelContent.type === "none" ? (
                <div className="pi-right-card muted">
                  <div className="pi-right-title">Context Panel</div>
                  <div className="pi-right-subtitle">
                    Click citation chips or "View" buttons in chat to inspect source context here.
                  </div>
                </div>
              ) : null}

              {panelContent.type === "citation" ? (
                <div className="pi-right-card">
                  <div className="pi-right-title">Citation Source</div>
                  <div className="pi-citation-source-chip">{panelContent.detail.citation}</div>
                  <div className="pi-citation-preview">
                    <div className="pi-citation-preview-title">{panelContent.detail.title}</div>
                    <div className="pi-citation-preview-page">Page {panelContent.detail.pageIndex}</div>
                    <div className="pi-citation-preview-text">{panelContent.detail.relevantContent}</div>
                  </div>
                </div>
              ) : null}

              {panelContent.type === "selected" ? (
                <div className="pi-right-card">
                  <div className="pi-right-title">Selected Chunks</div>
                  <div className="pi-right-subtitle">
                    {panelContent.chunks.length} chunks selected for generation.
                  </div>
                  <div className="pi-selector-list">
                    {panelContent.chunks.map((chunk) => (
                      <div key={chunk.chunkId} className="pi-selector-item">
                        <div>
                          <div className="pi-selector-title">{chunk.title}</div>
                          <div className="pi-selector-content">{chunk.relevantContent}</div>
                          <span className="pi-citation-chip">[{chunk.title}, Page {chunk.pageIndex}]</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {panelContent.type === "edited" ? (
                <div className="pi-right-card">
                  <div className="pi-right-title">Edited Summary</div>
                  <div className="pi-citation-preview">
                    <div className="pi-citation-preview-text">{panelContent.summary}</div>
                  </div>
                </div>
              ) : null}

              {panelContent.type === "questionnaire" ? (
                <div className="pi-right-card">
                  <div className="pi-right-title">Questionnaire Response</div>
                  <div className="pi-citation-preview">
                    <div className="pi-citation-preview-text">
                      Accuracy rating: {panelContent.response.qAccuracy || "n/a"}
                    </div>
                    <div className="pi-citation-preview-text">
                      No-errors rating: {panelContent.response.qNoErrors || "n/a"}
                    </div>
                    <div className="pi-citation-preview-text">
                      Trust rating: {panelContent.response.qTrust || "n/a"}
                    </div>
                    <div className="pi-citation-preview-text">
                      Notes: {panelContent.response.notes.trim() || "none"}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
