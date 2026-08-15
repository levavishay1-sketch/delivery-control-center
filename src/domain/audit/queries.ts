import { db } from "@/lib/db";
import type { AuthContext } from "@/domain/shared/context";
import { getWorkItem } from "@/domain/work-item/queries";
import { NotFoundError } from "@/domain/shared/errors";

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

/** Paginated audit trail for a single work item (Timeline tab) — most recent first. Authorization via getWorkItem. */
export async function getWorkItemAuditEvents(ctx: AuthContext, workItemId: string, page = 1, pageSize = 20) {
  const workItem = await getWorkItem(ctx, workItemId);
  if (!workItem) throw new NotFoundError("Work item not found");

  const [events, total] = await Promise.all([
    db.auditEvent.findMany({
      where: { workItemId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.auditEvent.count({ where: { workItemId } }),
  ]);

  return { events, total, page, pageSize };
}
