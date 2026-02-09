interface SummaryMessageProps {
  summary: string;
}

export default function SummaryMessage({ summary }: SummaryMessageProps) {
  return <div className="summary-card">{summary}</div>;
}
