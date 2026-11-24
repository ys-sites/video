/** Determinate task progress; appearance and motion belong to studio/application.css. */
export function ProgressBar({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  const progress = Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : 0;
  return (
    <div
      className="om-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress}
    >
      <span style={{ transform: `scaleX(${progress / 100})` }} />
    </div>
  );
}
