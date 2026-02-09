import type { RetrievalNode } from "../../types";

interface RetrievedNodesMessageProps {
  nodes: RetrievalNode[];
}

export default function RetrievedNodesMessage({ nodes }: RetrievedNodesMessageProps) {
  return (
    <div className="retrieved-grid">
      {nodes.map((node) => (
        <div key={node.node_id} className="retrieved-card">
          <div className="retrieved-title">
            {node.title} (Page {node.page_index})
          </div>
          <div className="retrieved-content">{node.relevant_content}</div>
        </div>
      ))}
    </div>
  );
}
