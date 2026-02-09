import { useMemo, useState } from "react";

import type { RetrievalNode } from "../../types";

interface SectionSelectorMessageProps {
  taskId: string;
  nodes: RetrievalNode[];
  onSubmit: (taskId: string, selectedIds: string[], rejectedIds: string[], order: string[]) => void;
}

export default function SectionSelectorMessage({
  taskId,
  nodes,
  onSubmit,
}: SectionSelectorMessageProps) {
  const [selected, setSelected] = useState<Record<string, boolean>>(
    () =>
      nodes.reduce<Record<string, boolean>>((acc, node) => {
        acc[node.node_id] = true;
        return acc;
      }, {})
  );

  const selectedIds = useMemo(
    () => nodes.filter((node) => selected[node.node_id]).map((node) => node.node_id),
    [nodes, selected]
  );
  const rejectedIds = useMemo(
    () => nodes.filter((node) => !selected[node.node_id]).map((node) => node.node_id),
    [nodes, selected]
  );

  return (
    <div className="hitl-card">
      <div className="hitl-title">
        Select sections for generation ({selectedIds.length}/{nodes.length})
      </div>
      {nodes.map((node) => (
        <label key={node.node_id} className="hitl-node">
          <span>
            <input
              type="checkbox"
              checked={selected[node.node_id]}
              onChange={(event) =>
                setSelected((prev) => ({ ...prev, [node.node_id]: event.target.checked }))
              }
              className="hitl-checkbox"
            />
            <strong>
              {node.title} (Page {node.page_index})
            </strong>
          </span>
          <span className="hitl-node-content">{node.relevant_content}</span>
        </label>
      ))}

      <button
        className="btn btn-primary hitl-submit"
        onClick={() => onSubmit(taskId, selectedIds, rejectedIds, selectedIds)}
        disabled={selectedIds.length === 0}
      >
        Generate from selected nodes
      </button>
    </div>
  );
}
