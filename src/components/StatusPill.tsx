import { statusTone } from "../data/studioData";

type StatusPillProps = {
  label: string;
  compact?: boolean;
};

export function StatusPill({ label, compact = false }: StatusPillProps) {
  const tone = statusTone[label] ?? "neutral";

  return (
    <span className={`status-pill status-${tone} ${compact ? "status-compact" : ""}`}>
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
