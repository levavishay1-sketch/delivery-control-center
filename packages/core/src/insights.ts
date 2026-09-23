import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { appendEvent, db, usd, withTenant } from "@dcc/db";
import { claudeCall, claudeInsight, client, conversation, conversationMessage, users, workitem } from "@dcc/db/schema";
import { runClaudeRaw } from "./ai-assist.ts";
import { ChatError, ensureSystemFile, internalClientId } from "./chat/index.ts";
import { ESCALATED, TOPIC_SCREEN, period } from "./claude-center.ts";
import { glossaryFor, matchGlossary } from "./glossary/index.ts";
import { chatPolicy, estimateUsd, recommend } from "./routing.ts";
import { requirePrompt } from "./prompts.ts";

/**
 * Conclusions (claude-in-dcc §9.3–§9.4, §9.6, design §6): a question that
 * repeats on a screen is a gap in the product, not in Claude — the screen
 * did not say it well enough. The clustering (same normalised question on
 * the same screen) is SQL and costs nothing; the model is asked, on a
 * click, only to word a finding and a recommendation for the clusters above
 * the threshold, and that call is a named action with a ledger row (§9.8).
 * "Open an improvement task" creates a requirement on the internal client.
 * The other lists — unanswered, unhelpful, failed, escalated — are slices of
 * the ledger and the conversations, never separate counts (§9.2).
 */

export type InsightCluster = {
  /** The `claude_insight` row, once the cluster has been analysed. */
  id: string | null;
  clientId: string; clientName: string; screen: string; questionKey: string; sampleQuestion: string;
  count: number; firstAskedAt: string; lastAskedAt: string;
  aboveThreshold: boolean;
  finding: string | null; recommendation: string | null;
  /** new (never analysed) | open | task_opened | dismissed */
  status: "new" | "open" | "task_opened" | "dismissed";
  workitemId: string | null;
  analysedCount: number | null; analysedAt: string | null;
  /** The concept the question names, when it names one — the element whose "i" is
   *  the suspect (openspec/changes/info-hints). A question that keeps coming back
   *  about a term that already has an explanation says the explanation is wrong or
   *  unclear, which is a different fix from adding a fact to the screen. */
  concept: { key: string; title: string; explain: string } | null;
};
export type InsightCallRow = {
  id: string; startedAt: string; clientName: string; userName: string; screen: string | null; capability: string; label: string;
  modelUsed: string | null; policyRule: string | null; costUsd: number; outcome: string; errorText: string | null; conversationId: string | null; workitemId: string | null;
};
export type UnhelpfulRow = { id: string; createdAt: string; clientName: string; screen: string; question: string | null; answer: string; note: string | null; source: string | null; conversationId: string };
export type InsightsView = {
  month: string;
  threshold: number;
  estimate: { model: string; effort: string; usd: number | null };
  clusters: InsightCluster[];
  unanswered: InsightCallRow[];
  unhelpful: UnhelpfulRow[];
  failed: InsightCallRow[];
  escalated: InsightCallRow[];
};

/** The screen a conversation's topic belongs to — the control center's one mapping. */
const SCREEN = TOPIC_SCREEN;
/** The question with case, punctuation and spacing normalised — the same normalisation the chat's "asked again" check uses. */
const KEY = sql<string>`trim(regexp_replace(regexp_replace(lower(${conversationMessage.text}), '[?!.,"''״׳()]', ' ', 'g'), '\\s+', ' ', 'g'))`;

const SCREEN_HE: Record<string, string> = { requirement: "דרישה", task: "משימה", pull_request: "בקשת מיזוג", onboarding: "הטמעת מאגר", dashboard: "לוח בקרה", claude: "מרכז הבקרה של קלוד", budgets: "תקציבים" };

type Filter = { clientId?: string | undefined; month?: string | undefined };

/** The concept a repeated question names, if it names one. Derived on every read and
 *  never stored: the registry is the truth, and it changes with the code. */
const conceptOf = (screen: string, question: string): InsightCluster["concept"] => {
  const m = matchGlossary(screen, question);
  return m ? { key: m.entry.key, title: m.entry.title, explain: m.entry.explain } : null;
};

