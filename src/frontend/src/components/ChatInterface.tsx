import { FormEvent, useState } from "react";

import { syntheticGenerate, syntheticRetrieve } from "../api/client";
import type { SyntheticRetrieveResponse } from "../types";

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
  confidence: string;
  citationHelpfulness: string;
  notes: string;
}

type StepStatus = "running" | "completed" | "failed";
type PostGenerationStage = "input" | "decision" | "editing" | "questionnaire";

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
      retrievalId: string;
      docId: string;
      scenario: string;
      chunks: RetrievalChunk[];
      selectedChunkIds: string[];
      submitted: boolean;
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

export default function ChatInterface({ onPromptLogged }: ChatInterfaceProps) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [postGenerationStage, setPostGenerationStage] = useState<PostGenerationStage>("input");
  const [editableSummary, setEditableSummary] = useState("");
  const [questionnaire, setQuestionnaire] = useState<QuestionnaireDraft>({
    confidence: "",
    citationHelpfulness: "",
    notes: "",
  });
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = draft.trim();
    if (!query || isBusy) {
      return;
    }

    const structureStepId = makeId("step");
    const retrievalStepId = makeId("step");

    setDraft("");
    setPostGenerationStage("input");
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

      const retrieval = await syntheticRetrieve(query, "MSFT");
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
          retrievalId: retrieval.retrieval_id,
          docId: retrieval.doc_id,
          scenario: retrieval.scenario,
          chunks,
          selectedChunkIds: chunks.map((chunk) => chunk.chunkId),
          submitted: false,
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
        return { ...item, selectedChunkIds: Array.from(selected) };
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
    const selectedCount = selectedChunks.length;
    const generateNodes = buildGenerateNodes(selector.chunks, selector.selectedChunkIds);
    const generationStepId = makeId("step");

    setLastSelectedChunks(selectedChunks);

    setItems((prev) =>
      prev.map((item) =>
        item.kind === "selector" && item.id === selectorId ? { ...item, submitted: true } : item
      )
    );

    setItems((prev) => [
      ...prev,
      {
        id: makeId("status"),
        kind: "status",
        content: `${selectedCount} chunk${selectedCount > 1 ? "s" : ""} selected.`,
        action: { label: "View selected chunks", type: "view_selected" },
      },
      { id: generationStepId, kind: "step", label: "Synthesize answer", status: "running" },
    ]);

    setIsBusy(true);
    try {
      const generation = await syntheticGenerate({
        query: selector.query,
        ticker: "MSFT",
        retrieval_id: selector.retrievalId,
        doc_id: selector.docId,
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

      setEditableSummary(generation.summary);
      setPostGenerationStage("decision");
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
    } finally {
      setIsBusy(false);
    }
  }

  function handleEditSummaryChoice() {
    setPostGenerationStage("editing");
  }

  function handleSaveEditedSummary() {
    const edited = editableSummary.trim();
    if (!edited) {
      return;
    }

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
    setPostGenerationStage("decision");
  }

  function handleQuestionnaireChoice() {
    setPostGenerationStage("questionnaire");
  }

  function handleSubmitQuestionnaire(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!questionnaire.confidence || !questionnaire.citationHelpfulness) {
      return;
    }

    setLastQuestionnaire(questionnaire);
    setItems((prev) => [
      ...prev,
      {
        id: makeId("status"),
        kind: "status",
        content: `Questionnaire submitted: confidence ${questionnaire.confidence}/5, citation helpfulness ${questionnaire.citationHelpfulness}.`,
        action: { label: "View questionnaire", type: "view_questionnaire" },
      },
      {
        id: makeId("status"),
        kind: "status",
        content: "HITL flow completed. You can start the next retrieval query.",
      },
    ]);

    setQuestionnaire({ confidence: "", citationHelpfulness: "", notes: "" });
    setPostGenerationStage("input");
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
                                  disabled={isBusy}
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

                        <button
                          className="pi-action-btn"
                          disabled={isBusy || item.selectedChunkIds.length === 0}
                          onClick={() => void submitSelection(item.id)}
                        >
                          Submit Selection
                        </button>
                      </div>
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

                {postGenerationStage === "decision" ? (
                  <div className="pi-inline-control-card">
                    <div className="pi-postgen-title">What would you like to do next?</div>
                    <div className="pi-postgen-actions">
                      <button type="button" className="pi-secondary-btn" onClick={handleEditSummaryChoice}>
                        I want to edit the summary
                      </button>
                      <button type="button" className="pi-primary-btn" onClick={handleQuestionnaireChoice}>
                        I&apos;m happy with the summary
                      </button>
                    </div>
                  </div>
                ) : null}

                {postGenerationStage === "editing" ? (
                  <div className="pi-inline-control-card">
                    <div className="pi-postgen-title">Edit summary</div>
                    <textarea
                      className="pi-edit-textarea"
                      value={editableSummary}
                      onChange={(event) => setEditableSummary(event.target.value)}
                      rows={10}
                    />
                    <div className="pi-postgen-actions">
                      <button
                        type="button"
                        className="pi-secondary-btn"
                        onClick={() => setPostGenerationStage("decision")}
                      >
                        Cancel
                      </button>
                      <button type="button" className="pi-primary-btn" onClick={handleSaveEditedSummary}>
                        Save edits
                      </button>
                    </div>
                  </div>
                ) : null}

                {postGenerationStage === "questionnaire" ? (
                  <form className="pi-inline-control-card" onSubmit={handleSubmitQuestionnaire}>
                    <div className="pi-postgen-title">Questionnaire</div>

                    <label className="pi-form-label" htmlFor="q-confidence">
                      Confidence in this summary
                    </label>
                    <select
                      id="q-confidence"
                      className="pi-form-control"
                      value={questionnaire.confidence}
                      onChange={(event) =>
                        setQuestionnaire((prev) => ({ ...prev, confidence: event.target.value }))
                      }
                    >
                      <option value="">Select rating</option>
                      <option value="1">1 - Very low</option>
                      <option value="2">2 - Low</option>
                      <option value="3">3 - Medium</option>
                      <option value="4">4 - High</option>
                      <option value="5">5 - Very high</option>
                    </select>

                    <label className="pi-form-label" htmlFor="q-citation">
                      Were citations helpful?
                    </label>
                    <select
                      id="q-citation"
                      className="pi-form-control"
                      value={questionnaire.citationHelpfulness}
                      onChange={(event) =>
                        setQuestionnaire((prev) => ({
                          ...prev,
                          citationHelpfulness: event.target.value,
                        }))
                      }
                    >
                      <option value="">Select option</option>
                      <option value="yes">Yes</option>
                      <option value="partly">Partly</option>
                      <option value="no">No</option>
                    </select>

                    <label className="pi-form-label" htmlFor="q-notes">
                      Notes (optional)
                    </label>
                    <textarea
                      id="q-notes"
                      className="pi-form-control pi-form-textarea"
                      value={questionnaire.notes}
                      onChange={(event) =>
                        setQuestionnaire((prev) => ({ ...prev, notes: event.target.value }))
                      }
                      rows={4}
                      placeholder="Anything unclear or missing?"
                    />

                    <div className="pi-postgen-actions">
                      <button
                        type="button"
                        className="pi-secondary-btn"
                        onClick={() => setPostGenerationStage("decision")}
                      >
                        Back
                      </button>
                      <button
                        type="submit"
                        className="pi-primary-btn"
                        disabled={!questionnaire.confidence || !questionnaire.citationHelpfulness}
                      >
                        Submit questionnaire
                      </button>
                    </div>
                  </form>
                ) : null}
              </div>
            )}
          </div>

          {postGenerationStage === "input" ? (
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
          ) : null}
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
                  <div className="pi-right-subtitle">{panelContent.chunks.length} chunks selected for generation.</div>
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
                      Confidence: {panelContent.response.confidence}/5
                    </div>
                    <div className="pi-citation-preview-text">
                      Citation helpfulness: {panelContent.response.citationHelpfulness}
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
