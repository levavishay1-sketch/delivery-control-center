import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@dcc/db";
import {
  blocker,
  client,
  clientBudget,
  eventLog,
  notification,
  project,
  users,
  workitem,
} from "@dcc/db/schema";

/**
 * The dashboard payload, shaped for the approved visual template:
 * 4 stat tiles, a recent-projects grid, a recent-work-items table, and
 * a recent-alerts rail. Every value is real backend data — counts of our
 * WorkItems / blockers, sums of client AI spend, our notifications.
 *
 * Reads across all clients (an org-admin view). On the dev DB the app
 * connects as superuser so this just works; on a real Postgres it needs
 * the admin role (architecture-review F-3).
 */

const MONTH_AGO = () => new Date(Date.now() - 30 * 864e5);

export async function dashboard(forUserId: string) {
  const monthAgo = MONTH_AGO();

  const [activeProjects] = await db.select({ n: sql<number>`count(*)::int` }).from(project).where(sql`${project.status} = 'active' and ${project.archivedAt} is null`);
  const [newProjects] = await db.select({ n: sql<number>`count(*)::int` }).from(project).where(sql`${project.createdAt} >= ${monthAgo}`);
  const [openItems] = await db.select({ n: sql<number>`count(*)::int` }).from(workitem).where(sql`${workitem.phase} not in ('done','archived')`);
  const [newItems] = await db.select({ n: sql<number>`count(*)::int` }).from(workitem).where(sql`${workitem.createdAt} >= ${monthAgo}`);
  const [blockedItems] = await db.select({ n: sql<number>`count(distinct ${blocker.workitemId})::int` }).from(blocker).where(sql`${blocker.state} = 'open'`);
  const [spend] = await db.select({ spent: sql<number>`coalesce(sum(${clientBudget.spentUsd}),0)::float`, budget: sql<number>`coalesce(sum(${clientBudget.monthlyUsd}),0)::float` }).from(clientBudget);
  const spent = spend?.spent ?? 0;
  const budget = spend?.budget ?? 0;

  const stats = {
    activeProjects: activeProjects?.n ?? 0,
    projectsDelta: newProjects?.n ?? 0,
    openItems: openItems?.n ?? 0,
    itemsDelta: newItems?.n ?? 0,
    blockedItems: blockedItems?.n ?? 0,
    aiCostUsd: Math.round(spent * 100) / 100,
    aiBudgetUsd: budget,
    aiBudgetPct: budget > 0 ? Math.round((spent / budget) * 100) : 0,
  };

  // ---- recent projects ----
  const projRows = await db
    .select({
      id: project.id,
      name: project.name,
      status: project.status,
      connectorType: project.connectorType,
      budgetUsd: project.budgetUsd,
      clientName: client.name,
      clientId: client.id,
      items: sql<number>`count(distinct ${workitem.id})::int`,
      updatedAt: sql<Date | null>`max(${workitem.updatedAt})`,
    })
    .from(project)
    .innerJoin(client, eq(client.id, project.clientId))
    .leftJoin(workitem, eq(workitem.projectId, project.id))
    .where(isNull(project.archivedAt))
    .groupBy(project.id, client.name, client.id)
    .orderBy(desc(sql`max(${workitem.updatedAt})`))
    .limit(4);

  // per-project AI spend, from routed model calls on that project's work items
  const projSpend = await db
    .select({ projectId: workitem.projectId, spent: sql<number>`coalesce(sum((${eventLog.payload}->>'budgetUsd')::float),0)::float` })
    .from(eventLog)
    .innerJoin(workitem, eq(workitem.id, eventLog.workitemId))
    .where(sql`${eventLog.type} = 'model.routed'`)
    .groupBy(workitem.projectId);
  const spendByProject = new Map(projSpend.map((r) => [r.projectId, r.spent]));

  const projects = [];
  for (const p of projRows) {
    const members = await db
      .selectDistinct({ id: users.id, name: users.displayName })
      .from(workitem)
      .innerJoin(users, eq(users.id, workitem.ownerId))
      .where(eq(workitem.projectId, p.id))
      .limit(5);
    projects.push({
      id: p.id, name: p.name, status: p.status, connectorType: p.connectorType,
      clientName: p.clientName,
      budgetUsd: p.budgetUsd ? Number(p.budgetUsd) : null,
      aiCostUsd: Math.round((spendByProject.get(p.id) ?? 0) * 100) / 100,
      items: p.items,
      members,
    });
  }

  // ---- recent work items ----
  const wiRows = await db
    .select({
      id: workitem.id, key: workitem.key, title: workitem.title, kind: workitem.kind,
      priority: workitem.priority, budgetUsd: workitem.budgetUsd, phase: workitem.phase,
      updatedAt: workitem.updatedAt,
      projectName: project.name, ownerName: users.displayName,
    })
    .from(workitem)
    .innerJoin(project, eq(project.id, workitem.projectId))
    .innerJoin(users, eq(users.id, workitem.ownerId))
    .where(sql`${workitem.phase} not in ('archived')`)
    .orderBy(desc(workitem.updatedAt))
    .limit(6);

  // AI-spend trend per work item, from its model.routed events
  const wiSpend = await db
    .select({ workitemId: eventLog.workitemId, spent: sql<number>`coalesce(sum((${eventLog.payload}->>'budgetUsd')::float),0)::float`, calls: sql<number>`count(*)::int` })
    .from(eventLog)
    .where(sql`${eventLog.type} = 'model.routed'`)
    .groupBy(eventLog.workitemId);
  const spendByWi = new Map(wiSpend.map((r) => [r.workitemId, r]));

  const recentWorkItems = wiRows.map((w) => {
    const s = spendByWi.get(w.id);
    const cap = w.budgetUsd ? Number(w.budgetUsd) : null;
    const used = s?.spent ?? 0;
    let trend: "up" | "down" | "flat" = "flat";
    if (cap && used > cap * 0.8) trend = "up";
    else if (cap && used < cap * 0.3) trend = "down";
    return {
      id: w.id, key: w.key, title: w.title, kind: w.kind, priority: w.priority,
      projectName: w.projectName, ownerName: w.ownerName, updatedAt: w.updatedAt,
      aiSpentUsd: Math.round(used * 100) / 100, aiBudgetUsd: cap, trend,
    };
  });

  const alerts = await db
    .select()
    .from(notification)
    .where(eq(notification.forUserId, forUserId))
    .orderBy(desc(notification.createdAt))
    .limit(4);

  return { stats, projects, recentWorkItems, alerts };
}

