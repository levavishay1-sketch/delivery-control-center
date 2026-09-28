import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { recordClaudeCall, withTenant } from "@dcc/db";
import { repositoryOnboardingRun } from "@dcc/db/schema";
import { recommend } from "../routing.ts";
import { appendRepoAiEvent } from "./events.ts";
import { lastInputUser, markDisconnected, startClaudeSession, statusFile, stopClaudeSession, terminalLine, terminalState, writeTerminalInput } from "./session.ts";
import { promptSeenAfter, readStatusSnapshot, scanTranscript, sessionIdle, transcriptLineCount, type TranscriptFact } from "./transcript.ts";
import { normalizeAutomation, sessionTotals, type RunSession, type SessionTotals } from "./types.ts";

/**
 * The `/init` draft session — one window inside the plan step: the real,
 * interactive Claude Code in a terminal, run in the isolated copy as a
 * draft generator for AGENTS.md. What it writes stays a draft until the
 * build verifies its claims against the profile. The session's cost is
 * recorded in ledger slices; the person's answers and commands become
 * events. Everything here is the same channel the old design used, kept
 * because a PTY is the only way to run `/init`.
 */

export type DraftCtx = { repoId: string; runId: string; clientId: string; triggeredBy: string };
type RunRow = typeof repositoryOnboardingRun.$inferSelect;

export class DraftError extends Error {}

export const sessionOf = (run: Pick<RunRow, "session">): RunSession => ({ state: "none", ...((run.session ?? {}) as Partial<RunSession>) });
const ZERO: SessionTotals = { costUsd: 0, inputTokens: 0, outputTokens: 0, apiDurationMs: 0 };
export const sessionModelId = (s: RunSession) => s.status?.modelId ?? s.status?.model ?? s.model ?? null;
export const sessionEffort = (s: RunSession) => s.status?.effort ?? s.effort ?? null;

async function loadRow(ctx: DraftCtx): Promise<RunRow | null> {
  const [row] = await withTenant(ctx.clientId, (tx) => tx.select().from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.id, ctx.runId), eq(repositoryOnboardingRun.repoId, ctx.repoId))).limit(1));
  return row ?? null;
}

/** Session writes are read-modify-write on one JSON column, from both the monitor and the lifecycle; a per-run queue keeps them from overwriting each other. */
const queues = new Map<string, Promise<unknown>>();
export function patchSession(ctx: DraftCtx, patch: Partial<RunSession>): Promise<void> {
  const prev = queues.get(ctx.runId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const row = await loadRow(ctx);
    await withTenant(ctx.clientId, (tx) => tx.update(repositoryOnboardingRun).set({ session: { ...sessionOf({ session: row?.session ?? {} }), ...patch } }).where(eq(repositoryOnboardingRun.id, ctx.runId)));
  });
  queues.set(ctx.runId, next.catch(() => undefined));
  return next;
}

const event = (ctx: DraftCtx, type: string, payload: Record<string, unknown>, actor: string | null) =>
  appendRepoAiEvent({ clientId: ctx.clientId, repoId: ctx.repoId, type, payload: { runId: ctx.runId, ...payload }, actorUserId: actor });

/** The session's spend since the ledger cursor, written as ONE ledger row, and the cursor moved. The money is only in the ledger. */
export async function recordSessionSlice(ctx: DraftCtx, by?: string | null): Promise<void> {
  const row = await loadRow(ctx);
  if (!row) return;
  const s = sessionOf(row);
  const now = sessionTotals(s);
  const cur = s.ledgerCursor ?? ZERO;
  const delta = {
    costUsd: Math.max(0, now.costUsd - cur.costUsd),
    inputTokens: Math.max(0, Math.round(now.inputTokens - cur.inputTokens)),
    outputTokens: Math.max(0, Math.round(now.outputTokens - cur.outputTokens)),
    apiDurationMs: Math.max(0, Math.round(now.apiDurationMs - cur.apiDurationMs)),
  };
  if (delta.costUsd > 0 || delta.inputTokens > 0 || delta.outputTokens > 0) {
    await recordClaudeCall({
      clientId: ctx.clientId, userId: by ?? row.triggeredBy, entityKind: "onboarding_run", entityId: ctx.runId,
      capability: "onboarding_init", trigger: "session", screen: "onboarding", label: "טיוטת /init בסשן",
      startedAt: s.ledgerCursor?.at ? new Date(s.ledgerCursor.at) : s.startedAt ? new Date(s.startedAt) : new Date(),
      durationMs: delta.apiDurationMs, modelUsed: sessionModelId(s), effort: sessionEffort(s),
      inputTokens: delta.inputTokens, outputTokens: delta.outputTokens, costUsd: delta.costUsd, meta: { stepKey: "plan" },
    }).catch((e) => console.error("[ledger] a draft-session slice was NOT recorded:", e instanceof Error ? e.message : e));
  }
  await patchSession(ctx, { ledgerCursor: { ...now, stepKey: "plan", at: new Date().toISOString() } });
}

