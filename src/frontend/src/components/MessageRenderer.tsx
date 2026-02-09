import type { ReactNode } from "react";

import type { ChatMessage } from "../types";
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
  return (
    <AssistantBlock>
      <SummaryMessage summary={message.summary} />
    </AssistantBlock>
  );
}
