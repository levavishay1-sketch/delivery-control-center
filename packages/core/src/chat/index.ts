import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, usd, withTenant } from "@dcc/db";
import { claudeCall, client, conversation, conversationMessage, repo, repositoryOnboardingRun, task, users, workitem } from "@dcc/db/schema";
import { runClaudeRaw } from "../ai-assist.ts";
import { chatPolicy } from "../routing.ts";
import { asksAboutScreen, glossaryAnswer, glossaryFor, matchGlossary, type ScreenGlossary } from "../glossary/index.ts";
import { onboardingChatFacts } from "../repo-onboarding/runs.ts";
import { actionEntityFor, actionsFor, type ActionDef } from "../actions/index.ts";
import { placesFor, renderPlaces } from "../screens/index.ts";
import { codeReadEstimate } from "./proposals.ts";

/**
 * The one chat (claude-in-dcc §4–§7, design §2–§3).
 *
 * - The topic is the place the person is on, never a choice: one
 *   conversation per (client, topic, person).
 * - Step zero answers from the screen's glossary and facts with no model
 *   call at all; only what that cannot answer reaches the model, with the
 *   facts handed over and only what changed since the previous question.
 * - The transcript here is what the person sees. The model's context is a
 *   CLI session per conversation; a roll-over starts a new one and never
 *   touches what is shown.
 * - Every model call is a ledger row (`runClaudeRaw` records it).
 */

export type TopicKind = "wi" | "task" | "pr" | "run" | "app";
export type TopicRef = { kind: TopicKind; id?: string | null };
export type ScreenContext = {
  screen?: string | null;
  facts?: Record<string, unknown>;
  suggestions?: string[];
  /** Actions the screen allows this person — stage 3 hands them to the model. */
  actions?: string[];
  /** The place of the screen map the person is standing on, when it is one (`screens/index.ts`). */
  place?: string | null;
};

export type ResolvedTopic = { key: string; kind: TopicKind; id: string | null; title: string; clientId: string; workitemId: string | null; screen: string };

export type ChatMessage = {
  id: string; conversationId: string; role: string; kind: string; text: string; source: string;
  callId: string | null; payload: Record<string, unknown>; helpful: boolean | null; helpfulSource: string | null; createdAt: string;
  cost: { model: string | null; effort: string | null; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number } | null;
};

export type ConversationView = {
  id: string; clientId: string; clientName: string | null; topicKey: string; topicKind: string; topicId: string | null; topicTitle: string;
  status: string; continuedFrom: string | null; continuesAs: string | null; createdBy: string; createdByName: string | null;
  lastMessageAt: string; createdAt: string; retainUntil: string | null; messageCount: number; costUsd: number; calls: number; lastText: string | null;
};

/* ── the internal client, home of the "app" topic (§10.1) ─────────── */

let internal: string | null = null;
export async function internalClientId(): Promise<string> {
  if (internal) return internal;
  const [byName] = await db.select({ id: client.id }).from(client).where(eq(client.name, "DCC Internal")).limit(1);
  if (byName) return (internal = byName.id);
  try {
    const cfg = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../.dcc.json", import.meta.url)), "utf8")) as { clientId?: string };
    if (cfg.clientId) {
      const [c] = await db.select({ id: client.id }).from(client).where(eq(client.id, cfg.clientId)).limit(1);
      if (c) return (internal = c.id);
    }
  } catch { /* no .dcc.json, or not readable */ }
  const [any] = await db.select({ id: client.id }).from(client).orderBy(client.createdAt).limit(1);
  if (!any) throw new Error("אין לקוח במערכת — השיחה על המערכת צריכה לקוח פנימי");
  return (internal = any.id);
}

/* ── topics ────────────────────────────────────────────────────────── */