export async function clusterQuestions(f: Filter): Promise<InsightCluster[]> {
  const p = period(f.month);
  const threshold = chatPolicy().insightsMinRepeats;
  const rows = await db.select({
    clientId: conversation.clientId, clientName: client.name, screen: SCREEN, key: KEY,
    count: sql<number>`count(*)::int`,
    first: sql<string>`min(${conversationMessage.createdAt})`,
    last: sql<string>`max(${conversationMessage.createdAt})`,
    sample: sql<string>`min(${conversationMessage.text})`,
  }).from(conversationMessage)
    .innerJoin(conversation, eq(conversation.id, conversationMessage.conversationId))
    .innerJoin(client, eq(client.id, conversation.clientId))
    .where(and(
      eq(conversationMessage.role, "user"),
      sql`${conversationMessage.createdAt} >= ${p.from} and ${conversationMessage.createdAt} < ${p.to}`,
      ...(f.clientId ? [eq(conversation.clientId, f.clientId)] : []),
    ))
    .groupBy(conversation.clientId, client.name, SCREEN, KEY)
    .having(sql`count(*) >= 2`)
    .orderBy(desc(sql`count(*)`), desc(sql`max(${conversationMessage.createdAt})`))
    .limit(200);

  const known = await db.select({ i: claudeInsight, clientName: client.name }).from(claudeInsight)
    .innerJoin(client, eq(client.id, claudeInsight.clientId))
    .where(f.clientId ? eq(claudeInsight.clientId, f.clientId) : sql`true`);
  const keyOf = (c: string, s: string, k: string) => `${c}|${s}|${k}`;
  const byKey = new Map(known.map((k) => [keyOf(k.i.clientId, k.i.screen, k.i.questionKey), k]));
  const seen = new Set<string>();
  const out: InsightCluster[] = rows.map((r) => {
    const k = byKey.get(keyOf(r.clientId, r.screen, r.key));
    seen.add(keyOf(r.clientId, r.screen, r.key));
    return {
      id: k?.i.id ?? null, clientId: r.clientId, clientName: r.clientName, screen: r.screen, questionKey: r.key, sampleQuestion: r.sample,
      count: r.count, firstAskedAt: new Date(r.first).toISOString(), lastAskedAt: new Date(r.last).toISOString(), aboveThreshold: r.count >= threshold,
      finding: k?.i.finding ?? null, recommendation: k?.i.recommendation ?? null, status: (k?.i.status as InsightCluster["status"] | undefined) ?? "new",
      workitemId: k?.i.workitemId ?? null, analysedCount: k ? k.i.count : null, analysedAt: k ? new Date(k.i.updatedAt).toISOString() : null,
      concept: conceptOf(r.screen, r.sample),
    };
  });
  // A conclusion from an earlier month stays visible until it is dealt with.
  for (const k of known) {
    if (seen.has(keyOf(k.i.clientId, k.i.screen, k.i.questionKey)) || k.i.status === "dismissed") continue;
    out.push({
      id: k.i.id, clientId: k.i.clientId, clientName: k.clientName, screen: k.i.screen, questionKey: k.i.questionKey, sampleQuestion: k.i.sampleQuestion,
      count: k.i.count, firstAskedAt: new Date(k.i.firstAskedAt ?? k.i.createdAt).toISOString(), lastAskedAt: new Date(k.i.lastAskedAt ?? k.i.updatedAt).toISOString(), aboveThreshold: k.i.count >= threshold,
      finding: k.i.finding, recommendation: k.i.recommendation, status: k.i.status as InsightCluster["status"],
      workitemId: k.i.workitemId, analysedCount: k.i.count, analysedAt: new Date(k.i.updatedAt).toISOString(),
      concept: conceptOf(k.i.screen, k.i.sampleQuestion),
    });
  }
  return out;
}

async function callRows(where: SQL, limit = 50): Promise<InsightCallRow[]> {
  const rows = await db.select({ c: claudeCall, clientName: client.name, userName: users.displayName }).from(claudeCall)
    .innerJoin(client, eq(client.id, claudeCall.clientId))
    .innerJoin(users, eq(users.id, claudeCall.userId))
    .where(where).orderBy(desc(claudeCall.startedAt)).limit(limit);
  return rows.map(({ c, clientName, userName }) => ({
    id: c.id, startedAt: new Date(c.startedAt).toISOString(), clientName, userName, screen: c.screen, capability: c.capability, label: c.label,
    modelUsed: c.modelUsed, policyRule: c.policyRule, costUsd: usd(c.costUsd), outcome: c.outcome, errorText: c.errorText, conversationId: c.conversationId, workitemId: c.workitemId,
  }));
}