/* ── starting, resuming, stopping ─────────────────────────────────── */

export async function launchDraftSession(ctx: DraftCtx, run: RunRow, by: string, resume: boolean, choice?: { model?: string; effort?: string }) {
  if (!run.workspacePath) throw new DraftError("אין עותק מבודד — החיבור עוד לא רץ");
  if (terminalState(ctx.runId) === "live") throw new DraftError("הסשן כבר פעיל");
  if (resume) await recordSessionSlice(ctx, by);
  const prior = sessionOf(resume ? (await loadRow(ctx)) ?? run : run);
  if (resume && !prior.id) throw new DraftError("עדיין לא היה סשן טיוטה בהרצה הזו");
  const sessionId = resume && prior.id ? prior.id : randomUUID();
  const rec = recommend("onboarding_init");
  const model = choice?.model ?? rec.model;
  const effort = choice?.effort ?? rec.effort;
  rmSync(statusFile(ctx.runId), { force: true });
  // The cap is the run's (the automation rail); the CLI gets what is left of it as a backstop, the monitor enforces it between turns.
  const auto = normalizeAutomation(run.automation);
  const spentBefore = resume ? sessionTotals(prior).costUsd : 0;
  try {
    startClaudeSession({ runId: ctx.runId, cwd: run.workspacePath, sessionId, resume, model, effort, capUsd: Math.max(0.25, auto.draftCapUsd - spentBefore), onExit: (exitCode) => { void onExit(ctx, exitCode); } });
  } catch (e) {
    throw new DraftError(`לא ניתן להפעיל את Claude Code: ${(e as Error).message}`);
  }
  const base = resume ? sessionTotals(prior) : undefined;
  await patchSession(ctx, {
    id: sessionId, state: "live", startedAt: new Date().toISOString(), endedAt: undefined, exitCode: undefined, model, effort, status: undefined, base,
    ledgerCursor: { ...(base ?? ZERO), stepKey: "plan", at: new Date().toISOString() },
  });
  await event(ctx, resume ? "onboarding.session.resumed" : "onboarding.session.started", { sessionId, model, effort }, by);
  startMonitor(ctx);
}

async function onExit(ctx: DraftCtx, exitCode: number | null) {
  await pollSession(ctx);
  stopMonitor(ctx.runId);
  const by = lastInputUser(ctx.runId);
  await recordSessionSlice(ctx, by);
  await patchSession(ctx, { state: "ended", endedAt: new Date().toISOString(), exitCode });
  await event(ctx, "onboarding.session.ended", { exitCode }, by);
  // The run decides what happens next (set the draft aside, scan it, open the cards) — registered by runs.ts, so this module needs nothing of it.
  if (afterEnded) await afterEnded(ctx, by).catch((e) => console.error("[onboarding] after the draft session ended:", e instanceof Error ? e.message : e));
}

let afterEnded: ((ctx: DraftCtx, by: string | null) => Promise<void>) | null = null;
/** What runs once a draft session has ended and its spend is in the ledger. */
export function setAfterDraftEnded(f: (ctx: DraftCtx, by: string | null) => Promise<void>) { afterEnded = f; }

export async function stopDraftSession(ctx: DraftCtx, by: string | null) {
  await stopClaudeSession(ctx.runId, true);
  stopMonitor(ctx.runId);
  await recordSessionSlice(ctx, by);
}

/* ── the monitor: the status line and the transcript become facts ── */

const monitors = new Map<string, NodeJS.Timeout>();
const polling = new Set<string>();
function startMonitor(ctx: DraftCtx) {
  stopMonitor(ctx.runId);
  monitors.set(ctx.runId, setInterval(() => { void pollSession(ctx); }, 3000));
}
function stopMonitor(runId: string) {
  const t = monitors.get(runId);
  if (t) clearInterval(t);
  monitors.delete(runId);
}

const FACT_EVENT: Record<TranscriptFact["kind"], string> = { prompt: "onboarding.session.prompt", command: "onboarding.session.command", answer: "onboarding.session.answer" };