export async function resolveTopic(t: TopicRef, ctx: ScreenContext = {}): Promise<ResolvedTopic> {
  const id = t.id ?? null;
  switch (t.kind) {
    case "wi": {
      if (!id) throw new ChatError("חסר מזהה דרישה");
      const [w] = await db.select({ id: workitem.id, key: workitem.key, title: workitem.title, clientId: workitem.clientId }).from(workitem).where(eq(workitem.id, id)).limit(1);
      if (!w) throw new ChatError("הדרישה לא נמצאה");
      return { key: `wi:${w.id}`, kind: "wi", id: w.id, title: `${w.key ? `${w.key} · ` : ""}${w.title}`, clientId: w.clientId, workitemId: w.id, screen: ctx.screen ?? "requirement" };
    }
    case "task": {
      if (!id) throw new ChatError("חסר מזהה משימה");
      const [tk] = await db.select({ id: task.id, seq: task.seq, intent: task.intent, clientId: task.clientId, workitemId: task.workitemId }).from(task).where(eq(task.id, id)).limit(1);
      if (!tk) throw new ChatError("המשימה לא נמצאה");
      return { key: `task:${tk.id}`, kind: "task", id: tk.id, title: `משימה #${tk.seq}: ${tk.intent.slice(0, 60)}`, clientId: tk.clientId, workitemId: tk.workitemId, screen: ctx.screen ?? "task" };
    }
    case "pr": {
      const [repoId, num] = (id ?? "").split("/");
      if (!repoId || !num) throw new ChatError("חסר מזהה בקשת מיזוג");
      const [r] = await db.select({ id: repo.id, name: repo.name, clientId: repo.clientId }).from(repo).where(eq(repo.id, repoId)).limit(1);
      if (!r) throw new ChatError("המאגר לא נמצא");
      return { key: `pr:${r.id}/${num}`, kind: "pr", id: `${r.id}/${num}`, title: `בקשת מיזוג #${num} · ${r.name}`, clientId: r.clientId ?? (await internalClientId()), workitemId: null, screen: ctx.screen ?? "pull_request" };
    }
    case "run": {
      if (!id) throw new ChatError("חסר מזהה הרצה");
      const [run] = await db.select({ id: repositoryOnboardingRun.id, clientId: repositoryOnboardingRun.clientId, repoName: repo.name })
        .from(repositoryOnboardingRun).innerJoin(repo, eq(repo.id, repositoryOnboardingRun.repoId)).where(eq(repositoryOnboardingRun.id, id)).limit(1);
      if (!run) throw new ChatError("ההרצה לא נמצאה");
      return { key: `run:${run.id}`, kind: "run", id: run.id, title: `הטמעת ${run.repoName}`, clientId: run.clientId, workitemId: null, screen: ctx.screen ?? "onboarding" };
    }
    default:
      return { key: "app", kind: "app", id: null, title: "המערכת", clientId: await internalClientId(), workitemId: null, screen: ctx.screen ?? "dashboard" };
  }
}

export class ChatError extends Error {}

/* ── conversations ─────────────────────────────────────────────────── */

type ConvRow = typeof conversation.$inferSelect;
type MsgRow = typeof conversationMessage.$inferSelect;
/** Per-conversation bookkeeping kept in `cli_baseline`: what the CLI already reported (cumulative), the session's state, the rules it was started under, the cursor into a run's transcript. */
type Baseline = { costUsd?: number; lastInputTokens?: number; started?: boolean; systemHash?: string; transcriptCursor?: number };
const baselineOf = (c: ConvRow): Baseline => (c.cliBaseline ?? {}) as Baseline;

async function activeConversation(clientId: string, topicKey: string, userId: string): Promise<ConvRow | null> {
  const [row] = await withTenant(clientId, (tx) =>
    tx.select().from(conversation)
      .where(and(eq(conversation.clientId, clientId), eq(conversation.topicKey, topicKey), eq(conversation.createdBy, userId), eq(conversation.status, "active")))
      .orderBy(desc(conversation.createdAt)).limit(1),
  );
  return row ?? null;
}

async function createConversation(t: ResolvedTopic, userId: string, extra: Partial<typeof conversation.$inferInsert> = {}): Promise<ConvRow> {
  const keepUntil = await retainUntil(t.clientId, new Date());
  const [row] = await withTenant(t.clientId, (tx) =>
    tx.insert(conversation).values({
      clientId: t.clientId, topicKey: t.key, topicKind: t.kind, topicId: t.id, topicTitle: t.title, createdBy: userId,
      cliSessionId: randomUUID(), retainUntil: keepUntil, ...extra,
    }).returning(),
  );
  return row!;
}

/** How long a client keeps its conversations: its own period when one was set, else the policy's default (§9.10). */
export async function retentionDaysFor(clientId: string): Promise<number> {
  const [c] = await db.select({ days: client.chatRetentionDays }).from(client).where(eq(client.id, clientId)).limit(1);
  return c?.days ?? chatPolicy().retentionDays;
}
const retainUntil = async (clientId: string, from: Date) => new Date(from.getTime() + (await retentionDaysFor(clientId)) * 864e5);

async function patchConversation(c: ConvRow, patch: Partial<typeof conversation.$inferInsert>) {
  await withTenant(c.clientId, (tx) => tx.update(conversation).set(patch).where(eq(conversation.id, c.id)));
}

async function addMessage(c: ConvRow, m: Omit<typeof conversationMessage.$inferInsert, "conversationId" | "clientId">): Promise<MsgRow> {
  const [row] = await withTenant(c.clientId, (tx) =>
    tx.insert(conversationMessage).values({ ...m, conversationId: c.id, clientId: c.clientId }).returning(),
  );
  await patchConversation(c, { lastMessageAt: new Date(), retainUntil: await retainUntil(c.clientId, new Date()) });
  return row!;
}

async function messagesOf(c: Pick<ConvRow, "id" | "clientId">): Promise<ChatMessage[]> {
  const rows = await withTenant(c.clientId, (tx) =>
    tx.select({ m: conversationMessage, call: claudeCall })
      .from(conversationMessage).leftJoin(claudeCall, eq(claudeCall.id, conversationMessage.callId))
      .where(eq(conversationMessage.conversationId, c.id)).orderBy(conversationMessage.createdAt),
  );
  return rows.map(({ m, call }) => toMessage(m, call));
}

