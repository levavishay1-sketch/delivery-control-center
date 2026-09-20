import { mkdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, withTenant } from "@dcc/db";
import { claudeCall, conversation, conversationMessage, repositoryOnboardingRun } from "@dcc/db/schema";
import { existingCheckout, firstRepo, runClaudeRaw } from "../ai-assist.ts";
import { ACTIONS, ActionRefused, actionEntityFor, runAction, type ActionKey } from "../actions/index.ts";
import { recommend } from "../routing.ts";
import { ChatError, chatDir, ensureSystemFile, messageView, resolveTopic, type ChatMessage, type TopicKind } from "./index.ts";

/**
 * What happens after a card is shown (claude-in-dcc §5.2–5.4, §6.6): the
 * person's click runs the proposal through the action registry, or runs the
 * declared-cost question as a separate, costlier, recorded call. Nothing
 * here runs by itself.
 */

type ProposalPayload = {
  key: ActionKey; title: string; describe: string; params: Record<string, unknown>; consequential: boolean;
  estimate: { capability: string; model: string; effort: string; usd: number | null } | null;
  status: "proposed" | "running" | "done" | "cancelled" | "failed"; result?: unknown; error?: string; ranAt?: string; recorded?: string;
};
type DeclaredCostPayload = {
  reason: string; question: string; askedCallId: string | null;
  estimate: { model: string; effort: string; usdMin: number; usdMax: number };
  status: "proposed" | "running" | "done" | "cancelled" | "failed"; error?: string;
};

async function loadCard(messageId: string, userId: string, kind: "proposal" | "declared_cost") {
  const [m] = await db.select().from(conversationMessage).where(eq(conversationMessage.id, messageId)).limit(1);
  if (!m || m.kind !== kind) throw new ChatError("ההודעה לא נמצאה");
  const [c] = await db.select().from(conversation).where(eq(conversation.id, m.conversationId)).limit(1);
  if (!c) throw new ChatError("השיחה לא נמצאה");
  if (c.createdBy !== userId) throw new ChatError("רק מי שקיבל את ההצעה יכול לאשר אותה");
  return { m, c };
}

async function setPayload(m: typeof conversationMessage.$inferSelect, payload: Record<string, unknown>): Promise<ChatMessage> {
  await withTenant(m.clientId, (tx) => tx.update(conversationMessage).set({ payload }).where(eq(conversationMessage.id, m.id)));
  return messageView({ ...m, payload }, null);
}

