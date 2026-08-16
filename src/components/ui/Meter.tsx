import { computeMeterArc } from "@/lib/meter";

/**
 * A single-ratio-against-a-limit meter — a muted track plus one progress
 * arc, per the dataviz skill's guidance ("a single ratio against a limit"
 * → Meter, explicitly not "a pie of 2 slices"). Never two competing fill
 * colors; the percentage always renders as a visible label, never color
 * alone (design-system spec's "status always needs a stated reason" rule).
 */
export function Meter({
  value,
  color,
  label,
  size = 96,
  strokeWidth = 10,
}: {
  /** 0-100. Values above 100 render as a full ring (over-budget is still "full", not overflowing the arc math). */
  value: number;
  color: string;
  label?: string;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const { circumference, offset } = computeMeterArc(value, radius);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border-hairline)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      {label && <span className="absolute text-sm font-semibold tabular-nums">{label}</span>}
    </div>
  );
}