export const messageView = (m: MsgRow, call: typeof claudeCall.$inferSelect | null): ChatMessage => toMessage(m, call);
const toMessage = (m: MsgRow, call: typeof claudeCall.$inferSelect | null): ChatMessage => ({
  id: m.id, conversationId: m.conversationId, role: m.role, kind: m.kind, text: m.text, source: m.source, callId: m.callId,
  payload: m.payload ?? {}, helpful: m.helpful, helpfulSource: m.helpfulSource, createdAt: new Date(m.createdAt).toISOString(),
  cost: call ? { model: call.modelUsed ?? call.modelRequested, effort: call.effort, inputTokens: call.inputTokens, outputTokens: call.outputTokens, cacheReadTokens: call.cacheReadTokens, costUsd: usd(call.costUsd) } : null,
});

/* ── suggestions: from the screen, never from a model ──────────────── */

function suggestionsFor(screen: string | null, ctx: ScreenContext): string[] {
  const g = glossaryFor(screen);
  const out = ["מה המסך הזה מציג?", ...(ctx.suggestions ?? [])];
  for (const e of (g?.entries ?? []).filter((e) => e.kind === "button").slice(0, 2)) out.push(`מה "${e.title}" עושה?`);
  return [...new Set(out)].slice(0, 6);
}

/* ── open: what the dock shows before the first question ───────────── */

export async function openChat(t: TopicRef, userId: string, ctx: ScreenContext = {}) {
  const topic = await resolveTopic(t, ctx);
  const conv = await activeConversation(topic.clientId, topic.key, userId);
  return {
    topic,
    conversation: conv ? await viewOf(conv) : null,
    messages: conv ? await messagesOf(conv) : [],
    glossary: glossaryFor(topic.screen),
    suggestions: suggestionsFor(topic.screen, ctx),
  };
}

/* ── step zero: the screen answers, no model ───────────────────────── */

const FACT_TEMPLATES: { re: RegExp; keys: string[]; say: (v: unknown, key: string) => string }[] = [
  { re: /שלב הבא|מה עכשיו|איך ממשיכים|מה חסר|מה צריך לעשות/, keys: ["nextStep", "השלב הבא"], say: (v) => String(v) },
  { re: /כמה עלה|כמה עלתה|עלות|כמה הוצאנו|כמה שילמנו/, keys: ["aiCostUsd", "עלות"], say: (v) => (typeof v === "number" ? `עלות ה-AI עד עכשיו: $${v.toFixed(2)}.` : String(v)) },
  { re: /מי אחראי|מי הבעלים|מי מטפל|של מי/, keys: ["owner", "אחראי"], say: (v) => `האחראי: ${String(v)}.` },
  { re: /מה הסטטוס|באיזה שלב|מה המצב|איפה זה עומד|מה השלב/, keys: ["status", "phase", "סטטוס", "שלב"], say: (v) => `המצב: ${String(v)}.` },
  { re: /פערים פתוחים|כמה פערים|אילו פערים|איזה פערים/, keys: ["openGaps", "פערים פתוחים"], say: (v) => Array.isArray(v) ? (v.length ? `${v.length} פערים פתוחים:\n${v.map((x) => `- ${String(x)}`).join("\n")}` : "אין פערים פתוחים.") : String(v) },
  { re: /חוסם|חסום/, keys: ["blocker", "חוסם"], say: (v) => (v ? `חוסם פתוח: ${String(v)}` : "אין חוסם פתוח.") },
];

function stepZero(screen: string | null, facts: Record<string, unknown>, question: string): { text: string; payload: Record<string, unknown> } | null {
  const g = glossaryFor(screen);
  if (g && asksAboutScreen(question)) return { text: g.about, payload: { from: "glossary", key: "about" } };
  // A question about the state of THIS record ("what is the next step") is
  // answered by the screen's facts before a glossary term in it can catch it.
  for (const t of FACT_TEMPLATES) {
    if (!t.re.test(question)) continue;
    for (const k of t.keys) {
      const v = facts[k];
      if (v === undefined || v === null || v === "") continue;
      return { text: t.say(v, k), payload: { from: "facts", key: k } };
    }
  }
  const m = matchGlossary(screen, question);
  if (m && m.certainty === "certain") return { text: glossaryAnswer(m), payload: { from: "glossary", key: m.entry.key } };
  return null;
}

/* ── the model call ────────────────────────────────────────────────── */

const CHAT_DIR = path.join(os.homedir(), ".dcc-chat");
export const chatDir = (conversationId: string) => path.join(CHAT_DIR, conversationId);
/** The CLI session file, to delete with the conversation (retention). */
export function deleteChatSession(conversationId: string) {
  rmSync(chatDir(conversationId), { recursive: true, force: true });
}

