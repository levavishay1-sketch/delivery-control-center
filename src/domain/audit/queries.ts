import type { Prisma } from "@/generated/prisma/client";
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

/**
 * `AuditEvent.action` is a free-text human-readable sentence (e.g. `"Alice created
 * work item \"Fix login bug\""`), not a stored enum — recordAuditEvent() was designed
 * that way before Slice 1, and every one of the ~19 call sites across the domain
 * layer writes a unique interpolated sentence, not a fixed code. The Fixed Audit
 * Trail spec calls for a dropdown of action *types* (e.g. "WORK_ITEM_CREATED"), so
 * this maps each event's free text onto a coarse category via a distinctive
 * substring, letting the filter work without a schema/write-path change (out of
 * scope for a filtering UI task — see tasks.md's Task Group 10 notes).
 */
export const ACTION_CATEGORIES = [
  { key: "work_item_created", label: "Work Item Created", match: 'created work item "' },
  { key: "work_item_updated", label: "Work Item Updated", match: 'updated work item "' },
  { key: "work_item_status_changed", label: "Work Item Status Changed", match: 'moved "' },
  { key: "work_item_reparented", label: "Work Item Reparented", match: "a child of \"" },
  { key: "work_items_synced", label: "Work Items Synced", match: "Synced " },
  { key: "blocker_created", label: "Blocker Created", match: 'created blocker on "' },
  { key: "blocker_updated", label: "Blocker Updated", match: 'updated blocker on "' },
  { key: "blocker_resolved", label: "Blocker Resolved", match: 'resolved blocker on "' },
  { key: "decision_created", label: "Decision Created", match: 'created decision on "' },
  { key: "decision_approved", label: "Decision Approved", match: 'approved decision on "' },
  { key: "decision_rejected", label: "Decision Rejected", match: 'rejected decision on "' },
  { key: "dependency_added", label: "Dependency Added", match: 'added dependency: "' },
  { key: "dependency_removed", label: "Dependency Removed", match: 'removed dependency: "' },
  { key: "pipeline_created", label: "Pipeline Created", match: 'Pipeline created for "' },
  { key: "pipeline_advanced", label: "Pipeline Advanced", match: "Pipeline advanced to " },
  { key: "stage_ai_drafted", label: "Stage AI-Drafted", match: "AI drafted " },
  { key: "stage_auto_completed", label: "Stage Auto-Completed", match: "completed automatically" },
  { key: "stage_approved", label: "Stage Approved", match: "approved the " },
  { key: "stage_rejected", label: "Stage Rejected", match: "rejected the " },
] as const;

export type ActionCategoryKey = (typeof ACTION_CATEGORIES)[number]["key"];

export interface AuditFilters {
  projectId?: string;
  /** A real user's id, or the pseudo-values "SYSTEM"/"AI" for those actor types. */
  actorId?: string;
  actionCategory?: ActionCategoryKey;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  pageSize?: number;
}

function buildWhere(ctx: AuthContext, filters: AuditFilters): Prisma.AuditEventWhereInput {
  const clientIds = ctx.isOrgAdmin ? undefined : ctx.memberships.map((m) => m.clientId);

  const scope: Prisma.AuditEventWhereInput = clientIds
    ? { OR: [{ project: { clientId: { in: clientIds } } }, { pipeline: { workItem: { project: { clientId: { in: clientIds } } } } }] }
    : {};

  const and: Prisma.AuditEventWhereInput[] = [scope];

  if (filters.projectId) and.push({ projectId: filters.projectId });

  if (filters.actorId === "SYSTEM" || filters.actorId === "AI") {
    and.push({ actor: filters.actorId });
  } else if (filters.actorId) {
    and.push({ userId: filters.actorId });
  }

  if (filters.actionCategory) {
    const category = ACTION_CATEGORIES.find((c) => c.key === filters.actionCategory);
    if (category) and.push({ action: { contains: category.match } });
  }

  if (filters.dateFrom || filters.dateTo) {
    and.push({
      createdAt: {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      },
    });
  }

  return { AND: and };
}

/** Filtered, paginated audit trail — no hard truncation; callers page through the full history. */
export async function listAuditEvents(ctx: AuthContext, filters: AuditFilters = {}) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const where = buildWhere(ctx, filters);

  const [events, total] = await Promise.all([
    db.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        project: true,
        pipeline: { include: { workItem: true } },
        stage: true,
        workItem: { include: { pipeline: true } },
      },
    }),
    db.auditEvent.count({ where }),
  ]);

  return { events, total, page, pageSize };
}

/**
 * Distinct actors who have at least one audit event in ctx's accessible scope
 * (optionally narrowed to one project) — feeds the Actor filter dropdown.
 * Real users are returned by id/name; SYSTEM and AI are included as pseudo-actors
 * only when at least one such event exists in scope.
 */
export async function getAuditActors(ctx: AuthContext, projectId?: string) {
  const where = buildWhere(ctx, { projectId });

  const [userEvents, hasSystem, hasAi] = await Promise.all([
    db.auditEvent.findMany({
      where: { AND: [where, { actor: "USER", userId: { not: null } }] },
      distinct: ["userId"],
      select: { userId: true, actorName: true },
    }),
    db.auditEvent.count({ where: { AND: [where, { actor: "SYSTEM" }] }, take: 1 }),
    db.auditEvent.count({ where: { AND: [where, { actor: "AI" }] }, take: 1 }),
  ]);

  const users = userEvents
    .filter((e): e is { userId: string; actorName: string | null } => !!e.userId)
    .map((e) => ({ id: e.userId, label: e.actorName ?? e.userId }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [
    ...users,
    ...(hasSystem > 0 ? [{ id: "SYSTEM", label: "System" }] : []),
    ...(hasAi > 0 ? [{ id: "AI", label: "AI" }] : []),
  ];
}
