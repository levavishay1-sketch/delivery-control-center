import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db, usd } from "@dcc/db";
import { claudeCall, client, conversation, conversationMessage, users } from "@dcc/db/schema";
import { loadPolicy } from "./routing.ts";

/**
 * The control center's reads (claude-in-dcc §9): every number here is a
 * slice of `claude_call` (and, for the chat, `conversation_message`) —
 * never a separate count. Reads across clients, like `dashboard.ts` (an
 * org-admin view; architecture-review F-3).
 */

export type CenterFilter = {
  /** "YYYY-MM"; the current month when absent. */
  month?: string | undefined;
  clientId?: string | undefined;
  userId?: string | undefined;
  capability?: string | undefined;
  model?: string | undefined;
  outcome?: string | undefined;
  /** Only calls the policy escalated, or a person chose a stronger model for. */
  escalated?: boolean | undefined;
  workitemId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

export function period(month: string | undefined): { from: Date; to: Date; month: string } {
  const now = new Date();
  const m = /^\d{4}-\d{2}$/.test(month ?? "") ? month! : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return { from: new Date(y, mo - 1, 1), to: new Date(y, mo, 1), month: m };
}

export const ESCALATED = sql`(${claudeCall.policyRule} like '%escalated%' or ${claudeCall.policyRule} like '%model overridden%')`;
/** The screen a conversation's topic belongs to — the same mapping the chat uses when it resolves a topic. */
export const TOPIC_SCREEN = sql<string>`case ${conversation.topicKind} when 'wi' then 'requirement' when 'task' then 'task' when 'pr' then 'pull_request' when 'run' then 'onboarding' else 'dashboard' end`;

function where(f: CenterFilter, p: { from: Date; to: Date }): SQL {
  const parts: SQL[] = [sql`${claudeCall.startedAt} >= ${p.from} and ${claudeCall.startedAt} < ${p.to}`];
  if (f.clientId) parts.push(eq(claudeCall.clientId, f.clientId));
  if (f.userId) parts.push(eq(claudeCall.userId, f.userId));
  if (f.capability) parts.push(eq(claudeCall.capability, f.capability));
  if (f.model) parts.push(eq(claudeCall.modelUsed, f.model));
  if (f.outcome) parts.push(eq(claudeCall.outcome, f.outcome));
  if (f.workitemId) parts.push(eq(claudeCall.workitemId, f.workitemId));
  if (f.escalated) parts.push(ESCALATED);
  return and(...parts)!;
}

export type CenterBar = { key: string; label: string; usd: number; calls: number };

export type ClaudeOverview = {
  month: string;
  tiles: {
    costUsd: number; calls: number; budgetPct: number | null;
    questions: number; answeredWithoutModel: number; answeredWithoutModelPct: number;
    unhelpful: number; unhelpfulPct: number; reasked: number;
    errors: number; timeouts: number; escalated: number; unanswered: number;
  };
  byClient: CenterBar[];
  byCapability: CenterBar[];
  byModel: CenterBar[];
  byScreen: CenterBar[];
  byUser: (CenterBar & { questions: number; withoutModelPct: number; unhelpfulPct: number })[];
  policy: { version: number; defaults: number; escalated: number; manual: number; capped: number };
  tokens: { input: number; cacheRead: number; cacheWrite: number; output: number; cacheSharePct: number };
  /** The measurements the chat is tuned by (claude-in-dcc §6.8): cost per question, tokens per turn, roll-overs and what their summaries cost, what retention removed. */
  chat: { calls: number; costPerQuestionUsd: number | null; tokensPerTurn: number | null; rollovers: number; rolloverCostUsd: number; archived: number };
  /** Answered without a model and "did not help", per screen — how much each screen says by itself. */
  chatByScreen: { screen: string; questions: number; withoutModel: number; withoutModelPct: number; unhelpful: number; unhelpfulPct: number }[];
  /** A capability that escalates in 30% or more of its calls has a disguised default. */
  escalationByCapability: { capability: string; escalated: number; total: number; pct: number }[];
};

export async function claudeOverview(f: CenterFilter = {}): Promise<ClaudeOverview> {
  const p = period(f.month);
  const w = where(f, p);
  const cost = sql<number>`coalesce(sum(${claudeCall.costUsd}),0)::float`;
  const n = sql<number>`count(*)::int`;

  const [totals] = await db.select({
    usd: cost, calls: n,
    input: sql<number>`coalesce(sum(${claudeCall.inputTokens}),0)::float`,
    cacheRead: sql<number>`coalesce(sum(${claudeCall.cacheReadTokens}),0)::float`,
    cacheWrite: sql<number>`coalesce(sum(${claudeCall.cacheWriteTokens}),0)::float`,
    output: sql<number>`coalesce(sum(${claudeCall.outputTokens}),0)::float`,
    errors: sql<number>`count(*) filter (where ${claudeCall.outcome} = 'error')::int`,
    timeouts: sql<number>`count(*) filter (where ${claudeCall.outcome} = 'timeout')::int`,
    escalated: sql<number>`count(*) filter (where ${ESCALATED})::int`,
    manual: sql<number>`count(*) filter (where ${claudeCall.policyRule} like '%overridden by user%')::int`,
    unanswered: sql<number>`count(*) filter (where ${claudeCall.unanswered})::int`,
    capped: sql<number>`count(*) filter (where ${claudeCall.outcome} = 'refused')::int`,
  }).from(claudeCall).where(w);

  const bars = async (key: SQL, label: SQL): Promise<CenterBar[]> => {
    const rows = await db.select({ key: sql<string>`${key}`, label: sql<string>`${label}`, usd: cost, calls: n })
      .from(claudeCall).where(w).groupBy(key, label).orderBy(desc(cost));
    return rows.map((r) => ({ key: r.key ?? "", label: r.label ?? "", usd: r.usd, calls: r.calls }));
  };
  const byClientRows = await db.select({ key: claudeCall.clientId, label: client.name, usd: cost, calls: n })
    .from(claudeCall).innerJoin(client, eq(client.id, claudeCall.clientId)).where(w).groupBy(claudeCall.clientId, client.name).orderBy(desc(cost));
  const byCapability = await bars(sql`${claudeCall.capability}`, sql`${claudeCall.capability}`);
  const byModel = await bars(sql`coalesce(${claudeCall.modelUsed}, ${claudeCall.modelRequested}, '?')`, sql`coalesce(${claudeCall.modelUsed}, ${claudeCall.modelRequested}, '?')`);
  const byScreen = await bars(sql`coalesce(${claudeCall.screen}, ${claudeCall.entityKind})`, sql`coalesce(${claudeCall.screen}, ${claudeCall.entityKind})`);
  const byUserRows = await db.select({ key: claudeCall.userId, label: users.displayName, usd: cost, calls: n })
    .from(claudeCall).innerJoin(users, eq(users.id, claudeCall.userId)).where(w).groupBy(claudeCall.userId, users.displayName).orderBy(desc(cost));

  // The chat's own numbers: questions asked, answered by the system with no
  // model, and answers that did not help — from the conversation, per person.
  const mw = and(
    sql`${conversationMessage.createdAt} >= ${p.from} and ${conversationMessage.createdAt} < ${p.to}`,
    eq(conversationMessage.role, "assistant"),
    ...(f.clientId ? [eq(conversationMessage.clientId, f.clientId)] : []),
  )!;
  const [chat] = await db.select({
    answers: n,
    system: sql<number>`count(*) filter (where ${conversationMessage.source} = 'system')::int`,
    unhelpful: sql<number>`count(*) filter (where ${conversationMessage.helpful} = false)::int`,
    reasked: sql<number>`count(*) filter (where ${conversationMessage.helpful} = false and ${conversationMessage.helpfulSource} = 'reasked')::int`,
  }).from(conversationMessage).where(mw);

  // The measurements (§6.8): what a chat question costs and carries, how
  // often a conversation rolled over and what the summaries cost, what
  // retention removed, how much each screen answers by itself, and which
  // capability keeps escalating.
  const [chatCalls] = await db.select({
    n, usd: cost,
    perTurn: sql<number>`coalesce(avg(${claudeCall.inputTokens} + ${claudeCall.cacheReadTokens} + ${claudeCall.cacheWriteTokens}), 0)::float`,
  }).from(claudeCall).where(and(w, eq(claudeCall.capability, "chat")));
  const [rollovers] = await db.select({ n, usd: cost }).from(claudeCall).where(and(w, eq(claudeCall.capability, "conversation_summary")));
  const [archived] = await db.select({ n }).from(conversation)
    .where(and(eq(conversation.status, "archived"), ...(f.clientId ? [eq(conversation.clientId, f.clientId)] : [])));
  const byScreenRows = await db.select({
    screen: TOPIC_SCREEN, answers: n,
    system: sql<number>`count(*) filter (where ${conversationMessage.source} = 'system')::int`,
    unhelpful: sql<number>`count(*) filter (where ${conversationMessage.helpful} = false)::int`,
  }).from(conversationMessage)
    .innerJoin(conversation, eq(conversation.id, conversationMessage.conversationId))
    .where(mw).groupBy(TOPIC_SCREEN).orderBy(desc(n));
  const escalationRows = await db.select({
    capability: claudeCall.capability, total: n,
    escalated: sql<number>`count(*) filter (where ${ESCALATED})::int`,
  }).from(claudeCall).where(w).groupBy(claudeCall.capability).having(sql`count(*) filter (where ${ESCALATED}) > 0`).orderBy(desc(sql`count(*) filter (where ${ESCALATED})`));

  const [budget] = f.clientId
    ? await db.execute<{ budget: number }>(sql`select coalesce(sum(monthly_usd),0)::float as budget from client_budget where client_id = ${f.clientId}`).then((r) => r.rows)
    : await db.execute<{ budget: number }>(sql`select coalesce(sum(monthly_usd),0)::float as budget from client_budget`).then((r) => r.rows);
  const budgetUsd = Number(budget?.budget ?? 0);

  const t = totals!;
  const inputAll = t.input + t.cacheRead + t.cacheWrite;
  const answers = chat?.answers ?? 0;
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
  return {
    month: p.month,
    tiles: {
      costUsd: t.usd, calls: t.calls, budgetPct: budgetUsd > 0 ? pct(t.usd, budgetUsd) : null,
      questions: answers, answeredWithoutModel: chat?.system ?? 0, answeredWithoutModelPct: pct(chat?.system ?? 0, answers),
      unhelpful: chat?.unhelpful ?? 0, unhelpfulPct: pct(chat?.unhelpful ?? 0, answers), reasked: chat?.reasked ?? 0,
      errors: t.errors, timeouts: t.timeouts, escalated: t.escalated, unanswered: t.unanswered,
    },
    byClient: byClientRows.map((r) => ({ key: r.key, label: r.label, usd: r.usd, calls: r.calls })),
    byCapability, byModel, byScreen,
    byUser: byUserRows.map((r) => ({ key: r.key, label: r.label, usd: r.usd, calls: r.calls, questions: 0, withoutModelPct: 0, unhelpfulPct: 0 })),
    policy: { version: loadPolicy().version, defaults: t.calls - t.escalated, escalated: t.escalated - t.manual < 0 ? 0 : t.escalated - t.manual, manual: t.manual, capped: t.capped },
    tokens: { input: t.input, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, output: t.output, cacheSharePct: pct(t.cacheRead, inputAll) },
    chat: {
      calls: chatCalls?.n ?? 0,
      costPerQuestionUsd: answers > 0 ? (chatCalls?.usd ?? 0) / answers : null,
      tokensPerTurn: (chatCalls?.n ?? 0) > 0 ? Math.round(chatCalls!.perTurn) : null,
      rollovers: rollovers?.n ?? 0, rolloverCostUsd: rollovers?.usd ?? 0, archived: archived?.n ?? 0,
    },
    chatByScreen: byScreenRows.map((r) => ({ screen: r.screen, questions: r.answers, withoutModel: r.system, withoutModelPct: pct(r.system, r.answers), unhelpful: r.unhelpful, unhelpfulPct: pct(r.unhelpful, r.answers) })),
    escalationByCapability: escalationRows.map((r) => ({ capability: r.capability, escalated: r.escalated, total: r.total, pct: pct(r.escalated, r.total) })),
  };
}

export type ClaudeCallView = {
  id: string; startedAt: string; finishedAt: string; durationMs: number | null;
  clientId: string; clientName: string; userId: string; userName: string;
  entityKind: string; entityId: string | null; workitemId: string | null; workitemTitle: string | null; screen: string | null;
  capability: string; trigger: string; label: string;
  conversationId: string | null; messageId: string | null; parentCallId: string | null;
  modelRequested: string | null; modelUsed: string | null; effort: string | null; policyVersion: number | null; policyRule: string | null; numTurns: number | null;
  inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number; costUsd: number; priceListVersion: number | null;
  outcome: string; errorText: string | null; unanswered: boolean; sourceRef: string | null;
  meta: Record<string, unknown>;
};

const toView = (r: typeof claudeCall.$inferSelect, extra: { clientName: string; userName: string; workitemTitle: string | null }): ClaudeCallView => ({
  id: r.id, startedAt: new Date(r.startedAt).toISOString(), finishedAt: new Date(r.finishedAt).toISOString(), durationMs: r.durationMs,
  clientId: r.clientId, clientName: extra.clientName, userId: r.userId, userName: extra.userName,
  entityKind: r.entityKind, entityId: r.entityId, workitemId: r.workitemId, workitemTitle: extra.workitemTitle, screen: r.screen,
  capability: r.capability, trigger: r.trigger, label: r.label,
  conversationId: r.conversationId, messageId: r.messageId, parentCallId: r.parentCallId,
  modelRequested: r.modelRequested, modelUsed: r.modelUsed, effort: r.effort, policyVersion: r.policyVersion, policyRule: r.policyRule, numTurns: r.numTurns,
  inputTokens: r.inputTokens, cacheReadTokens: r.cacheReadTokens, cacheWriteTokens: r.cacheWriteTokens, outputTokens: r.outputTokens, costUsd: usd(r.costUsd), priceListVersion: r.priceListVersion,
  outcome: r.outcome, errorText: r.errorText, unanswered: r.unanswered, sourceRef: r.sourceRef, meta: r.meta ?? {},
});

export async function claudeCalls(f: CenterFilter = {}): Promise<{ rows: ClaudeCallView[]; total: number; month: string }> {
  const p = period(f.month);
  const w = where(f, p);
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 500);
  const offset = Math.max(f.offset ?? 0, 0);
  const rows = await db.select({ call: claudeCall, clientName: client.name, userName: users.displayName, workitemTitle: sql<string | null>`(select title from workitem where id = ${claudeCall.workitemId})` })
    .from(claudeCall)
    .innerJoin(client, eq(client.id, claudeCall.clientId))
    .innerJoin(users, eq(users.id, claudeCall.userId))
    .where(w).orderBy(desc(claudeCall.startedAt)).limit(limit).offset(offset);
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(claudeCall).where(w);
  return { rows: rows.map((r) => toView(r.call, r)), total: count?.n ?? 0, month: p.month };
}

