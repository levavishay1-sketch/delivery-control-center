import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@dcc/db";
import {
  blocker,
  claudeCall,
  client,
  clientBudget,
  eventLog,
  notification,
  users,
  workitem,
} from "@dcc/db/schema";

/** Month-to-date, the period every AI-cost tile means. */
const MONTH_START = sql`date_trunc('month', now())`;

/**
 * The dashboard payload, shaped for the approved visual template:
 * 4 stat tiles, a recent top-level-requirements grid, a recent-work-items
 * table, and a recent-alerts rail. Every value is real backend data.
 *
 * There is no "project" — a client owns a forest of requirements. A
 * "top-level requirement" (parent_id IS NULL) is what used to be a
 * project: an epic/feature that groups a subtree of work.
 *
 * Reads across all clients (an org-admin view). On the dev DB the app
 * connects as superuser so this just works; on a real Postgres it needs
 * the admin role (architecture-review F-3).
 */

const MONTH_AGO = () => new Date(Date.now() - 30 * 864e5);
const OPEN = sql`phase not in ('done','archived')`;

export async function dashboard(forUserId: string) {
  const monthAgo = MONTH_AGO();

  const [initiatives] = await db.select({ n: sql<number>`count(*)::int` }).from(workitem).where(sql`${workitem.parentId} is null and ${OPEN}`);
  const [newInitiatives] = await db.select({ n: sql<number>`count(*)::int` }).from(workitem).where(sql`${workitem.parentId} is null and ${workitem.createdAt} >= ${monthAgo}`);
  const [openItems] = await db.select({ n: sql<number>`count(*)::int` }).from(workitem).where(sql`${workitem.phase} not in ('done','archived')`);
  const [newItems] = await db.select({ n: sql<number>`count(*)::int` }).from(workitem).where(sql`${workitem.createdAt} >= ${monthAgo}`);
  const [blockedItems] = await db.select({ n: sql<number>`count(distinct ${blocker.workitemId})::int` }).from(blocker).where(sql`${blocker.state} = 'open'`);
  // The month's AI spend is a sum over the ledger — the one place cost is counted (claude-in-dcc §8.2).
  const [spend] = await db.select({ spent: sql<number>`coalesce(sum(${claudeCall.costUsd}),0)::float` }).from(claudeCall).where(sql`${claudeCall.startedAt} >= ${MONTH_START}`);
  const [budgetRow] = await db.select({ budget: sql<number>`coalesce(sum(${clientBudget.monthlyUsd}),0)::float` }).from(clientBudget);
  const spent = spend?.spent ?? 0;
  const budget = budgetRow?.budget ?? 0;

  const stats = {
    initiatives: initiatives?.n ?? 0,
    initiativesDelta: newInitiatives?.n ?? 0,
    openItems: openItems?.n ?? 0,
    itemsDelta: newItems?.n ?? 0,
    blockedItems: blockedItems?.n ?? 0,
    aiCostUsd: Math.round(spent * 100) / 100,
    aiBudgetUsd: budget,
    aiBudgetPct: budget > 0 ? Math.round((spent / budget) * 100) : 0,
  };

  // ---- recent top-level requirements ----
  const childCount = db.$with("child_count").as(
    db.select({ parentId: workitem.parentId, n: sql<number>`count(*)::int`.as("n") })
      .from(workitem).where(sql`${workitem.parentId} is not null`).groupBy(workitem.parentId),
  );
  const initRows = await db
    .with(childCount)
    .select({
      id: workitem.id,
      title: workitem.title,
      type: workitem.type,
      phase: workitem.phase,
      priority: workitem.priority,
      budgetUsd: workitem.budgetUsd,
      clientName: client.name,
      clientId: client.id,
      ownerName: users.displayName,
      children: sql<number>`coalesce(${childCount.n}, 0)`,
      updatedAt: workitem.updatedAt,
    })
    .from(workitem)
    .innerJoin(client, eq(client.id, workitem.clientId))
    .innerJoin(users, eq(users.id, workitem.ownerId))
    .leftJoin(childCount, eq(childCount.parentId, workitem.id))
    .where(isNull(workitem.parentId))
    .orderBy(desc(workitem.updatedAt))
    .limit(4);

  // This month's AI spend per requirement, from the ledger
  const wiSpendAll = await db
    .select({ workitemId: claudeCall.workitemId, spent: sql<number>`coalesce(sum(${claudeCall.costUsd}),0)::float`, calls: sql<number>`count(*)::int` })
    .from(claudeCall)
    .where(sql`${claudeCall.workitemId} is not null and ${claudeCall.startedAt} >= ${MONTH_START}`)
    .groupBy(claudeCall.workitemId);
  const spendByWi = new Map(wiSpendAll.map((r) => [r.workitemId, r]));

  const initiativesList = initRows.map((p) => ({
    id: p.id,
    name: p.title,
    type: p.type,
    phase: p.phase,
    priority: p.priority,
    clientName: p.clientName,
    clientId: p.clientId,
    ownerName: p.ownerName,
    budgetUsd: p.budgetUsd ? Number(p.budgetUsd) : null,
    aiCostUsd: Math.round((spendByWi.get(p.id)?.spent ?? 0) * 100) / 100,
    children: Number(p.children),
  }));

  // ---- recent work items ----
  const wiRows = await db
    .select({
      id: workitem.id, key: workitem.key, title: workitem.title, type: workitem.type,
      priority: workitem.priority, budgetUsd: workitem.budgetUsd, phase: workitem.phase,
      updatedAt: workitem.updatedAt,
      clientName: client.name, ownerName: users.displayName,
      parentTitle: sql<string | null>`(select w2.title from workitem w2 where w2.id = ${workitem.parentId})`,
    })
    .from(workitem)
    .innerJoin(client, eq(client.id, workitem.clientId))
    .innerJoin(users, eq(users.id, workitem.ownerId))
    .where(sql`${workitem.phase} not in ('archived')`)
    .orderBy(desc(workitem.updatedAt))
    .limit(6);

  const recentWorkItems = wiRows.map((w) => {
    const s = spendByWi.get(w.id);
    const cap = w.budgetUsd ? Number(w.budgetUsd) : null;
    const used = s?.spent ?? 0;
    let trend: "up" | "down" | "flat" = "flat";
    if (cap && used > cap * 0.8) trend = "up";
    else if (cap && used < cap * 0.3) trend = "down";
    return {
      id: w.id, key: w.key, title: w.title, type: w.type, priority: w.priority,
      parentTitle: w.parentTitle, clientName: w.clientName, ownerName: w.ownerName, updatedAt: w.updatedAt,
      aiSpentUsd: Math.round(used * 100) / 100, aiBudgetUsd: cap, trend,
    };
  });

  const alerts = await db
    .select()
    .from(notification)
    .where(eq(notification.forUserId, forUserId))
    .orderBy(desc(notification.createdAt))
    .limit(4);

  return { stats, initiatives: initiativesList, recentWorkItems, alerts };
}