export const UNANSWERED_MARK = "[אין לי את זה במסך]";

/** Write a prompt file only when its text differs from what is there — the CLI reads it on every call. */
export function ensureSystemFile(dir: string, name: string, text: string): string {
  const file = path.join(dir, name);
  let current: string | null = null;
  try { current = existsSync(file) ? readFileSync(file, "utf8") : null; } catch { current = null; }
  if (current !== text) writeFileSync(file, text, "utf8");
  return file;
}

const SYSTEM = `You are the one chat of DCC (Delivery Control Center), an internal system that manages AI-assisted software delivery around Azure DevOps and Claude Code. The person asking is not a developer and reads Hebrew. You answer in Hebrew.

Before each question you may receive "הקשר המסך": which screen the person is on, what it is for, its glossary (every button and term, with what happens when it is pressed), and the facts currently shown on it. When nothing new is given, the screen is unchanged since the previous question.

Rules:
- Answer FROM the facts and the glossary. Never invent a fact, a number, a name or a state. If the facts do not contain what is asked, start your answer with the exact marker ${UNANSWERED_MARK} and then say briefly what you can say and where the answer would be found.
- Short and plain, usually under 120 words. Plain text only: no headings, no bold or other markdown (short lines starting with "-" are fine). Explain consequences in everyday words ("if you press it, the tasks are proposed but not created").
- Put commands, file paths, code and keyboard keys in backticks, exactly as written, never translated.
- You never perform anything yourself, and you cannot read files, run code or browse.
- SCREENS. The context may list "מסכים שאפשר לעבור אליהם מכאן". When the answer is not in the facts but one of those screens holds it, do NOT use the marker and do NOT tell the person to press a tab themselves: add ONE block, exactly in this form and with a listed key only: <goto key="KEY">one short sentence: what you are going to look at there</goto>. DCC takes the person to that screen and asks them your question again with its facts, and you answer it from those facts. Write nothing else in an answer that carries the block. Never the screen you are already on, never a key that is not listed, and never more than one block.
- ACTIONS. The context may list "פעולות שאפשר להציע". If the person asks you to DO something that one of them does, answer in one or two sentences what will happen and add ONE block, exactly in this form, with only the listed parameters as JSON: <action key="KEY">{"param":"value"}</action>. The block becomes a card under your answer with an approve button; say that you are proposing it and that it runs only after their approval there. Never say or imply that you did it, and do not send them to a button on the screen instead. If no listed action does what is asked, say so and name the screen or button that does. Never invent an action.
- CODE. If the answer lies in the repository's code (what a piece of code does, why something fails, where a thing is handled), do NOT use the marker: answer what the facts allow and add ONE block: <needs_code>one sentence: what would have to be read and why</needs_code>. Reading code is a separate, costlier call the person approves under your answer. The marker is for what none of these would answer — not the screen, not another screen of DCC, and not the code.
- When a person's question is about a button or a term that the glossary covers, answer with the glossary's meaning and consequence.
- LETTER. When asked to draft a message or letter to the client / the requester (מכתב ללקוח), write the whole message from the open gaps in the facts: a short greeting, the open questions numbered in plain business Hebrew (no code, no jargon), a closing line. It may be longer than the usual limit. DCC never sends it — the person copies it; say that in one sentence after the message. If the facts list no open gaps, say there is nothing to ask yet.
- RECOMMENDATIONS. When asked what could be done better or more cheaply on this item (המלצות לייעול), answer from the facts only — the phase, the gaps, the tasks, the cost and the calls — as three to five short, specific points tied to those facts; never generic advice.`;

function renderActions(defs: ActionDef[]): string {
  if (!defs.length) return "";
  return ["פעולות שאפשר להציע מהמסך הזה (רק אלה):", ...defs.map((d) => `- ${d.key} — "${d.title}"${d.params.length ? ` · פרמטרים: ${d.params.map((p) => `${p.name}${p.required ? " (חובה)" : ""}: ${p.explain}`).join("; ")}` : " · בלי פרמטרים"}`)].join("\n");
}

/** The blocks a model answer may carry, and the text without them. */
function parseBlocks(raw: string): { text: string; action: { key: string; params: Record<string, unknown> } | null; needsCode: string | null; goto: { key: string; reason: string } | null } {
  let text = raw;
  let action: { key: string; params: Record<string, unknown> } | null = null;
  const a = raw.match(/<action\s+key="([^"]+)"\s*>([\s\S]*?)<\/action>/i);
  if (a) {
    let params: Record<string, unknown> = {};
    try { const j = JSON.parse(a[2]!.trim() || "{}"); if (j && typeof j === "object" && !Array.isArray(j)) params = j as Record<string, unknown>; } catch { /* not JSON: no params */ }
    action = { key: a[1]!.trim(), params };
    text = text.replace(a[0], "");
  }
  const n = raw.match(/<needs_code\s*\/?>([\s\S]*?)(?:<\/needs_code>|$)/i);
  const needsCode = n ? n[1]!.trim() || null : null;
  if (n) text = text.replace(n[0], "");
  const g = raw.match(/<goto\s+key="([^"]+)"\s*>([\s\S]*?)(?:<\/goto>|$)/i);
  const goto = g ? { key: g[1]!.trim(), reason: g[2]!.trim() } : null;
  if (g) text = text.replace(g[0], "");
  return { text: text.trim(), action, needsCode, goto };
}

