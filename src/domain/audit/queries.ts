import { db } from "@/lib/db";
import type { AuthContext } from "@/domain/shared/context";

/** Audit events, scoped to clients ctx can see (undefined clientIds = org admin, no filter). */
export async function listRecentAuditEvents(ctx: AuthContext, limit = 200) {
  const clientIds = ctx.isOrgAdmin ? undefined : ctx.memberships.map((m) => m.clientId);

  return db.auditEvent.findMany({
    where: clientIds
      ? {
          OR: [
            { project: { clientId: { in: clientIds } } },
            { pipeline: { workItem: { project: { clientId: { in: clientIds } } } } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      project: true,
      pipeline: { include: { workItem: true } },
      stage: true,
      workItem: { include: { pipeline: true } },
    },
  });
}
