import type { StatusTone } from "@/components/ui/StatusBadge";

/**
 * Maps pipeline/stage/Constitution status strings onto the existing
 * five-tone `StatusTone` scale (design-system spec's "Duplicate status and
 * action components are consolidated" requirement) — retires `StageBadge`,
 * a second independent status-badge implementation with its own color map
 * and no required-reason presentation, in favor of the one shared
 * `StatusBadge`.
 */
export const STAGE_STATUS_TONES: Record<string, StatusTone> = {
  PENDING: "inactive",
  AI_DRAFTING: "ai",
  AWAITING_CLARIFICATION: "warning",
  PENDING_APPROVAL: "active",
  APPROVED: "healthy",
  DONE: "healthy",
  REJECTED: "critical",
  ACTIVE: "active",
  COMPLETED: "healthy",
  BLOCKED: "critical",
};

export function stageStatusTone(status: string): StatusTone {
  return STAGE_STATUS_TONES[status] ?? "inactive";
}

export function stageStatusLabel(status: string): string {
  return status.replaceAll("_", " ");
}
