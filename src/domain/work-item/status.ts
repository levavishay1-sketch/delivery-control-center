import type { WorkStatus } from "@/generated/prisma/client";
import { ValidationError } from "@/domain/shared/errors";

/**
 * Manual status transitions a user can request via updateWorkItemStatus.
 * BLOCKED and DECISION_REQUIRED are deliberately unreachable from here in
 * both directions: entering them is a side effect of createBlocker/
 * createDecision, and leaving them is a side effect of resolveBlocker/
 * approveDecision/rejectDecision (see their commands). COMPLETED and CLOSED
 * are terminal — see design.md's "WorkItem Status Lifecycle".
 */
const ALLOWED_TRANSITIONS: Record<WorkStatus, WorkStatus[]> = {
  DRAFT: ["OPEN", "CLOSED"],
  OPEN: ["IN_PROGRESS", "CLOSED"],
  IN_PROGRESS: ["REVIEW", "CLOSED"],
  DECISION_REQUIRED: [],
  BLOCKED: [],
  REVIEW: ["APPROVED", "IN_PROGRESS", "CLOSED"],
  APPROVED: ["COMPLETED", "CLOSED"],
  COMPLETED: [],
  CLOSED: [],
};

export function assertValidTransition(from: WorkStatus, to: WorkStatus): void {
  if (from === to) return;
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new ValidationError(
      `Cannot move a work item from ${from} to ${to}. Allowed transitions from ${from}: ${
        allowed.length ? allowed.join(", ") : "none (only via blocker/decision resolution)"
      }.`
    );
  }
}