// ---- full lists for the nav screens ----

export async function listAllWorkItems() {
  return db
    .select({
      id: workitem.id, key: workitem.key, title: workitem.title, kind: workitem.kind,
      phase: workitem.phase, priority: workitem.priority, risk: workitem.risk,
      updatedAt: workitem.updatedAt, projectName: project.name, clientName: client.name,
      ownerName: users.displayName,
      openBlockers: sql<number>`(select count(*) from blocker b where b.workitem_id = ${workitem.id} and b.state = 'open')::int`,
    })
    .from(workitem)
    .innerJoin(project, eq(project.id, workitem.projectId))
    .innerJoin(client, eq(client.id, workitem.clientId))
    .innerJoin(users, eq(users.id, workitem.ownerId))
    .orderBy(desc(workitem.updatedAt))
    .limit(200);
}

export async function listAllProjects() {
  return db
    .select({
      id: project.id, name: project.name, status: project.status, connectorType: project.connectorType,
      budgetUsd: project.budgetUsd, clientName: client.name,
      items: sql<number>`count(distinct ${workitem.id})::int`,
      updatedAt: sql<Date | null>`max(${workitem.updatedAt})`,
    })
    .from(project)
    .innerJoin(client, eq(client.id, project.clientId))
    .leftJoin(workitem, eq(workitem.projectId, project.id))
    .where(isNull(project.archivedAt))
    .groupBy(project.id, client.name)
    .orderBy(project.name);
}

export async function listBudgets() {
  const rows = await db
    .select({ clientId: clientBudget.clientId, clientName: client.name, monthlyUsd: clientBudget.monthlyUsd, spentUsd: clientBudget.spentUsd })
    .from(clientBudget)
    .innerJoin(client, eq(client.id, clientBudget.clientId))
    .orderBy(client.name);
  return rows.map((r) => ({
    clientId: r.clientId, clientName: r.clientName,
    monthlyUsd: Number(r.monthlyUsd), spentUsd: Number(r.spentUsd),
    pct: Number(r.monthlyUsd) > 0 ? Math.round((Number(r.spentUsd) / Number(r.monthlyUsd)) * 100) : 0,
  }));
}

export async function listAlerts(forUserId: string) {
  return db.select().from(notification).where(eq(notification.forUserId, forUserId)).orderBy(desc(notification.createdAt)).limit(50);
}

// ---- audit trail ----
export type AuditFilter = { actorKind?: "user" | "delegated" | "system"; type?: string; from?: Date; to?: Date; page?: number };

export async function auditTrail(f: AuditFilter) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = 25;
  const conds = [];
  if (f.type) conds.push(eq(eventLog.type, f.type));
  if (f.from) conds.push(sql`${eventLog.occurredAt} >= ${f.from}`);
  if (f.to) conds.push(sql`${eventLog.occurredAt} <= ${f.to}`);
  if (f.actorKind) conds.push(sql`${eventLog.actor}->>'kind' = ${f.actorKind}`);

  const rows = await db
    .select({
      id: eventLog.id, occurredAt: eventLog.occurredAt, type: eventLog.type, source: eventLog.source,
      actor: eventLog.actor, payload: eventLog.payload, workitemId: eventLog.workitemId,
      wiKey: workitem.key, wiTitle: workitem.title, projectName: project.name, clientName: client.name,
    })
    .from(eventLog)
    .leftJoin(workitem, eq(workitem.id, eventLog.workitemId))
    .leftJoin(project, eq(project.id, workitem.projectId))
    .leftJoin(client, eq(client.id, eventLog.clientId))
    .where(conds.length ? and(...conds) : sql`true`)
    .orderBy(desc(eventLog.occurredAt))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);

  return { page, hasNext: rows.length > pageSize, rows: rows.slice(0, pageSize) };
}