export async function runProposal(messageId: string, userId: string): Promise<{ message: ChatMessage }> {
  const { m, c } = await loadCard(messageId, userId, "proposal");
  const p = m.payload as unknown as ProposalPayload;
  if (p.status !== "proposed") throw new ChatError(p.status === "done" ? "ההצעה כבר בוצעה" : p.status === "cancelled" ? "ההצעה בוטלה" : "ההצעה רצה");
  const topic = await resolveTopic({ kind: c.topicKind as TopicKind, id: c.topicId });
  const entity = await actionEntityFor(topic);
  if (!entity) throw new ChatError("לפעולה הזו אין על מה לרוץ");
  await setPayload(m, { ...p, status: "running" });
  try {
    const result = await runAction(p.key, p.params, entity, { userId }, "chat");
    return { message: await setPayload(m, { ...p, status: "done", result: result as Record<string, unknown>, ranAt: new Date().toISOString(), recorded: "ביומן הדרישה ובמרכז הבקרה, בשמכם" }) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const message = await setPayload(m, { ...p, status: e instanceof ActionRefused ? "proposed" : "failed", error });
    if (e instanceof ActionRefused) throw new ChatError(error);
    return { message };
  }
}

export async function cancelProposal(messageId: string, userId: string): Promise<{ message: ChatMessage }> {
  const { m } = await loadCard(messageId, userId, "proposal");
  const p = m.payload as unknown as ProposalPayload;
  if (p.status !== "proposed") throw new ChatError("ההצעה כבר לא ממתינה");
  return { message: await setPayload(m, { ...p, status: "cancelled" }) };
}

export async function proposalPreview(messageId: string, userId: string): Promise<{ prompt: string; promptHe: string }> {
  const { m, c } = await loadCard(messageId, userId, "proposal");
  const p = m.payload as unknown as ProposalPayload;
  const def = ACTIONS[p.key];
  if (!def?.preview) return { prompt: "(no prompt — this action does not call a model)", promptHe: "(אין פרומפט — הפעולה הזו לא קוראת למודל)" };
  const topic = await resolveTopic({ kind: c.topicKind as TopicKind, id: c.topicId });
  const entity = await actionEntityFor(topic);
  if (!entity) throw new ChatError("לפעולה הזו אין על מה לרוץ");
  return def.preview(p.params, entity);
}

/* ── the expensive question: read the code, after the person said yes ── */

const CODE_SYSTEM = `You answer one question about a software repository for a person who is not a developer and reads Hebrew. Answer in Hebrew, plainly, under 150 words, no markdown. You have read-only tools (Read, Grep, Glob) on the repository; read as little as possible — the person pays for every token — and say what you read. Put file paths, commands and code in backticks, never translated. If the repository does not contain the answer, say so.`;

export async function runCodeQuestion(messageId: string, userId: string): Promise<{ message: ChatMessage; answer: ChatMessage }> {
  const { m, c } = await loadCard(messageId, userId, "declared_cost");
  const p = m.payload as unknown as DeclaredCostPayload;
  if (p.status !== "proposed") throw new ChatError("השאלה כבר לא ממתינה");
  const topic = await resolveTopic({ kind: c.topicKind as TopicKind, id: c.topicId });

  // Where the code is: a requirement's first repository (its local copy), or an onboarding run's isolated copy.
  let dir: string | null = null;
  if (topic.kind === "wi" && topic.workitemId) {
    const r = await firstRepo(topic.clientId, topic.workitemId);
    dir = r ? existingCheckout(r) : null;
    if (!dir) throw new ChatError(r ? `אין עותק מקומי של ${r.name} — הריצו קודם בחינת בשלות, שמביאה אותו` : "לדרישה הזו אין מאגר מקושר — אין קוד לקרוא");
  } else if (topic.kind === "run" && topic.id) {
    const [run] = await db.select({ workspacePath: repositoryOnboardingRun.workspacePath }).from(repositoryOnboardingRun).where(eq(repositoryOnboardingRun.id, topic.id)).limit(1);
    dir = run?.workspacePath ?? null;
    if (!dir) throw new ChatError("להרצה הזו אין עותק מבודד עדיין");
  } else {
    throw new ChatError("קריאה בקוד אפשרית רק משיחה על דרישה או על הטמעת מאגר");
  }

  await setPayload(m, { ...p, status: "running" });
  const work = chatDir(c.id);
  mkdirSync(work, { recursive: true });
  const sys = ensureSystemFile(work, "code-system.txt", CODE_SYSTEM);
  try {
    const res = await runClaudeRaw(dir, `השאלה: ${p.question}\n\nמה שצריך לבדוק: ${p.reason}`, {
      ledger: {
        clientId: c.clientId, userId, capability: "chat_code_read", trigger: "chat", entity: { kind: "conversation", id: c.id },
        workitemId: topic.workitemId, screen: topic.screen, label: p.question.slice(0, 80), conversationId: c.id, messageId: m.id, parentCallId: p.askedCallId,
      },
      maxTurns: 10, timeoutMs: 240_000, env: { MAX_THINKING_TOKENS: "0" },
      lean: { systemPromptFile: sys, tools: "Read,Grep,Glob", addDirs: [dir] },
    });
    const [a] = await withTenant(c.clientId, (tx) =>
      tx.insert(conversationMessage).values({ conversationId: c.id, clientId: c.clientId, role: "assistant", kind: "answer", source: "model", text: res.text.trim() || "(אין תשובה)", callId: res.callId, payload: { from: "code" } }).returning(),
    );
    await withTenant(c.clientId, (tx) => tx.update(conversation).set({ lastMessageAt: new Date() }).where(eq(conversation.id, c.id)));
    const call = res.callId ? (await db.select().from(claudeCall).where(eq(claudeCall.id, res.callId)).limit(1))[0] ?? null : null;
    return { message: await setPayload(m, { ...p, status: "done" }), answer: messageView(a!, call) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const message = await setPayload(m, { ...p, status: "failed", error: error.slice(0, 300) });
    return { message, answer: messageView({ ...m, id: `${m.id}-failed`, role: "assistant", kind: "answer", source: "system", text: `הקריאה בקוד נכשלה: ${error.slice(0, 200)}`, payload: {} }, null) };
  }
}

export async function cancelCodeQuestion(messageId: string, userId: string): Promise<{ message: ChatMessage }> {
  const { m } = await loadCard(messageId, userId, "declared_cost");
  const p = m.payload as unknown as DeclaredCostPayload;
  if (p.status !== "proposed") throw new ChatError("השאלה כבר לא ממתינה");
  return { message: await setPayload(m, { ...p, status: "cancelled" }) };
}

/** The estimate a declared-cost card shows: the policy's model for reading code, and a range from what such calls typically read. */
export function codeReadEstimate() {
  const r = recommend("chat_code_read");
  return { model: r.model, effort: r.effort, usdMin: 0.05, usdMax: 0.4 };
}
