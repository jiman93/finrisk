import type { ReactNode } from "react";

import type { ChatMessage } from "../types";
import CheckpointErrorBoundary from "./controls/CheckpointErrorBoundary";
import DynamicControlRenderer from "./controls/DynamicControlRenderer";
import EditableSummaryMessage from "./messages/EditableSummaryMessage";
import LoadingMessage from "./messages/LoadingMessage";
import RetrievedNodesMessage from "./messages/RetrievedNodesMessage";
import SectionSelectorMessage from "./messages/SectionSelectorMessage";
import SummaryMessage from "./messages/SummaryMessage";

interface MessageRendererProps {
  message: ChatMessage;
  onSubmitNodeSelection: (
    taskId: string,
    selectedIds: string[],
    rejectedIds: string[],
    order: string[]
  ) => void;
  onSubmitEditedSummary: (taskId: string, editedText: string) => void;
  onSubmitCheckpoint: (taskId: string, checkpointId: string, data: Record<string, unknown>) => void;
  onSkipCheckpoint: (taskId: string, checkpointId: string) => void;
  onRetryCheckpoint: (taskId: string, checkpointId: string) => void;
  onTimeoutCheckpoint: (taskId: string, checkpointId: string) => void;
}

function TextBubble({
  role,
  content,
}: {
  role: "system" | "user" | "assistant";
  content: string;
}) {
  return <div className={`message-bubble ${role}`}>{content}</div>;
}

function AssistantBlock({ children }: { children: ReactNode }) {
  return <div className="assistant-block">{children}</div>;
}

export default function MessageRenderer({
  message,
  onSubmitNodeSelection,
  onSubmitEditedSummary,
  onSubmitCheckpoint,
  onSkipCheckpoint,
  onRetryCheckpoint,
  onTimeoutCheckpoint,
}: MessageRendererProps) {
  if (message.type === "text") {
    return <TextBubble role={message.role} content={message.content} />;
  }
  if (message.type === "loading") {
    return (
      <AssistantBlock>
        <LoadingMessage content={message.content} />
      </AssistantBlock>
    );
  }
  if (message.type === "retrieved_nodes") {
    return (
      <AssistantBlock>
        <RetrievedNodesMessage nodes={message.nodes} />
      </AssistantBlock>
    );
  }
  if (message.type === "selector") {
    return (
      <AssistantBlock>
        <SectionSelectorMessage
          taskId={message.taskId}
          nodes={message.nodes}
          onSubmit={onSubmitNodeSelection}
        />
      </AssistantBlock>
    );
  }
  if (message.type === "editable_summary") {
    return (
      <AssistantBlock>
        <EditableSummaryMessage
          taskId={message.taskId}
          initialSummary={message.summary}
          onSubmit={onSubmitEditedSummary}
        />
      </AssistantBlock>
    );
  }
  if (message.type === "checkpoint") {
    if (message.checkpoint.control_type === "summary_editor") {
      const initial = message.initialData?.edited_text;
      const summarySeed = typeof initial === "string" ? initial : "";
      return (
        <AssistantBlock>
          <EditableSummaryMessage
            taskId={message.taskId}
            initialSummary={summarySeed}
            onSubmit={(taskId, editedText) =>
              onSubmitCheckpoint(taskId, message.checkpoint.id, { edited_text: editedText })
            }
          />
        </AssistantBlock>
      );
    }

    return (
      <AssistantBlock>
        <CheckpointErrorBoundary
          instanceId={message.checkpoint.id}
          label={message.checkpoint.label}
          required={message.checkpoint.required}
          onRetry={() => onRetryCheckpoint(message.taskId, message.checkpoint.id)}
          onSkip={() => onSkipCheckpoint(message.taskId, message.checkpoint.id)}
        >
          <DynamicControlRenderer
            instance={message.checkpoint}
            initialData={message.initialData}
            fieldErrors={message.fieldErrors}
            submitError={message.submitError}
            submitting={message.submitting}
            onSubmit={async (data) => onSubmitCheckpoint(message.taskId, message.checkpoint.id, data)}
            onSkip={async () => onSkipCheckpoint(message.taskId, message.checkpoint.id)}
            onRetry={async () => onRetryCheckpoint(message.taskId, message.checkpoint.id)}
            onTimeout={async () => onTimeoutCheckpoint(message.taskId, message.checkpoint.id)}
          />
        </CheckpointErrorBoundary>
      </AssistantBlock>
    );
  }
  return (
    <AssistantBlock>
      <SummaryMessage summary={message.summary} />
    </AssistantBlock>
  );
}
