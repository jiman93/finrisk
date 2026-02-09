import { useState } from "react";

interface EditableSummaryMessageProps {
  taskId: string;
  initialSummary: string;
  onSubmit: (taskId: string, editedText: string) => void;
}

export default function EditableSummaryMessage({
  taskId,
  initialSummary,
  onSubmit,
}: EditableSummaryMessageProps) {
  const [text, setText] = useState(initialSummary);

  return (
    <div className="hitl-card">
      <div className="hitl-title">Review and edit generated summary</div>
      <textarea
        className="hitl-textarea"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={12}
      />
      <button
        className="btn btn-primary hitl-submit"
        onClick={() => onSubmit(taskId, text)}
      >
        Submit edited summary
      </button>
    </div>
  );
}