export async function insightsView(f: Filter = {}): Promise<InsightsView> {
  const p = period(f.month);
  const inPeriod = sql`${claudeCall.startedAt} >= ${p.from} and ${claudeCall.startedAt} < ${p.to}`;
  const cf = f.clientId ? [eq(claudeCall.clientId, f.clientId)] : [];
  const r = recommend("usage_insights");

  // The answer a person said did not help, with the question it answered.
  const questionBefore = sql<string | null>`(select u.text from conversation_message u where u.conversation_id = ${conversationMessage.conversationId} and u.role = 'user' and u.created_at <= ${conversationMessage.createdAt} order by u.created_at desc limit 1)`;
  const unhelpfulRows = await db.select({ m: conversationMessage, clientName: client.name, screen: SCREEN, question: questionBefore }).from(conversationMessage)
    .innerJoin(conversation, eq(conversation.id, conversationMessage.conversationId))
    .innerJoin(client, eq(client.id, conversation.clientId))
    .where(and(
      eq(conversationMessage.helpful, false),
      sql`${conversationMessage.createdAt} >= ${p.from} and ${conversationMessage.createdAt} < ${p.to}`,
      ...(f.clientId ? [eq(conversation.clientId, f.clientId)] : []),
    ))
    .orderBy(desc(conversationMessage.createdAt)).limit(50);

  const [clusters, unanswered, failed, escalated] = await Promise.all([
    clusterQuestions(f),
    callRows(and(inPeriod, eq(claudeCall.unanswered, true), ...cf)!),
    callRows(and(inPeriod, sql`${claudeCall.outcome} in ('error','timeout','refused')`, ...cf)!),
    callRows(and(inPeriod, ESCALATED, ...cf)!),
  ]);
  return {
    month: p.month,
    threshold: chatPolicy().insightsMinRepeats,
    estimate: { model: r.model, effort: r.effort, usd: estimateUsd(r.model, { input: 3_000, output: 1_200 }) },
    clusters,
    unanswered,
    unhelpful: unhelpfulRows.map(({ m, clientName, screen, question }) => ({
      id: m.id, createdAt: new Date(m.createdAt).toISOString(), clientName, screen, question, answer: m.text.slice(0, 240), note: m.helpfulNote, source: m.helpfulSource, conversationId: m.conversationId,
    })),
    failed,
    escalated,
  };
}

/* ── the named action: word the finding and the recommendation ────────── */

function parseJsonArray<T>(text: string): T[] {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (m?.[1] ?? text).trim();
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end < start) return [];
  try {
    const j = JSON.parse(body.slice(start, end + 1)) as unknown;
    return Array.isArray(j) ? (j as T[]) : [];
  } catch {
    return [];
  }
}