function renderFacts(facts: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(facts)) {
    if (v === undefined || v === null || v === "") continue;
    const val = Array.isArray(v) ? (v.length ? v.map((x) => `\n  - ${typeof x === "string" ? x : JSON.stringify(x)}`).join("") : "(אין)") : typeof v === "object" ? JSON.stringify(v) : String(v);
    lines.push(`- ${k}: ${val}`);
  }
  return lines.join("\n");
}

function renderGlossary(g: ScreenGlossary | null): string {
  if (!g) return "";
  return [`המסך: ${g.about}`, "מילון המסך:", ...g.entries.map((e) => `- ${e.title}: ${e.explain}${e.press ? ` (בלחיצה: ${e.press})` : ""}`)].join("\n");
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex");
/** Which rules a conversation's model session was started under (kept in its baseline): when the rules change, the session must not continue — its history holds answers given under the old ones. */
const SYSTEM_HASH = hash(SYSTEM);

async function callModel(c: ConvRow, topic: ResolvedTopic, userId: string, prompt: { next: string; full: string }, question: string, opts: { expectedInput?: number; baselineUsd?: number }) {
  const dir = chatDir(c.id);
  mkdirSync(dir, { recursive: true });
  const sys = ensureSystemFile(dir, "system.txt", SYSTEM);
  const b = baselineOf(c);
  const run = (sessionId: string, resume: boolean, p: string) =>
    runClaudeRaw(dir, p, {
      ledger: {
        clientId: c.clientId, userId, capability: "chat", trigger: "chat", entity: { kind: "conversation", id: c.id }, workitemId: topic.workitemId,
        screen: topic.screen, label: question.slice(0, 80), conversationId: c.id,
        baseline: { costUsd: opts.baselineUsd ?? 0 }, expectedInputTokens: opts.expectedInput,
        unanswered: (t) => t.includes(UNANSWERED_MARK),
      },
      maxTurns: 3, timeoutMs: 120_000, env: { MAX_THINKING_TOKENS: "0" },
      lean: { systemPromptFile: sys, session: { id: sessionId, resume } },
    });
  try {
    return { res: await run(c.cliSessionId!, !!b.started, b.started ? prompt.next : prompt.full), fresh: false };
  } catch (e) {
    // The CLI's session file is gone (a cleanup, a different machine): start
    // a new session and tell it everything again. Anything else is a real failure.
    if (!b.started || !/no conversation|not found|session/i.test(String(e))) throw e;
    const sessionId = randomUUID();
    await patchConversation(c, { cliSessionId: sessionId, cliBaseline: { ...b, costUsd: 0, started: false } });
    return { res: await run(sessionId, false, prompt.full), fresh: true };
  }
}

/* ── roll-over (§6.5): a long or cold conversation continues in a new one ── */

async function rollOver(c: ConvRow, topic: ResolvedTopic, userId: string, why: string): Promise<ConvRow> {
  const b = baselineOf(c);
  let summary = "";
  if (b.started) {
    const dir = chatDir(c.id);
    const sys = ensureSystemFile(dir, "system.txt", SYSTEM);
    try {
      const { text } = await runClaudeRaw(dir, "סכם את השיחה הזו עבור ההמשך שלה, בעברית, עד 120 מילים: מה נשאל, מה נענה והוחלט, ומה עדיין פתוח. טקסט פשוט בלבד.", {
        ledger: {
          clientId: c.clientId, userId, capability: "conversation_summary", trigger: "rollover", entity: { kind: "conversation", id: c.id },
          workitemId: topic.workitemId, screen: topic.screen, label: `סיכום לגלגול · ${why}`, conversationId: c.id, baseline: { costUsd: b.costUsd ?? 0 },
        },
        maxTurns: 2, timeoutMs: 90_000, env: { MAX_THINKING_TOKENS: "0" },
        lean: { systemPromptFile: sys, session: { id: c.cliSessionId!, resume: true } },
      });
      summary = text.trim();
    } catch { summary = ""; }
  }
  const next = await createConversation(topic, userId, { continuedFrom: c.id });
  await patchConversation(c, { status: "rolled", continuesAs: next.id });
  await addMessage(next, {
    role: "system", kind: "system_note", source: "system",
    text: summary ? `השיחה הקודמת התגלגלה להמשך (${why}). סיכום:\n${summary}` : `השיחה הקודמת התגלגלה להמשך (${why}).`,
    payload: { from: "rollover", continuedFrom: c.id },
  });
  return (await activeConversation(topic.clientId, topic.key, userId))!;
}

function rolloverReason(c: ConvRow): string | null {
  const pol = chatPolicy();
  const b = baselineOf(c);
  if ((b.lastInputTokens ?? 0) >= pol.rolloverInputTokens) return `השיחה התארכה מעבר ל-${pol.rolloverInputTokens.toLocaleString("en-US")} טוקנים`;
  const cold = Date.now() - new Date(c.lastMessageAt).getTime();
  if (b.started && cold > pol.rolloverColdDays * 864e5) return `שקט של יותר מ-${pol.rolloverColdDays} ימים`;
  // The chat's rules were updated since this session began: what the model
  // said under the old rules would otherwise steer every later answer.
  if (b.started && b.systemHash !== SYSTEM_HASH) return "כללי הצ'אט התעדכנו";
  return null;
}

/* ── ask ───────────────────────────────────────────────────────────── */

const normQ = (s: string) => s.toLowerCase().replace(/[?!.,"'״׳()]/g, " ").replace(/\s+/g, " ").trim();
const busy = new Set<string>();

export async function askChat(input: { topic: TopicRef; userId: string; question: string; ctx: ScreenContext }) {
  const question = input.question.trim();
  if (!question) throw new ChatError("כתבו שאלה");
  const topic = await resolveTopic(input.topic, input.ctx);
  let conv = (await activeConversation(topic.clientId, topic.key, input.userId)) ?? (await createConversation(topic, input.userId));
  if (busy.has(conv.id)) throw new ChatError("קלוד עדיין עונה על השאלה הקודמת");
  busy.add(conv.id);
  try {
    const facts: Record<string, unknown> = { ...(input.ctx.facts ?? {}) };
    // A run's topic gets what the session did since the previous question — the
    // same digest the onboarding screen's own reading aid used to build.
    let transcriptCursor = baselineOf(conv).transcriptCursor;
    if (topic.kind === "run" && topic.id) {
      const f = await onboardingChatFacts(topic.id, transcriptCursor ?? 0);
      Object.assign(facts, f.facts);
      transcriptCursor = f.cursor;
    }

    const previous = await messagesOf(conv);
    // The chat took the person to another screen for this very question and is
    // now asked it again there. One question, one hop: it is not a re-ask, it
    // does not become a second question in the transcript, and from there the
    // answer comes from the facts — the places are withheld below, so a chat
    // that cannot answer even there says so instead of moving on again.
    const lastGoto = [...previous].reverse().find((m) => m.kind === "navigate");
    const justNavigated = !!lastGoto && normQ(String(lastGoto.payload.question ?? "")) === normQ(question) && Date.now() - new Date(lastGoto.createdAt).getTime() < 120_000;

    // "Did this help" without a click: the same question again within a minute.
    const lastUser = [...previous].reverse().find((m) => m.role === "user");
    const lastAnswer = [...previous].reverse().find((m) => m.role === "assistant" && m.kind === "answer");
    if (!justNavigated && lastUser && lastAnswer && normQ(lastUser.text) === normQ(question) && Date.now() - new Date(lastUser.createdAt).getTime() < 60_000 && lastAnswer.helpful == null) {
      await withTenant(conv.clientId, (tx) => tx.update(conversationMessage).set({ helpful: false, helpfulSource: "reasked" }).where(eq(conversationMessage.id, lastAnswer.id)));
    }

    const userMsg = justNavigated ? null : await addMessage(conv, { role: "user", kind: "answer", source: "system", text: question });
    const asked = userMsg ? [toMessage(userMsg, null)] : [];

    const zero = stepZero(topic.screen, facts, question);
    if (zero) {
      const a = await addMessage(conv, { role: "assistant", kind: "answer", source: "system", text: zero.text, payload: zero.payload });
      return { conversation: await viewOf(conv), messages: [...asked, toMessage(a, null)], rolledOver: false, suggestions: suggestionsFor(topic.screen, input.ctx) };
    }

    let rolledOver = false;
    const why = rolloverReason(conv);
    if (why) {
      conv = await rollOver(conv, topic, input.userId, why);
      rolledOver = true;
      // the question moves with the person into the continuation
      if (userMsg) await withTenant(conv.clientId, (tx) => tx.update(conversationMessage).set({ conversationId: conv.id }).where(eq(conversationMessage.id, userMsg.id)));
    }

    const b = baselineOf(conv);
    const g = glossaryFor(topic.screen);
    const defs = actionsFor(topic.kind, input.ctx.actions ?? null);
    const places = justNavigated ? [] : placesFor(topic, input.ctx.place ?? null);
    const contextText = [renderGlossary(g), renderPlaces(places), renderActions(defs), Object.keys(facts).length ? `העובדות על המסך עכשיו:\n${renderFacts(facts)}` : ""].filter(Boolean).join("\n\n");
    const contextHash = hash(contextText);
    // What a session that already holds the earlier turns needs now (`next`),
    // and everything a session starting from nothing needs (`full`).
    const opening = [`השיחה על: ${topic.title}.`];
    if (rolledOver) {
      const note = (await messagesOf(conv)).find((m) => m.kind === "system_note");
      if (note) opening.push(note.text);
    }
    const contextPart = contextText ? `הקשר המסך:\n${contextText}` : "";
    const ask = `השאלה: ${question}`;
    const full = [...opening, contextPart, ask].filter(Boolean).join("\n\n");
    const next = [contextHash !== conv.contextHash ? contextPart : "", ask].filter(Boolean).join("\n\n");

    const { res, fresh } = await callModel(conv, topic, input.userId, { next, full }, question, { expectedInput: b.lastInputTokens, baselineUsd: b.costUsd });
    const unanswered = res.text.includes(UNANSWERED_MARK);
    const parsed = parseBlocks(res.text.replace(UNANSWERED_MARK, ""));
    // A move is made only to a place that was offered a moment ago; a key the
    // model invented moves nobody, and is counted as a question left open.
    const going = parsed.goto ? places.find((p) => p.def.key === parsed.goto!.key) ?? null : null;
    const stray = !!parsed.goto && !going;
    const text = parsed.text || (parsed.action ? "הנה מה שאפשר לעשות:" : parsed.needsCode ? "על זה אין תשובה במסך — צריך לקרוא בקוד."
      : going ? "" : stray ? "אין לי את זה במסך הזה, ולא הצלחתי לעבור למסך שבו זה נמצא." : "(אין תשובה)");
    // On a move the card below says everything; an answer bubble would only repeat it.
    const a = text ? await addMessage(conv, { role: "assistant", kind: "answer", source: "model", text, callId: res.callId, payload: unanswered || stray ? { unanswered: true } : {} }) : null;

    // The cards: a proposal the person approves (validated against the
    // registry — exists, on this topic, allowed for this person — or it
    // becomes a sentence, never a button), and a declared cost for code.
    const cards: MsgRow[] = [];
    // The move itself: the screen the person is about to be taken to, why,
    // and the question that is asked again once they are there.
    if (going) {
      cards.push(await addMessage(conv, {
        role: "assistant", kind: "navigate", source: "model",
        text: parsed.goto!.reason || `עובר אל "${going.def.title}" כדי לענות.`,
        callId: a ? null : res.callId,
        payload: { key: going.def.key, title: going.def.title, route: going.route, screen: going.def.screen, question },
      }));
    }
    if (parsed.action) {
      const def = defs.find((d) => d.key === parsed.action!.key);
      // Only the parameters the action declares reach it — whatever else the model put in the block is dropped.
      if (def) parsed.action.params = Object.fromEntries(Object.entries(parsed.action.params).filter(([k]) => def.params.some((p) => p.name === k)));
      const entity = def ? await actionEntityFor(topic) : null;
      const allowed = def && entity ? await def.allowed({ userId: input.userId }, entity, parsed.action.params) : null;
      if (!def || !entity) {
        cards.push(await addMessage(conv, { role: "assistant", kind: "refusal", source: "system", text: `לא אפשרי מכאן: הפעולה "${parsed.action.key}" לא קיימת במסך הזה.`, payload: { key: parsed.action.key, reason: `הפעולה "${parsed.action.key}" אינה מהפעולות של המסך הזה. מה שאפשר מכאן: ${defs.map((d) => d.title).join(", ") || "כלום"}.` } }));
      } else if (allowed && !allowed.ok) {
        cards.push(await addMessage(conv, { role: "assistant", kind: "refusal", source: "system", text: `לא אפשרי מכאן: ${allowed.reason}`, payload: { key: def.key, reason: allowed.reason } }));
      } else {
        const estimate = await def.estimate(parsed.action.params, entity);
        cards.push(await addMessage(conv, {
          role: "assistant", kind: "proposal", source: "model", text: def.title,
          payload: { key: def.key, title: def.title, describe: def.describe(parsed.action.params, entity), params: parsed.action.params, consequential: def.consequential, estimate, status: "proposed" },
        }));
      }
    }
    if (parsed.needsCode) {
      cards.push(await addMessage(conv, {
        role: "assistant", kind: "declared_cost", source: "model", text: parsed.needsCode,
        payload: { reason: parsed.needsCode, question, askedCallId: res.callId, estimate: codeReadEstimate(), status: "proposed" },
      }));
    }
    // The conversation's size is everything the model read this turn: on a
    // resumed session the CLI reports only the fresh tokens as `input`, and
    // the history comes back through the cache buckets.
    const contextSize = res.meta.inputTokens == null ? b.lastInputTokens : (res.meta.inputTokens ?? 0) + (res.meta.cacheReadTokens ?? 0) + (res.meta.cacheWriteTokens ?? 0);
    await patchConversation(conv, {
      contextHash,
      cliBaseline: { ...(fresh ? {} : b), costUsd: res.meta.costUsd ?? (fresh ? 0 : b.costUsd), lastInputTokens: contextSize, started: true, systemHash: SYSTEM_HASH, transcriptCursor },
    });
    const call = res.callId ? (await db.select().from(claudeCall).where(eq(claudeCall.id, res.callId)).limit(1))[0] ?? null : null;
    return {
      conversation: await viewOf(conv),
      messages: [...asked, ...(a ? [toMessage(a, call)] : []), ...cards.map((m) => toMessage(m, m.callId ? call : null))],
      rolledOver, suggestions: suggestionsFor(topic.screen, input.ctx),
    };
  } finally {
    busy.delete(conv.id);
  }
}

/* ── "did this help" (§9.7) ────────────────────────────────────────── */

export async function markHelpful(messageId: string, userId: string, helpful: boolean, note?: string) {
  const [m] = await db.select({ id: conversationMessage.id, clientId: conversationMessage.clientId, conversationId: conversationMessage.conversationId }).from(conversationMessage).where(eq(conversationMessage.id, messageId)).limit(1);
  if (!m) throw new ChatError("ההודעה לא נמצאה");
  const [c] = await db.select({ createdBy: conversation.createdBy }).from(conversation).where(eq(conversation.id, m.conversationId)).limit(1);
  if (!c || c.createdBy !== userId) throw new ChatError("רק מי ששאל יכול לסמן");
  await withTenant(m.clientId, (tx) => tx.update(conversationMessage).set({ helpful, helpfulSource: "person", helpfulNote: note ?? null }).where(eq(conversationMessage.id, messageId)));
  return { helpful };
}

/* ── reads for the control center ─────────────────────────────────── */

async function viewOf(c: ConvRow): Promise<ConversationView> {
  const [v] = await listConversations({ id: c.id, limit: 1 });
  return v!;
}

export async function listConversations(f: { id?: string; clientId?: string; userId?: string; topicKey?: string; limit?: number } = {}): Promise<ConversationView[]> {
  const conds = [];
  if (f.id) conds.push(eq(conversation.id, f.id));
  if (f.clientId) conds.push(eq(conversation.clientId, f.clientId));
  if (f.userId) conds.push(eq(conversation.createdBy, f.userId));
  if (f.topicKey) conds.push(eq(conversation.topicKey, f.topicKey));
  const rows = await db
    .select({
      c: conversation, clientName: client.name, createdByName: users.displayName,
      messageCount: sql<number>`(select count(*) from conversation_message m where m.conversation_id = ${conversation.id})::int`,
      lastText: sql<string | null>`(select m.text from conversation_message m where m.conversation_id = ${conversation.id} and m.role <> 'system' order by m.created_at desc limit 1)`,
      costUsd: sql<number>`coalesce((select sum(cc.cost_usd) from claude_call cc where cc.conversation_id = ${conversation.id}),0)::float`,
      calls: sql<number>`(select count(*) from claude_call cc where cc.conversation_id = ${conversation.id})::int`,
    })
    .from(conversation)
    .innerJoin(client, eq(client.id, conversation.clientId))
    .innerJoin(users, eq(users.id, conversation.createdBy))
    .where(conds.length ? and(...conds) : sql`true`)
    .orderBy(desc(conversation.lastMessageAt))
    .limit(Math.min(f.limit ?? 100, 500));
  return rows.map((r) => ({
    id: r.c.id, clientId: r.c.clientId, clientName: r.clientName, topicKey: r.c.topicKey, topicKind: r.c.topicKind, topicId: r.c.topicId, topicTitle: r.c.topicTitle,
    status: r.c.status, continuedFrom: r.c.continuedFrom, continuesAs: r.c.continuesAs, createdBy: r.c.createdBy, createdByName: r.createdByName,
    lastMessageAt: new Date(r.c.lastMessageAt).toISOString(), createdAt: new Date(r.c.createdAt).toISOString(), retainUntil: r.c.retainUntil ? new Date(r.c.retainUntil).toISOString() : null,
    messageCount: r.messageCount, costUsd: r.costUsd, calls: r.calls, lastText: r.lastText ? r.lastText.slice(0, 120) : null,
  }));
}

export async function getConversation(id: string): Promise<{ conversation: ConversationView; messages: ChatMessage[]; topic: TopicRef; suggestions: string[]; glossary: ScreenGlossary | null } | null> {
  const [v] = await listConversations({ id, limit: 1 });
  if (!v) return null;
  const screen = ({ wi: "requirement", task: "task", pr: "pull_request", run: "onboarding", app: "dashboard" } as Record<string, string>)[v.topicKind] ?? "dashboard";
  return { conversation: v, messages: await messagesOf({ id: v.id, clientId: v.clientId }), topic: { kind: v.topicKind as TopicKind, id: v.topicId }, suggestions: suggestionsFor(screen, {}), glossary: glossaryFor(screen) };
}
