interface LoadingMessageProps {
  content: string;
}

export default function LoadingMessage({ content }: LoadingMessageProps) {
  return <div className="loading-message">{content}</div>;
}
