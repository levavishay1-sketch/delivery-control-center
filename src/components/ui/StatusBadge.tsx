import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock,
  MinusCircle,
  Sparkles,
} from "lucide-react";
import type { ComponentType } from "react";

export type StatusTone = "healthy" | "active" | "ai" | "warning" | "critical" | "inactive";

/** Exported so other components (e.g. `IconBadge`) reuse this exact tone→color mapping instead of duplicating it. */
export const TONE_STYLES: Record<StatusTone, { text: string; bg: string; icon: ComponentType<{ className?: string }> }> = {
  healthy: { text: "text-status-healthy", bg: "bg-status-healthy-bg", icon: CheckCircle2 },
  active: { text: "text-status-active", bg: "bg-status-active-bg", icon: CircleDot },
  ai: { text: "text-status-ai", bg: "bg-status-ai-bg", icon: Sparkles },
  warning: { text: "text-status-warning", bg: "bg-status-warning-bg", icon: Clock },
  critical: { text: "text-status-critical", bg: "bg-status-critical-bg", icon: AlertTriangle },
  inactive: { text: "text-status-inactive", bg: "bg-status-inactive-bg", icon: MinusCircle },
};

interface StatusBadgeProps {
  tone: StatusTone;
  label: string;
  /** Required: every status shown must carry a stated reason (design-system spec). */
  reason: string;
  className?: string;
}

/**
 * Renders a status with color + icon + label, and always surfaces its
 * reason as adjacent text — `reason` is required so a screen cannot ship
 * an unexplained status.
 */
export function StatusBadge({ tone, label, reason, className = "" }: StatusBadgeProps) {
  const { text, bg, icon: Icon } = TONE_STYLES[tone];
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span
        className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${text} ${bg}`}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="text-xs text-neutral-500 dark:text-neutral-400">{reason}</span>
    </div>
  );
}
