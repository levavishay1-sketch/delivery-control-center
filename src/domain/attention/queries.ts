import { db } from "@/lib/db";
import type { AuthContext } from "@/domain/shared/context";
import { getHighRiskWorkItems, getUpcomingDeadlines } from "@/domain/work-item/queries";

/** clientIds ctx can access — undefined (no filter) for org admins. */
function accessibleClientIds(ctx: AuthContext): string[] | undefined {
  return ctx.isOrgAdmin ? undefined : ctx.memberships.map((m) => m.clientId);
}

/**
 * Aggregates every item needing human attention across all projects ctx can
 * access: pending decisions, active blockers, high/critical risks, upcoming
 * deadlines, and work items awaiting review approval. Each group is sorted
 * by urgency (overdue/oldest first). Feeds the Attention Center (`/attention`)
 * and the Dashboard's attention summary card.
 */
export async function getItemsNeedingAttention(ctx: AuthContext) {
  const clientIds = accessibleClientIds(ctx);
  const projectScope = clientIds ? { clientId: { in: clientIds } } : undefined;

  const [decisions, blockers, risks, deadlines, approvalGates] = await Promise.all([
    db.decision.findMany({
      where: {
        status: "OPEN",
        workItem: { project: projectScope },
      },
      include: { workItem: { include: { project: true, owner: true } } },
      orderBy: [{ deadline: "asc" }, { createdAt: "asc" }],
    }),
    db.blocker.findMany({
      where: {
        resolvedAt: null,
        blockingItem: { project: projectScope },
      },
      include: { blockingItem: { include: { project: true } }, owner: true },
      orderBy: { blockedSince: "asc" },
    }),
    getHighRiskWorkItems(ctx),
    getUpcomingDeadlines(ctx),
    db.workItem.findMany({
      where: {
        status: "REVIEW",
        project: projectScope,
      },
      include: { project: true, owner: true, pipeline: true },
      orderBy: { syncedAt: "asc" },
    }),
  ]);

  return {
    decisions,
    blockers,
    risks,
    deadlines,
    approvalGates,
    now: Date.now(),
    summary: {
      decisions: decisions.length,
      blockers: blockers.length,
      risks: risks.length,
      deadlines: deadlines.length,
      approvalGates: approvalGates.length,
    },
  };
}
