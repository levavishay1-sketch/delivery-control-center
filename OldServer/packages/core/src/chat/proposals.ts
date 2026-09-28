import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, withTenant } from "@dcc/db";
import { claudeCall, conversation, conversationMessage, repositoryOnboardingRun } from "@dcc/db/schema";
import { existingCheckout, firstRepo, git, runClaudeRaw } from "../ai-assist.ts";
import { changedFiles } from "../repo-onboarding/changes.ts";
import { writeChangesDiff } from "../repo-onboarding/change-diff.ts";
import { taskChangesForReading } from "../task-files.ts";
import { writePullRequestCode } from "../pull-request-detail.ts";
import { ACTIONS, ActionRefused, actionEntityFor, runAction, type ActionKey } from "../actions/index.ts";
import { recommend } from "../routing.ts";
import { requirePrompt } from "../prompts.ts";
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
  /** What will actually be read, in the person's words — it differs per topic. */
  reads?: string;
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

export async function runCodeQuestion(messageId: string, userId: string): Promise<{ message: ChatMessage; answer: ChatMessage }> {
  const { m, c } = await loadCard(messageId, userId, "declared_cost");
  const p = m.payload as unknown as DeclaredCostPayload;
  if (p.status !== "proposed") throw new ChatError("השאלה כבר לא ממתינה");
  const topic = await resolveTopic({ kind: c.topicKind as TopicKind, id: c.topicId });

  // Where the code is: a requirement's first repository (its local copy), an
  // onboarding run's isolated copy, or — for a request — the change itself,
  // fetched from the host into a folder of its own.
  let dir: string | null = null;
  let holds = "";
  // Which of the three code-reading prompts (Prompts screen) answers it.
  let systemKey = "chat.code_read.repo";
  const extraDirs: string[] = [];
  if ((topic.kind === "wi" || topic.kind === "task") && topic.workitemId) {
    const r = await firstRepo(topic.clientId, topic.workitemId);
    dir = r ? existingCheckout(r) : null;
    if (!dir) throw new ChatError(r ? `אין עותק מקומי של ${r.name} — הריצו קודם בחינת בשלות, שמביאה אותו` : "לדרישה הזו אין מאגר מקושר — אין קוד לקרוא");
    // A task: besides the repository, what the task itself changed — put on disk, because the reading tools have no git.
    if (topic.kind === "task" && topic.id) {
      const t = await taskChangesForReading(topic.clientId, topic.id).catch(() => null);
      if (t?.files.length) {
        const changeDir = path.join(chatDir(c.id), "change");
        mkdirSync(changeDir, { recursive: true });
        const diffFile = path.join(changeDir, "task-changes.diff");
        writeFileSync(diffFile, t.diff);
        extraDirs.push(changeDir);
        holds = [
          `המשימה שינתה ${t.files.length} קבצים בענף \`${t.branch}\`: ${t.files.map((f) => `${f.status} ${f.path} (+${f.additions} −${f.deletions})`).join("; ")}.`,
          `ה-diff שלהם ב-\`${diffFile}\`${t.cut ? " (קוצר — קראו את הקובץ עצמו)" : ""}.`,
        ].join("\n");
      }
    }
  } else if (topic.kind === "run" && topic.id) {
    const [run] = await db.select({ workspacePath: repositoryOnboardingRun.workspacePath, baselineSha: repositoryOnboardingRun.baselineSha }).from(repositoryOnboardingRun).where(eq(repositoryOnboardingRun.id, topic.id)).limit(1);
    dir = run?.workspacePath ?? null;
    if (!dir) throw new ChatError("להרצה הזו אין עותק מבודד עדיין");
    systemKey = "chat.code_read.onboarding_run";
    // The reading tools have no `git`, so the change is put on disk first: without
    // it the reader cannot tell which files the run touched, or what they were before.
    if (run?.baselineSha) {
      const changeDir = path.join(chatDir(c.id), "change");
      const files = await changedFiles(dir, run.baselineSha).catch(() => []);
      if (files.length) {
        const diffFile = path.join(changeDir, "changes.diff");
        const w = await writeChangesDiff(git, dir, run.baselineSha, files, diffFile).catch(() => null);
        if (w) {
          extraDirs.push(changeDir);
          holds = [
            `ההרצה שינתה ${files.length} קבצים מול נקודת ההתחלה: ${files.map((f) => `${f.status} ${f.path} (+${f.additions} −${f.deletions})`).join("; ")}.`,
            `ה-diff של כולם ב-\`${diffFile}\`${w.withoutBody.length ? ` (בלי הגוף של: ${w.withoutBody.join(", ")})` : ""}${w.cut.length ? ` (קוצר עבור: ${w.cut.join(", ")} — קראו את הקובץ עצמו)` : ""}.`,
          ].join("\n");
        }
      }
    }
  } else if (topic.kind === "pr" && topic.id) {
    const [prRepoId, num] = topic.id.split("/");
    if (!prRepoId || !num) throw new ChatError("חסר מזהה בקשת מיזוג");
    dir = path.join(chatDir(c.id), "change");
    systemKey = "chat.code_read.pull_request";
    // Fetched before the card says "running": when the host refuses, the card
    // stays as it was and the person is told why, instead of a failed reading.
    try { holds = await writePullRequestCode(prRepoId, Number(num), dir); }
    catch (e) { throw new ChatError(e instanceof Error ? e.message : String(e)); }
  } else {
    throw new ChatError("קריאה בקוד אפשרית רק משיחה על דרישה, על משימה, על בקשת מיזוג או על הטמעת מאגר");
  }

  await setPayload(m, { ...p, status: "running" });
  const work = chatDir(c.id);
  mkdirSync(work, { recursive: true });
  const sys = ensureSystemFile(work, "code-system.txt", (await requirePrompt(systemKey)).body);
  try {
    const res = await runClaudeRaw(dir, [`השאלה: ${p.question}`, `מה שצריך לבדוק: ${p.reason}`, holds].filter(Boolean).join("\n\n"), {
      ledger: {
        clientId: c.clientId, userId, capability: "chat_code_read", trigger: "chat", entity: { kind: "conversation", id: c.id },
        workitemId: topic.workitemId, screen: topic.screen, label: p.question.slice(0, 80), conversationId: c.id, messageId: m.id, parentCallId: p.askedCallId,
      },
      maxTurns: 10, timeoutMs: 240_000, env: { MAX_THINKING_TOKENS: "0" },
      lean: { systemPromptFile: sys, tools: "Read,Grep,Glob", addDirs: [dir, ...extraDirs] },
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

/** What a reading on this topic will open, said on the card before the person approves it. */
export function codeReads(topic: TopicKind): string {
  if (topic === "pr") return "קריאה בלבד: השינוי עצמו — ה-diff של הבקשה והקבצים ששונו כפי שהם אחריו, מהגיט־האוסט";
  if (topic === "task") return "קריאה בלבד, בעותק המקומי של המאגר, וה-diff של מה שהמשימה עצמה שינתה";
  if (topic === "run") return "קריאה בלבד, בעותק המבודד של ההרצה: השינויים שנעשו בו מול נקודת ההתחלה, והמאגר עצמו";
  return "קריאה בלבד, בעותק המקומי של המאגר";
}

/** The estimate a declared-cost card shows: the policy's model for reading code, and a range from what such calls typically read. */
export function codeReadEstimate() {
  const r = recommend("chat_code_read");
  return { model: r.model, effort: r.effort, usdMin: 0.05, usdMax: 0.4 };
}
