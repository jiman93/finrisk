interface CheckpointTimeoutBarProps {
  totalSeconds: number;
  remainingSeconds: number;
}

export default function CheckpointTimeoutBar({
  totalSeconds,
  remainingSeconds,
}: CheckpointTimeoutBarProps) {
  const safeTotal = Math.max(1, totalSeconds);
  const safeRemaining = Math.max(0, remainingSeconds);
  const progress = Math.max(0, Math.min(100, (safeRemaining / safeTotal) * 100));
  const isWarning = safeRemaining <= Math.ceil(safeTotal * 0.25);

  return (
    <div className="pi-timeout-wrap">
      <div className="pi-timeout-header">
        <span>Time remaining</span>
        <span className={isWarning ? "pi-timeout-warning" : ""}>{safeRemaining}s</span>
      </div>
      <div className="pi-timeout-track">
        <div
          className={`pi-timeout-fill ${isWarning ? "warning" : ""}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