/** "ניתוח שאלות": one recorded `usage_insights` call for every cluster above the threshold that has no finding yet or grew since. */
export async function analyseInsights(input: Filter & { by: { userId: string } }): Promise<{ analysed: number; callId: string | null; costUsd: number | null; clusters: InsightCluster[] }> {
  const all = await clusterQuestions(input);
  const due = all.filter((c) => c.aboveThreshold && c.status !== "dismissed" && (c.analysedCount == null || c.analysedCount !== c.count || !c.finding)).slice(0, 20);
  if (!due.length) return { analysed: 0, callId: null, costUsd: null, clusters: all };

  const ledgerClient = input.clientId ?? (await internalClientId());
  const dir = path.join(os.homedir(), ".dcc-chat", "_insights");
  mkdirSync(dir, { recursive: true });
  const sys = ensureSystemFile(dir, "system.txt", (await requirePrompt("insights.clusters")).body);
  const items = due.map((c, i) => {
    const g = glossaryFor(c.screen);
    return { n: i + 1, screen: c.screen, screenIs: g?.about ?? "", screenShows: g?.entries.map((e) => e.title).join(", ") ?? "", question: c.sampleQuestion, timesAsked: c.count };
  });
  const res = await runClaudeRaw(dir, JSON.stringify(items, null, 1), {
    ledger: { clientId: ledgerClient, userId: input.by.userId, capability: "usage_insights", trigger: "insights", screen: "claude", label: `ניתוח שאלות · ${items.length} שאלות חוזרות` },
    maxTurns: 2, timeoutMs: 180_000, env: { MAX_THINKING_TOKENS: "0" }, lean: { systemPromptFile: sys },
  });
  const parsed = parseJsonArray<{ n: number; finding?: string; recommendation?: string }>(res.text);
  const now = new Date();
  let analysed = 0;
  for (const it of items) {
    const c = due[it.n - 1]!;
    const a = parsed.find((x) => Number(x.n) === it.n);
    const finding = typeof a?.finding === "string" ? a.finding.trim() : "";
    if (!finding) continue;
    const values = {
      count: c.count, firstAskedAt: new Date(c.firstAskedAt), lastAskedAt: new Date(c.lastAskedAt),
      finding, recommendation: (typeof a?.recommendation === "string" && a.recommendation.trim()) || null,
      analysedCallId: res.callId, updatedAt: now,
    };
    await withTenant(c.clientId, async (tx) => {
      if (c.id) await tx.update(claudeInsight).set(values).where(eq(claudeInsight.id, c.id));
      else await tx.insert(claudeInsight).values({ clientId: c.clientId, screen: c.screen, questionKey: c.questionKey, sampleQuestion: c.sampleQuestion, createdBy: input.by.userId, ...values });
    });
    analysed++;
  }
  return { analysed, callId: res.callId, costUsd: res.meta.costUsd ?? null, clusters: await clusterQuestions(input) };
}

/* ── what is done about a conclusion ──────────────────────────────────── */

async function insightRow(id: string) {
  const [row] = await db.select().from(claudeInsight).where(eq(claudeInsight.id, id)).limit(1);
  if (!row) throw new ChatError("המסקנה לא נמצאה");
  return row;
}

/** "פתח משימת שיפור": a requirement on the internal client, in the person's name, carrying the finding and the recommendation as its first note. */
export async function openImprovementTask(insightId: string, by: { userId: string }): Promise<{ workitemId: string; created: boolean }> {
  const row = await insightRow(insightId);
  if (row.workitemId) return { workitemId: row.workitemId, created: false };
  if (!row.finding) throw new ChatError("קודם מריצים ניתוח — משימה נפתחת מממצא, לא משאלה בלבד");
  const clientId = await internalClientId();
  const screenHe = SCREEN_HE[row.screen] ?? row.screen;
  const [wi] = await withTenant(clientId, (tx) =>
    tx.insert(workitem).values({
      clientId, ownerId: by.userId, title: `שיפור מסך ${screenHe}: "${row.sampleQuestion.slice(0, 70)}"`,
      type: "story", requirementType: "development", priority: "medium", risk: "low", executor: "human",
    }).returning(),
  );
  await appendEvent({
    clientId, workitemId: wi!.id, source: "manual", type: "note.added",
    actor: { kind: "user", userId: by.userId, identityType: "interactive" },
    payload: {
      body: [
        "משימת שיפור שנפתחה ממרכז הבקרה של קלוד (מסקנות): שאלה שחוזרת היא פער במסך, לא בקלוד.",
        `מסך: ${screenHe}`,
        `השאלה חזרה ${row.count} פעמים: "${row.sampleQuestion}"`,
        `ממצא: ${row.finding}`,
        row.recommendation ? `המלצה: ${row.recommendation}` : "",
      ].filter(Boolean).join("\n"),
    },
  });
  await withTenant(row.clientId, (tx) => tx.update(claudeInsight).set({ status: "task_opened", workitemId: wi!.id, updatedAt: new Date() }).where(eq(claudeInsight.id, row.id)));
  return { workitemId: wi!.id, created: true };
}

/** "לא רלוונטי": the cluster stays counted but is not analysed or listed again. */
export async function dismissInsight(insightId: string): Promise<{ status: "dismissed" }> {
  const row = await insightRow(insightId);
  await withTenant(row.clientId, (tx) => tx.update(claudeInsight).set({ status: "dismissed", updatedAt: new Date() }).where(eq(claudeInsight.id, row.id)));
  return { status: "dismissed" };
}
