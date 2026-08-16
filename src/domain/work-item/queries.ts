import { db } from "@/lib/db";
import type { WorkItemType, WorkStatus } from "@/generated/prisma/client";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, ALL_ROLES } from "@/domain/shared/authz";
import { getProjectById } from "@/domain/project/queries";
import { NotFoundError } from "@/domain/shared/errors";

export interface ListWorkItemsFilters {
  type?: WorkItemType;
  status?: WorkStatus;
  ownerId?: string;
  parentId?: string | null;
  page?: number;
  pageSize?: number;
}

/** Single work item, scoped to ctx's access on its project's client. Returns null if not found or not accessible. */
export async function getWorkItem(ctx: AuthContext, id: string) {
  const workItem = await db.workItem.findUnique({
    where: { id },
    include: { project: true, owner: true, executor: true, parent: true },
  });
  if (!workItem) return null;
  requireClientRole(ctx, workItem.project.clientId, ALL_ROLES);
  return workItem;
}

/** Full work item detail for the 360° Record / Quick View — includes parent, children, and pipeline+stages for the AI cost breakdown. */
export async function getWorkItemDetail(ctx: AuthContext, id: string) {
  const workItem = await db.workItem.findUnique({
    where: { id },
    include: {
      project: true,
      owner: true,
      executor: true,
      parent: { include: { pipeline: true } },
      children: { include: { owner: true, pipeline: true }, orderBy: { createdAt: "asc" } },
      pipeline: { include: { stages: true } },
      // Slice 4 — "where did this field's value come from" (design.md field-provenance capability).
      fieldProvenance: { include: { actorUser: true } },
    },
  });
  if (!workItem) return null;
  requireClientRole(ctx, workItem.project.clientId, ALL_ROLES);
  return workItem;
}

/** Unchecked lookup for internal domain use (e.g. by other commands resolving a work item before their own authz check). */
export async function getWorkItemById(id: string) {
  return db.workItem.findUnique({ where: { id } });
}

/** Paginated, optionally filtered work items for a project ctx can access. */
export async function listWorkItems(ctx: AuthContext, projectId: string, filters: ListWorkItemsFilters = {}) {
  const project = await getProjectById(projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, ALL_ROLES);

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;

  const where = {
    projectId,
    type: filters.type,
    status: filters.status,
    ownerId: filters.ownerId,
    parentId: filters.parentId === undefined ? undefined : filters.parentId,
  };

  const [items, total] = await Promise.all([
    db.workItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { owner: true, executor: true },
    }),
    db.workItem.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

/** All work items in a given status for a project ctx can access — used by the Attention Center's "Approval Gates" group. */
export async function getWorkItemsByStatus(ctx: AuthContext, projectId: string, status: WorkStatus) {
  const project = await getProjectById(projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, ALL_ROLES);

  return db.workItem.findMany({
    where: { projectId, status },
    orderBy: { dueDate: "asc" },
    include: { owner: true },
  });
}

/** All descendants (direct children only, not transitive) of a work item ctx can access. */
export async function getWorkItemHierarchy(ctx: AuthContext, parentId: string) {
  const parent = await getWorkItem(ctx, parentId);
  if (!parent) throw new NotFoundError("Work item not found");

  return db.workItem.findMany({
    where: { parentId },
    orderBy: { createdAt: "asc" },
    include: { owner: true },
  });
}

const RISK_ORDER: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/** Work items with risk >= HIGH across all of ctx's accessible projects — feeds the Attention Center "Risks" group. */
export async function getHighRiskWorkItems(ctx: AuthContext) {
  const clientIds = ctx.isOrgAdmin ? undefined : ctx.memberships.map((m) => m.clientId);
  const items = await db.workItem.findMany({
    where: {
      risk: { in: ["HIGH", "CRITICAL"] },
      status: { notIn: ["COMPLETED", "CLOSED"] },
      // Slice 12 — excludes work under a deactivated client (active-work surface only).
      project: { client: { active: true }, ...(clientIds ? { clientId: { in: clientIds } } : {}) },
    },
    include: { owner: true, project: true, pipeline: true },
  });
  return items.sort((a, b) => RISK_ORDER[b.risk] - RISK_ORDER[a.risk]);
}

/** Work items due within `withinDays` (default 7) that aren't already done — feeds the Attention Center "Deadlines" group. */
export async function getUpcomingDeadlines(ctx: AuthContext, withinDays = 7) {
  const clientIds = ctx.isOrgAdmin ? undefined : ctx.memberships.map((m) => m.clientId);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + withinDays);

  return db.workItem.findMany({
    where: {
      dueDate: { lte: cutoff, not: null },
      status: { notIn: ["COMPLETED", "CLOSED"] },
      // Slice 12 — excludes work under a deactivated client (active-work surface only).
      project: { client: { active: true }, ...(clientIds ? { clientId: { in: clientIds } } : {}) },
    },
    orderBy: { dueDate: "asc" },
    include: { owner: true, project: true, pipeline: true },
  });
}