export async function claudeCallById(id: string): Promise<ClaudeCallView | null> {
  const [r] = await db.select({ call: claudeCall, clientName: client.name, userName: users.displayName, workitemTitle: sql<string | null>`(select title from workitem where id = ${claudeCall.workitemId})` })
    .from(claudeCall)
    .innerJoin(client, eq(client.id, claudeCall.clientId))
    .innerJoin(users, eq(users.id, claudeCall.userId))
    .where(eq(claudeCall.id, id)).limit(1);
  return r ? toView(r.call, r) : null;
}

/** The calls behind one entity (a requirement, a run, a conversation) — every screen's cost detail. */
export async function callsForEntity(clientId: string, entity: { workitemId?: string; entityKind?: string; entityId?: string; conversationId?: string }): Promise<ClaudeCallView[]> {
  const parts: SQL[] = [eq(claudeCall.clientId, clientId)];
  if (entity.workitemId) parts.push(eq(claudeCall.workitemId, entity.workitemId));
  if (entity.entityKind && entity.entityId) parts.push(and(eq(claudeCall.entityKind, entity.entityKind), eq(claudeCall.entityId, entity.entityId))!);
  if (entity.conversationId) parts.push(eq(claudeCall.conversationId, entity.conversationId));
  const rows = await db.select({ call: claudeCall, clientName: client.name, userName: users.displayName, workitemTitle: sql<string | null>`(select title from workitem where id = ${claudeCall.workitemId})` })
    .from(claudeCall)
    .innerJoin(client, eq(client.id, claudeCall.clientId))
    .innerJoin(users, eq(users.id, claudeCall.userId))
    .where(and(...parts)!).orderBy(desc(claudeCall.startedAt)).limit(500);
  return rows.map((r) => toView(r.call, r));
}
