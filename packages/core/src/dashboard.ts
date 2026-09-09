import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db, withoutTenant } from "@dcc/db";
import {
  blocker,
  client,
  clientBudget,
  eventLog,
  gap,
  notification,
  project,
  users,
  workitem,
} from "@dcc/db/schema";

/**
 * The dashboard reads across ALL clients (it's an org-admin view), so it
 * runs through `withoutTenant` on the non-RLS path where possible and
 * aggregates per client. On a real Postgres this needs the admin role
 * (F-3); on the dev DB (superuser) it just works.
 */

export type DashboardStats = {
  decisions: number;
  blockers: number;
  risks: number;
  deadlines: number;
};

export async function dashboard(forUserId: string) {
  // ---- stat tiles ----
  const [decisionsRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(gap)
    .where(sql`${gap.state} = 'proposed'`);
  const [blockersRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(blocker)
    .where(sql`${blocker.state} = 'open'`);
  const [risksRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workitem)
    .where(sql`${workitem.risk} = 'high' and ${workitem.phase} not in ('done','archived')`);
  const soon = new Date(Date.now() + 3 * 864e5);
  const [deadlinesRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workitem)
    .where(sql`${workitem.dueDate} is not null and ${workitem.dueDate} <= ${soon} and ${workitem.phase} not in ('done','archived')`);

  const stats: DashboardStats = {
    decisions: decisionsRow?.n ?? 0,
    blockers: blockersRow?.n ?? 0,
    risks: risksRow?.n ?? 0,
    deadlines: deadlinesRow?.n ?? 0,
  };

  // ---- quick access: projects with activity ----
  const projectRows = await db
    .select({
      id: project.id,
      name: project.name,
      clientName: client.name,
      clientId: client.id,
      items: sql<number>`count(${workitem.id})::int`,
      lastUpdate: sql<Date | null>`max(${workitem.updatedAt})`,
    })
    .from(project)
    .innerJoin(client, eq(client.id, project.clientId))
    .leftJoin(workitem, eq(workitem.projectId, project.id))
    .where(isNull(project.archivedAt))
    .groupBy(project.id, client.name, client.id)
    .orderBy(desc(sql`max(${workitem.updatedAt})`))
    .limit(8);

  // ---- per-client panels ----
  const clients = await db.select().from(client).where(isNull(client.archivedAt));
  const panels = [];
  for (const c of clients) {
    const [budget] = await db.select().from(clientBudget).where(eq(clientBudget.clientId, c.id));
    const members = await db
      .selectDistinct({ id: users.id, name: users.displayName })
      .from(workitem)
      .innerJoin(users, eq(users.id, workitem.ownerId))
      .where(eq(workitem.clientId, c.id))
      .limit(6);
    const items = await db
      .select({
        id: workitem.id,
        key: workitem.key,
        title: workitem.title,
        kind: workitem.kind,
        phase: workitem.phase,
        priority: workitem.priority,
        startedWithOpenBlocker: workitem.startedWithOpenBlocker,
      })
      .from(workitem)
      .where(and(eq(workitem.clientId, c.id), sql`${workitem.phase} not in ('archived')`))
      .orderBy(desc(workitem.updatedAt))
      .limit(4);
    if (items.length === 0) continue;

    // status pill per item, from open blockers/gaps
    const withStatus = [];
    for (const it of items) {
      const [b] = await db.select({ n: sql<number>`count(*)::int` }).from(blocker).where(sql`${blocker.workitemId} = ${it.id} and ${blocker.state} = 'open'`);
      const [g] = await db.select({ n: sql<number>`count(*)::int` }).from(gap).where(sql`${gap.workitemId} = ${it.id} and ${gap.state} = 'proposed'`);
      let status: "blocked" | "in_pipeline" | "ai_drafting" | "done" = "in_pipeline";
      if ((b?.n ?? 0) > 0) status = "blocked";
      else if ((g?.n ?? 0) > 0) status = "ai_drafting";
      else if (it.phase === "done") status = "done";
      withStatus.push({ ...it, status });
    }

    const monthly = Number(budget?.monthlyUsd ?? 300);
    const spent = Number(budget?.spentUsd ?? 0);
    panels.push({
      clientId: c.id,
      clientName: c.name,
      aiCostUsd: spent,
      budgetUsd: monthly,
      budgetPct: monthly > 0 ? Math.min(100, Math.round((spent / monthly) * 100)) : 0,
      members,
      items: withStatus,
    });
  }

  // ---- recent notifications for this user ----
  const notes = await db
    .select()
    .from(notification)
    .where(eq(notification.forUserId, forUserId))
    .orderBy(desc(notification.createdAt))
    .limit(6);

  return { stats, quickAccess: projectRows, panels, notifications: notes };
}

export type AuditFilter = {
  projectId?: string;
  actorKind?: "user" | "delegated" | "system";
  type?: string;
  from?: Date;
  to?: Date;
  page?: number;
};

export async function auditTrail(f: AuditFilter) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = 25;
  const conds = [];
  if (f.type) conds.push(eq(eventLog.type, f.type));
  if (f.from) conds.push(gte(eventLog.occurredAt, f.from));
  if (f.to) conds.push(lte(eventLog.occurredAt, f.to));
  if (f.actorKind) conds.push(sql`${eventLog.actor}->>'kind' = ${f.actorKind}`);

  const rows = await db
    .select({
      id: eventLog.id,
      occurredAt: eventLog.occurredAt,
      type: eventLog.type,
      source: eventLog.source,
      actor: eventLog.actor,
      payload: eventLog.payload,
      workitemId: eventLog.workitemId,
      wiKey: workitem.key,
      wiTitle: workitem.title,
      projectName: project.name,
      clientName: client.name,
    })
    .from(eventLog)
    .leftJoin(workitem, eq(workitem.id, eventLog.workitemId))
    .leftJoin(project, eq(project.id, workitem.projectId))
    .leftJoin(client, eq(client.id, eventLog.clientId))
    .where(conds.length ? and(...conds) : sql`true`)
    .orderBy(desc(eventLog.occurredAt))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);

  const hasNext = rows.length > pageSize;
  return { page, hasNext, rows: rows.slice(0, pageSize) };
}

void withoutTenant;