async function pollSession(ctx: DraftCtx) {
  if (polling.has(ctx.runId)) return;
  polling.add(ctx.runId);
  try {
    const row = await loadRow(ctx);
    if (!row) return;
    const s = sessionOf(row);
    const next: RunSession = { ...s };
    const snap = readStatusSnapshot(statusFile(ctx.runId));
    if (snap && (!s.id || !snap.sessionId || snap.sessionId === s.id)) {
      const { updatedAt: _a, ...a } = snap.status;
      const { updatedAt: _b, ...b } = s.status ?? ({} as NonNullable<RunSession["status"]>);
      if (JSON.stringify(a) !== JSON.stringify(b)) next.status = snap.status;
      if (snap.transcriptPath) next.transcriptPath = snap.transcriptPath;
    }
    const actor = lastInputUser(ctx.runId) ?? row.triggeredBy;
    if (next.transcriptPath) {
      const scan = scanTranscript(next.transcriptPath, s.transcriptCursor ?? 0, s.lastMessageId ?? null);
      for (const f of scan.facts) {
        const { kind, ...payload } = f;
        await event(ctx, FACT_EVENT[kind], { ...payload, stepKey: "plan" }, actor);
      }
      next.transcriptCursor = scan.cursor;
      next.apiCalls = (s.apiCalls ?? 0) + scan.apiCalls;
      next.lastMessageId = scan.lastMessageId;
    }
    const owned = { status: next.status, transcriptPath: next.transcriptPath, transcriptCursor: next.transcriptCursor, apiCalls: next.apiCalls, lastMessageId: next.lastMessageId };
    const before = { status: s.status, transcriptPath: s.transcriptPath, transcriptCursor: s.transcriptCursor, apiCalls: s.apiCalls, lastMessageId: s.lastMessageId };
    if (JSON.stringify(owned) !== JSON.stringify(before)) await patchSession(ctx, owned);
    // The run's cap on the session: money (the status line repaints between turns, so one turn may overshoot) or time.
    if (terminalState(ctx.runId) === "live" && !capping.has(ctx.runId)) {
      const auto = normalizeAutomation(row.automation);
      const totals = sessionTotals(next);
      const minutes = s.startedAt ? (Date.now() - new Date(s.startedAt).getTime()) / 60_000 : 0;
      const over = totals.costUsd >= auto.draftCapUsd ? `$${totals.costUsd.toFixed(2)} מתוך תקרה של $${auto.draftCapUsd}` : minutes >= auto.draftCapMinutes ? `${Math.round(minutes)} דקות מתוך תקרה של ${auto.draftCapMinutes}` : null;
      if (over) {
        capping.add(ctx.runId);
        terminalLine(ctx.runId, `\r\n[סשן הטיוטה הגיע לתקרה (${over}) — DCC סוגר אותו; מה שנכתב נשאר בעותק ויסרק]`);
        await event(ctx, "onboarding.session.capped", { costUsd: totals.costUsd, minutes: Math.round(minutes), capUsd: auto.draftCapUsd, capMinutes: auto.draftCapMinutes }, actor);
        try { await stopDraftSession(ctx, actor); } finally { capping.delete(ctx.runId); }
      }
    }
  } catch { /* a transient read error: the next tick tries again */ }
  finally {
    polling.delete(ctx.runId);
  }
}

/** Runs whose session is being closed at the cap right now — one close, not one per tick. */
const capping = new Set<string>();

/** Type an instruction into the live draft session, as the person who pressed send. Sent only while the session looks idle, unless forced. */
export async function sendToDraftSession(ctx: DraftCtx, run: RunRow, by: string, input: { text: string; messageId?: string; force?: boolean }) {
  const text = input.text.replace(/\r\n/g, "\n").trim();
  if (!text) throw new DraftError("אין מה לשלוח");
  if (text.length > 4000) throw new DraftError("ההוראה ארוכה מדי — עד 4,000 תווים");
  if (terminalState(ctx.runId) !== "live") throw new DraftError("סשן הטיוטה לא פעיל — פתחו אותו מכרטיס הטיוטה ואז שלחו");
  const file = sessionOf(run).transcriptPath ?? "";
  if (!input.force) {
    const idle = sessionIdle(file);
    if (!idle.idle) return { sent: false as const, busy: true as const, reason: idle.why };
  }
  const before = file ? transcriptLineCount(file) : 0;
  if (!writeTerminalInput(ctx.runId, `\x1b[200~${text}\x1b[201~`, by)) throw new DraftError("סשן הטיוטה לא פעיל");
  await new Promise((r) => setTimeout(r, 500));
  writeTerminalInput(ctx.runId, "\r", by);
  await event(ctx, "onboarding.session.instructed", { text: text.length > 500 ? `${text.slice(0, 499)}…` : text, forced: !!input.force, messageId: input.messageId ?? null }, by);
  let confirmed = false;
  for (let i = 0; i < 12 && file && !confirmed; i++) {
    await new Promise((r) => setTimeout(r, 500));
    confirmed = promptSeenAfter(file, before, text);
  }
  return { sent: true as const, confirmed };
}

/** After an API restart: a session that was live is marked disconnected; the same conversation reopens with `--resume`. */
export async function recoverDraftSession(ctx: DraftCtx, run: RunRow): Promise<boolean> {
  const was = sessionOf(run).state;
  if (was === "live") {
    // What the session spent up to the last poll is in the row; without this slice it was never in the ledger (the Trade run's $5.55).
    await recordSessionSlice(ctx, null);
    await patchSession(ctx, { state: "disconnected" });
    await event(ctx, "onboarding.session.disconnected", { reason: "api_restart" }, null);
    terminalLine(ctx.runId, "[השרת הופעל מחדש — סשן הטיוטה נותק. אפשר לחדש אותו מאותה נקודה]");
  }
  if (was === "live" || was === "disconnected") markDisconnected(ctx.runId);
  return was === "live";
}