// ---- full lists for the nav screens ----

export async function listAllWorkItems() {
  return db
    .select({
      id: workitem.id, key: workitem.key, title: workitem.title, type: workitem.type,
      phase: workitem.phase, priority: workitem.priority, risk: workitem.risk,
      parentId: workitem.parentId,
      parentTitle: sql<string | null>`(select w2.title from workitem w2 where w2.id = ${workitem.parentId})`,
      updatedAt: workitem.updatedAt, clientName: client.name,
      ownerName: users.displayName,
      openBlockers: sql<number>`(select count(*) from blocker b where b.workitem_id = ${workitem.id} and b.state = 'open')::int`,
    })
    .from(workitem)
    .innerJoin(client, eq(client.id, workitem.clientId))
    .innerJoin(users, eq(users.id, workitem.ownerId))
    .orderBy(desc(workitem.updatedAt))
    .limit(200);
}

/** Top-level requirements (was "projects") with subtree counts. */
export async function listInitiatives() {
  return db
    .select({
      id: workitem.id, name: workitem.title, type: workitem.type, phase: workitem.phase,
      priority: workitem.priority, budgetUsd: workitem.budgetUsd, clientName: client.name, clientId: client.id,
      items: sql<number>`(select count(*) from workitem w2 where w2.parent_id = ${workitem.id})::int`,
      updatedAt: workitem.updatedAt,
    })
    .from(workitem)
    .innerJoin(client, eq(client.id, workitem.clientId))
    .where(isNull(workitem.parentId))
    .orderBy(workitem.title);
}

export async function listBudgets() {
  const rows = await db
    .select({ clientId: clientBudget.clientId, clientName: client.name, monthlyUsd: clientBudget.monthlyUsd })
    .from(clientBudget)
    .innerJoin(client, eq(client.id, clientBudget.clientId))
    .orderBy(client.name);
  // Spend is a sum over the ledger, month to date — never a cached column.
  const spend = await db
    .select({ clientId: claudeCall.clientId, spent: sql<number>`coalesce(sum(${claudeCall.costUsd}),0)::float` })
    .from(claudeCall)
    .where(sql`${claudeCall.startedAt} >= ${MONTH_START}`)
    .groupBy(claudeCall.clientId);
  const spentBy = new Map(spend.map((s) => [s.clientId, s.spent]));
  return rows.map((r) => {
    const spentUsd = Math.round((spentBy.get(r.clientId) ?? 0) * 100) / 100;
    return {
      clientId: r.clientId, clientName: r.clientName,
      monthlyUsd: Number(r.monthlyUsd), spentUsd,
      pct: Number(r.monthlyUsd) > 0 ? Math.round((spentUsd / Number(r.monthlyUsd)) * 100) : 0,
    };
  });
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
      wiKey: workitem.key, wiTitle: workitem.title, clientName: client.name,
    })
    .from(eventLog)
    .leftJoin(workitem, eq(workitem.id, eventLog.workitemId))
    .leftJoin(client, eq(client.id, eventLog.clientId))
    .where(conds.length ? and(...conds) : sql`true`)
    .orderBy(desc(eventLog.occurredAt))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);

  return { page, hasNext: rows.length > pageSize, rows: rows.slice(0, pageSize) };
}
