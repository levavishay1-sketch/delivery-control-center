import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, recordClaudeCall, withTenant } from "@dcc/db";
import { repo, repoAiEvent, repositoryOnboardingRun, repositoryOnboardingStage } from "@dcc/db/schema";
import { callsForEntity } from "../claude-center.ts";
import { codeMapForWorkspace, type CodeMap } from "../code-map.ts";
import { recommend } from "../routing.ts";
import { changeSummary, changedFiles, fileVersions } from "./changes.ts";
import { deliverWorkspace } from "./deliver.ts";
import { appendRepoAiEvent } from "./events.ts";
import { lastInputUser, markDisconnected, startClaudeSession, statusFile, stopClaudeSession, terminalLine, terminalState, writeTerminalInput } from "./session.ts";
import { digestTranscript, promptSeenAfter, readStatusSnapshot, scanTranscript, sessionIdle, transcriptLineCount, turnEnded, type TranscriptFact } from "./transcript.ts";
import {
  LIVE_RUN_STATUSES, STAGES, isStageKey, normalizeModelPolicy, normalizePolicy, policyNeedsConsent, presetPolicy, stageDefinition,
  type AutomationPolicy, type ChangedFile, type DeliverResult, type InitResult, type ModelPolicy, type PrepareResult, type ReviewResult, type RunSession,
  type RunStatus, type StageKey, type StageStatus, type StageUsage, type SessionTotals, sessionTotals,
} from "./types.ts";
import { ensureOnboardingWorkspace, existingSetup, trackedFileCount } from "./workspace.ts";

/**
 * The onboarding run: four stages around one live Claude Code session
 * (`openspec/changes/repository-onboarding-native-init`). Every transition
 * is persisted and written to `repo_ai_event`; a stage is started by a
 * person ("▶ הרץ שלב") or by the run's automation policy.
 */

/** A message meant for the person — the API returns it as-is (409). */
export class OnboardingError extends Error {}

type Actor = { userId: string };
type RunRow = typeof repositoryOnboardingRun.$inferSelect;
type StageRow = typeof repositoryOnboardingStage.$inferSelect;
type Ctx = { repoId: string; runId: string; clientId: string; repoName: string };

const RUN_OVER: readonly RunStatus[] = ["Completed", "Cancelled"];
const busy = new Set<string>();

async function loadRepo(repoId: string) {
  const [r] = await db.select().from(repo).where(eq(repo.id, repoId)).limit(1);
  if (!r) throw new OnboardingError("הריפו לא נמצא");
  if (!r.clientId) throw new OnboardingError("הטמעה אפשרית רק לריפו ששייך ללקוח");
  return { ...r, clientId: r.clientId };
}

async function loadRun(repoId: string, runId: string) {
  const r = await loadRepo(repoId);
  const [run] = await withTenant(r.clientId, (tx) => tx.select().from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.id, runId), eq(repositoryOnboardingRun.repoId, repoId))).limit(1));
  if (!run) throw new OnboardingError("ההרצה לא נמצאה");
  const stages = await withTenant(r.clientId, (tx) => tx.select().from(repositoryOnboardingStage).where(eq(repositoryOnboardingStage.runId, runId)).orderBy(asc(repositoryOnboardingStage.stageOrder)));
  const ctx: Ctx = { repoId, runId, clientId: r.clientId, repoName: r.name };
  return { repo: r, run, stages, ctx };
}

const sessionOf = (run: Pick<RunRow, "session">): RunSession => ({ state: "none", ...((run.session ?? {}) as Partial<RunSession>) });
const ZERO: SessionTotals = { costUsd: 0, inputTokens: 0, outputTokens: 0, apiDurationMs: 0 };
const sessionModelId = (s: RunSession) => s.status?.modelId ?? s.status?.model ?? s.model ?? null;
const sessionEffort = (s: RunSession) => s.status?.effort ?? s.effort ?? null;

/** The session's spend since the ledger cursor, written as ONE ledger row
 *  (claude-in-dcc design §1: a live session is recorded in slices — one per
 *  stage, one per process), and the cursor moved. The cursor is bookkeeping
 *  in the run's session JSON; the money is only in the ledger. */
async function recordSessionSlice(ctx: Ctx, stageKey: StageKey | null, by?: string | null): Promise<void> {
  const { run } = await loadRun(ctx.repoId, ctx.runId);
  const s = sessionOf(run);
  const now = sessionTotals(s);
  const cur = s.ledgerCursor ?? ZERO;
  const stage = stageKey ?? (s.ledgerCursor?.stageKey as StageKey | undefined) ?? (run.currentStageKey as StageKey | null) ?? null;
  const delta = {
    costUsd: Math.max(0, now.costUsd - cur.costUsd),
    inputTokens: Math.max(0, Math.round(now.inputTokens - cur.inputTokens)),
    outputTokens: Math.max(0, Math.round(now.outputTokens - cur.outputTokens)),
    apiDurationMs: Math.max(0, Math.round(now.apiDurationMs - cur.apiDurationMs)),
  };
  if (delta.costUsd > 0 || delta.inputTokens > 0 || delta.outputTokens > 0) {
    await recordClaudeCall({
      clientId: ctx.clientId, userId: by ?? run.triggeredBy, entityKind: "onboarding_run", entityId: ctx.runId,
      capability: "onboarding_init", trigger: "session", screen: "onboarding",
      label: stage ? `סשן ההטמעה · ${stageDefinition(stage)?.title_he ?? stage}` : "סשן ההטמעה",
      startedAt: s.ledgerCursor?.at ? new Date(s.ledgerCursor.at) : s.startedAt ? new Date(s.startedAt) : new Date(),
      durationMs: delta.apiDurationMs, modelUsed: sessionModelId(s), effort: sessionEffort(s),
      inputTokens: delta.inputTokens, outputTokens: delta.outputTokens, costUsd: delta.costUsd, meta: { stageKey: stage },
    }).catch((e) => console.error("[ledger] an onboarding slice was NOT recorded:", e instanceof Error ? e.message : e));
  }
  await patchSession(ctx, { ledgerCursor: { ...now, stageKey: stage, at: new Date().toISOString() } });
}

async function event(ctx: Ctx, type: string, payload: Record<string, unknown>, actor: string | null) {
  await appendRepoAiEvent({ clientId: ctx.clientId, repoId: ctx.repoId, type, payload: { runId: ctx.runId, ...payload }, actorUserId: actor });
}

async function patchRun(ctx: Ctx, patch: Partial<typeof repositoryOnboardingRun.$inferInsert>) {
  await withTenant(ctx.clientId, (tx) => tx.update(repositoryOnboardingRun).set(patch).where(eq(repositoryOnboardingRun.id, ctx.runId)));
}

async function patchStage(ctx: Ctx, key: StageKey, patch: Partial<typeof repositoryOnboardingStage.$inferInsert>) {
  await withTenant(ctx.clientId, (tx) =>
    tx.update(repositoryOnboardingStage).set({ ...patch, updatedAt: new Date() }).where(and(eq(repositoryOnboardingStage.runId, ctx.runId), eq(repositoryOnboardingStage.stageKey, key))),
  );
}

/** Session writes are read-modify-write on one JSON column, from both the
 *  monitor and the lifecycle; a per-run queue keeps them from overwriting
 *  each other (a late monitor write must not turn "ended" back into "live"). */
const sessionQueues = new Map<string, Promise<unknown>>();
function patchSession(ctx: Ctx, patch: Partial<RunSession>): Promise<void> {
  const prev = sessionQueues.get(ctx.runId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const [row] = await withTenant(ctx.clientId, (tx) => tx.select({ session: repositoryOnboardingRun.session }).from(repositoryOnboardingRun).where(eq(repositoryOnboardingRun.id, ctx.runId)).limit(1));
    await patchRun(ctx, { session: { ...sessionOf({ session: row?.session ?? {} }), ...patch } });
  });
  sessionQueues.set(ctx.runId, next.catch(() => undefined));
  return next;
}

/** A stage can run when it has not completed and every stage before it has. */
function runnable(stages: StageRow[], key: StageKey): boolean {
  const s = stages.find((x) => x.stageKey === key);
  if (!s || !(["Pending", "Failed"] as StageStatus[]).includes(s.status as StageStatus)) return false;
  return stages.filter((x) => x.stageOrder < s.stageOrder).every((x) => x.status === "Completed");
}

async function startStage(ctx: Ctx, key: StageKey, actor: string, automated: boolean, usage?: StageUsage) {
  await patchStage(ctx, key, { status: "Running", startedAt: new Date(), completedAt: null, errors: [], ...(usage ? { usage } : {}) });
  await patchRun(ctx, { status: "Running", currentStageKey: key });
  await event(ctx, "onboarding.stage.started", { stageKey: key, automated }, actor);
}

async function completeStage(ctx: Ctx, key: StageKey, result: unknown, actor: string | null, usage?: StageUsage) {
  await patchStage(ctx, key, { status: "Completed", completedAt: new Date(), result: result as object, ...(usage ? { usage } : {}) });
  const stages = await withTenant(ctx.clientId, (tx) => tx.select().from(repositoryOnboardingStage).where(eq(repositoryOnboardingStage.runId, ctx.runId)).orderBy(asc(repositoryOnboardingStage.stageOrder)));
  const next = stages.find((s) => s.status !== "Completed");
  await patchRun(ctx, next ? { status: "Running", currentStageKey: next.stageKey } : { status: "Completed", currentStageKey: null, completedAt: new Date() });
  await event(ctx, "onboarding.stage.completed", { stageKey: key }, actor);
  if (!next) await event(ctx, "onboarding.run.completed", {}, actor);
}

async function failStage(ctx: Ctx, key: StageKey, error: unknown, actor: string | null) {
  const message = error instanceof Error ? error.message : String(error);
  await patchStage(ctx, key, { status: "Failed", completedAt: new Date(), errors: [message] });
  await patchRun(ctx, { status: "Failed", currentStageKey: key });
  await event(ctx, "onboarding.stage.failed", { stageKey: key, error: message.slice(0, 500) }, actor);
  terminalLine(ctx.runId, `✗ ${stageDefinition(key)?.title_he ?? key}: ${message}`);
}

/* ── starting a run ───────────────────────────────────────────────── */

export async function startOnboardingRun(repoId: string, by: Actor, opts: { automation?: unknown; modelChoices?: unknown; consent?: boolean } = {}) {
  const r = await loadRepo(repoId);
  const live = await withTenant(r.clientId, (tx) =>
    tx.select({ id: repositoryOnboardingRun.id }).from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.repoId, repoId), inArray(repositoryOnboardingRun.status, [...LIVE_RUN_STATUSES]))).limit(1),
  );
  if (live.length) throw new OnboardingError("כבר יש הרצה פעילה לריפו הזה — סיימו או בטלו אותה קודם");
  const automation = opts.automation ? normalizePolicy(opts.automation) : presetPolicy("step_by_step");
  if (policyNeedsConsent(automation) && !opts.consent) throw new OnboardingError("מדיניות שמאשרת שער בלי אדם דורשת הסכמה מפורשת");
  const runId = randomUUID();
  await withTenant(r.clientId, async (tx) => {
    await tx.insert(repositoryOnboardingRun).values({
      id: runId, repoId, clientId: r.clientId, status: "Pending", currentStageKey: STAGES[0]!.key,
      automation, modelChoices: normalizeModelPolicy(opts.modelChoices), session: { state: "none" }, triggeredBy: by.userId,
    });
    await tx.insert(repositoryOnboardingStage).values(STAGES.map((s) => ({ runId, clientId: r.clientId, stageKey: s.key, stageOrder: s.order })));
  });
  const ctx: Ctx = { repoId, runId, clientId: r.clientId, repoName: r.name };
  await event(ctx, "onboarding.run.started", { preset: automation.preset }, by.userId);
  terminalLine(runId, `DCC · הטמעת AI · ${r.name} · הרצה ${runId.slice(0, 8)}`);
  await drive(repoId, runId);
  return { runId };
}

/* ── running a stage ──────────────────────────────────────────────── */

export async function runOnboardingStage(repoId: string, runId: string, key: string, by: Actor, opts: { automated?: boolean } = {}) {
  if (!isStageKey(key)) throw new OnboardingError("שלב לא מוכר");
  if (busy.has(runId)) throw new OnboardingError("פעולה אחרת בהרצה הזו עדיין מתבצעת");
  busy.add(runId);
  try {
    const { repo: r, run, stages, ctx } = await loadRun(repoId, runId);
    if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה הסתיימה");
    if (!runnable(stages, key)) throw new OnboardingError("השלב הזה עוד לא זמין — השלבים שלפניו צריכים להסתיים קודם");
    const automated = !!opts.automated;
    if (key === "prepare") {
      await startStage(ctx, key, by.userId, automated);
      void runPrepare(ctx, r, by);
    } else if (key === "init") {
      await startInit(ctx, run, by, automated);
    } else if (key === "review") {
      await runReview(ctx, run, by, automated);
    } else {
      await startStage(ctx, key, by.userId, automated);
      void runDeliver(ctx, by);
    }
    return { started: key };
  } finally {
    busy.delete(runId);
  }
}

async function runPrepare(ctx: Ctx, r: Awaited<ReturnType<typeof loadRepo>>, by: Actor) {
  try {
    const log = (line: string) => terminalLine(ctx.runId, line);
    const ws = await ensureOnboardingWorkspace(r, ctx.runId, log);
    const fileCount = await trackedFileCount(ws.dir);
    const existing = existingSetup(ws.dir);
    log(`baseline ${ws.baselineSha.slice(0, 7)} on ${ws.defaultBranch ?? "HEAD"} · ${fileCount.toLocaleString("en-US")} files · branch ${ws.branch}`);
    const found = [
      existing.claudeMdLines !== null ? `CLAUDE.md (${existing.claudeMdLines} lines)` : null,
      existing.agentsMd ? "AGENTS.md" : null,
      existing.rules ? `${existing.rules} rules` : null,
      existing.skills ? `${existing.skills} skills` : null,
      existing.hooks ? `${existing.hooks} hooks` : null,
      existing.agents ? `${existing.agents} agents` : null,
      existing.settings ? "settings.json" : null,
    ].filter(Boolean);
    log(found.length ? `existing Claude Code setup: ${found.join(", ")}` : "no existing Claude Code setup");
    await patchRun(ctx, { workspacePath: ws.dir, baselineSha: ws.baselineSha, branchName: ws.branch, defaultBranch: ws.defaultBranch });
    const result: PrepareResult = { branch: ws.branch, baselineSha: ws.baselineSha, defaultBranch: ws.defaultBranch, baseFrom: ws.baseFrom, fileCount, existing };
    await completeStage(ctx, "prepare", result, by.userId);
    await drive(ctx.repoId, ctx.runId);
  } catch (e) {
    await failStage(ctx, "prepare", e, by.userId);
  }
}

/** The model and effort for the session: the person's choice, else the routing policy's. */
function sessionModel(run: RunRow): { model: string; effort: string } {
  const rec = recommend("onboarding_init");
  const choice = normalizeModelPolicy(run.modelChoices).init;
  return { model: choice?.model ?? rec.model, effort: choice?.effort ?? rec.effort };
}

async function startInit(ctx: Ctx, run: RunRow, by: Actor, automated: boolean) {
  if (!run.workspacePath) throw new OnboardingError("אין עותק מבודד — הריצו קודם את הכנת הריפו");
  await startStage(ctx, "init", by.userId, automated);
  await launchSession(ctx, run, by, false);
}

async function launchSession(ctx: Ctx, run: RunRow, by: Actor, resume: boolean) {
  // Anything the previous process spent that never reached the ledger (an
  // API restart mid-session) is recorded before the new process starts.
  if (resume) await recordSessionSlice(ctx, null, by.userId);
  const prior = sessionOf(resume ? (await loadRun(ctx.repoId, ctx.runId)).run : run);
  const sessionId = resume && prior.id ? prior.id : randomUUID();
  const { model, effort } = sessionModel(run);
  // A new process counts from zero, and until it reports, the file still
  // holds the previous process's numbers under the same session id.
  rmSync(statusFile(ctx.runId), { force: true });
  try {
    startClaudeSession({
      runId: ctx.runId, cwd: run.workspacePath!, sessionId, resume, model, effort,
      onExit: (exitCode) => { void onSessionExit(ctx, exitCode); },
    });
  } catch (e) {
    if (!resume) await failStage(ctx, "init", e, by.userId);
    throw e instanceof OnboardingError ? e : new OnboardingError(`לא ניתן להפעיל את Claude Code: ${(e as Error).message}`);
  }
  const base = resume ? sessionTotals(prior) : undefined;
  await patchSession(ctx, {
    id: sessionId, state: "live", startedAt: new Date().toISOString(), endedAt: undefined, exitCode: undefined, model, effort,
    status: undefined, base,
    // A new process counts from zero; the cursor says everything before it is already in the ledger.
    ledgerCursor: { ...(base ?? ZERO), stageKey: run.currentStageKey ?? "init", at: new Date().toISOString() },
  });
  await event(ctx, resume ? "onboarding.session.resumed" : "onboarding.session.started", { sessionId, model, effort }, by.userId);
  startMonitor(ctx, run.triggeredBy);
}

async function onSessionExit(ctx: Ctx, exitCode: number | null) {
  await pollSession(ctx, null);
  stopMonitor(ctx.runId);
  await recordSessionSlice(ctx, null, lastInputUser(ctx.runId));
  await patchSession(ctx, { state: "ended", endedAt: new Date().toISOString(), exitCode });
  await event(ctx, "onboarding.session.ended", { exitCode }, lastInputUser(ctx.runId));
  // The monitor is stopped now; a session that ended with `/init`'s files written is a finished `/init`.
  await checkInitFinished(ctx);
}

/** DCC saw `/init` finish (`checkInitFinished`): close the stage, close the
 *  Claude session — the terminal stays on screen as it was, locked, and there
 *  is no way back into the conversation — and open the review at once,
 *  whatever the automation policy says about starting stages: reading the
 *  changed files writes nothing, and the review's own gate still waits for a
 *  person. The stage is closed on behalf of whoever started the run, and says
 *  so (`auto`). */
async function finishInit(ctx: Ctx, run: RunRow) {
  const by: Actor = { userId: run.triggeredBy };
  await pollSession(ctx, run.triggeredBy);
  await recordSessionSlice(ctx, "init", by.userId);
  const { run: fresh } = await loadRun(ctx.repoId, ctx.runId);
  const fs = sessionOf(fresh);
  const files = await changedFiles(fresh.workspacePath!, fresh.baselineSha!);
  await completeStage(ctx, "init", { sessionId: fs.id ?? "", changedFiles: files.length, completedBy: by.userId, auto: true } satisfies InitResult, by.userId,
    { model: sessionModelId(fs), effort: sessionEffort(fs) } satisfies StageUsage);
  initClosed.add(ctx.runId);
  await event(ctx, "onboarding.init.auto_completed", { files: files.length }, by.userId);
  terminalLine(ctx.runId, "[DCC] Claude סיים לכתוב. הסשן נסגר והטרמינל ננעל — עוברים לסקירת התוצרים.");
  await stopClaudeSession(ctx.runId, true);
  await drive(ctx.repoId, ctx.runId);
  try { await runOnboardingStage(ctx.repoId, ctx.runId, "review", by, { automated: true }); } catch { /* the policy already started it */ }
}

export async function resumeOnboardingSession(repoId: string, runId: string, by: Actor) {
  const { run, stages, ctx } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה הסתיימה");
  if (stages.find((s) => s.stageKey === "init")?.status === "Completed") throw new OnboardingError("ההטמעה הסתיימה ואי אפשר לחזור אליה");
  if (!sessionOf(run).id) throw new OnboardingError("עדיין לא היה סשן בהרצה הזו — הריצו את שלב ההטמעה");
  if (terminalState(runId) === "live") throw new OnboardingError("הסשן כבר פעיל");
  await launchSession(ctx, run, by, true);
  return { resumed: true };
}

async function runReview(ctx: Ctx, run: RunRow, by: Actor, automated: boolean) {
  if (!run.workspacePath || !run.baselineSha) throw new OnboardingError("אין עותק מבודד להשוואה");
  await startStage(ctx, "review", by.userId, automated);
  const files = await changedFiles(run.workspacePath, run.baselineSha);
  const result: ReviewResult = { changedFiles: files, checkedAt: new Date().toISOString() };
  await patchStage(ctx, "review", { status: "WaitingForUser", result });
  await patchRun(ctx, { status: "WaitingForUser", currentStageKey: "review" });
  terminalLine(ctx.runId, `review: ${files.length} files changed against ${run.baselineSha.slice(0, 7)}`);
  if (normalizePolicy(run.automation).stages.review.gate === "auto") {
    await approve(ctx, by, true);
    // The caller still holds this run's lock; drive once it is released.
    setTimeout(() => { void drive(ctx.repoId, ctx.runId); }, 0);
  }
}

export async function approveReview(repoId: string, runId: string, by: Actor) {
  const { ctx } = await loadRun(repoId, runId);
  await approve(ctx, by, false);
  await drive(repoId, runId);
  return { approved: true };
}

async function approve(ctx: Ctx, by: Actor, auto: boolean) {
  const { run, stages } = await loadRun(ctx.repoId, ctx.runId);
  const s = stages.find((x) => x.stageKey === "review");
  if (s?.status !== "WaitingForUser") throw new OnboardingError("שלב הסקירה לא ממתין לאישור");
  await pollSession(ctx, run.triggeredBy);
  await recordSessionSlice(ctx, "review", by.userId);
  const files = await changedFiles(run.workspacePath!, run.baselineSha!);
  const fs = sessionOf((await loadRun(ctx.repoId, ctx.runId)).run);
  const result: ReviewResult = { changedFiles: files, checkedAt: new Date().toISOString(), approvedBy: by.userId, approvedAt: new Date().toISOString(), auto };
  if (auto) await event(ctx, "onboarding.gate.auto_resolved", { stageKey: "review", preset: normalizePolicy(run.automation).preset }, by.userId);
  await event(ctx, "onboarding.review.approved", { files: files.length, auto }, by.userId);
  await completeStage(ctx, "review", result, by.userId, { model: sessionModelId(fs), effort: sessionEffort(fs) } satisfies StageUsage);
}

async function runDeliver(ctx: Ctx, by: Actor) {
  try {
    const { run, stages } = await loadRun(ctx.repoId, ctx.runId);
    if (!run.workspacePath || !run.branchName) throw new Error("אין עותק מבודד למסירה");
    const reviewed = (stages.find((s) => s.stageKey === "review")?.result ?? {}) as ReviewResult;
    const body = await pullRequestBody(ctx, run, reviewed.changedFiles ?? []);
    const result: DeliverResult = await deliverWorkspace({
      dir: run.workspacePath, branch: run.branchName, defaultBranch: run.defaultBranch, baselineSha: run.baselineSha, userId: by.userId,
      title: `DCC onboarding: Claude Code setup for ${ctx.repoName}`, body, log: (l) => terminalLine(ctx.runId, l),
    });
    await event(ctx, "onboarding.delivered", { commitSha: result.commitSha, prUrl: result.prUrl, compareUrl: result.compareUrl, localOnly: result.localOnly }, by.userId);
    await stopClaudeSession(ctx.runId, true);
    await completeStage(ctx, "deliver", result, by.userId);
  } catch (e) {
    await failStage(ctx, "deliver", e, by.userId);
  }
}

async function pullRequestBody(ctx: Ctx, run: RunRow, files: ChangedFile[]): Promise<string> {
  const events = await runEvents(ctx);
  const answers = events.filter((e) => e.type === "onboarding.session.answer").map((e) => e.payload as { question?: string; answer?: string });
  const s = sessionOf(run);
  return [
    "## What this PR adds",
    "",
    ...(files.length ? files.map((f) => `- \`${f.path}\` (${f.status}, +${f.additions} −${f.deletions})`) : ["- (no files)"]),
    "",
    "## How it was made",
    "",
    "Claude Code's own `/init` (`CLAUDE_CODE_NEW_INIT=1`), run in an isolated worktree through DCC; every file was reviewed and approved by a person before this commit.",
    "",
    ...(answers.length ? ["### Decisions in the session", "", ...answers.map((a) => `- ${a.question ?? ""} → **${a.answer ?? ""}**`), ""] : []),
    "## Metadata",
    "",
    `- Baseline commit: \`${run.baselineSha ?? "?"}\``,
    `- Session: \`${s.id ?? "?"}\` · ${s.status?.model ?? s.model ?? "?"} · effort ${s.status?.effort ?? s.effort ?? "?"} · $${sessionTotals(s).costUsd.toFixed(2)}`,
    "",
    "---",
    "🤖 Generated by DCC repository onboarding",
  ].join("\n");
}

/* ── cancel, automation, model ────────────────────────────────────── */

export async function cancelOnboardingRun(repoId: string, runId: string, by: Actor) {
  const { run, stages, ctx } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה כבר הסתיימה");
  closing.add(runId);
  await stopClaudeSession(runId, true);
  stopMonitor(runId);
  await recordSessionSlice(ctx, null, by.userId);
  for (const s of stages) if (s.status === "Running" || s.status === "WaitingForUser" || s.status === "Pending") await patchStage(ctx, s.stageKey as StageKey, { status: "Cancelled" });
  await patchRun(ctx, { status: "Cancelled", cancelledAt: new Date(), cancelledBy: by.userId });
  await event(ctx, "onboarding.run.cancelled", {}, by.userId);
  terminalLine(runId, "ההרצה בוטלה. העותק המבודד והענף נשארים כמו שהם.");
  return { cancelled: true };
}

export async function updateOnboardingAutomation(repoId: string, runId: string, raw: unknown, consent: boolean, by: Actor): Promise<AutomationPolicy> {
  const { run, stages, ctx } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה הסתיימה");
  const policy = normalizePolicy(raw);
  if (policyNeedsConsent(policy) && !consent) throw new OnboardingError("מדיניות שמאשרת שער בלי אדם דורשת הסכמה מפורשת");
  await patchRun(ctx, { automation: policy });
  await event(ctx, "onboarding.automation.updated", { preset: policy.preset }, by.userId);
  if (stages.find((s) => s.stageKey === "review")?.status === "WaitingForUser" && policy.stages.review.gate === "auto") {
    await approve(ctx, { userId: by.userId }, true);
  }
  await drive(repoId, runId);
  return policy;
}

export async function updateOnboardingModelChoices(repoId: string, runId: string, raw: unknown, by: Actor): Promise<ModelPolicy> {
  const { run, ctx } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה הסתיימה");
  const choices = normalizeModelPolicy(raw);
  await patchRun(ctx, { modelChoices: choices });
  await event(ctx, "onboarding.model_choices.updated", { choices }, by.userId);
  return choices;
}

/** The automation policy's turn: start the next stage when it is set to
 *  start by itself. The Claude session counts as a person's action for
 *  identity — it is started on behalf of whoever started the run. */
async function drive(repoId: string, runId: string) {
  const { run, stages } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus) || run.status === "Failed") return;
  const next = stages.find((s) => s.status !== "Completed");
  if (!next || next.status !== "Pending" || !isStageKey(next.stageKey) || !runnable(stages, next.stageKey)) return;
  if (normalizePolicy(run.automation).stages[next.stageKey]?.run !== "auto") return;
  try {
    await runOnboardingStage(repoId, runId, next.stageKey, { userId: run.triggeredBy }, { automated: true });
  } catch { /* a failed automatic start is recorded on the stage; nothing else to do */ }
}

/* ── the session monitor ──────────────────────────────────────────── */

const monitors = new Map<string, NodeJS.Timeout>();
const polling = new Set<string>();

function startMonitor(ctx: Ctx, fallbackActor: string) {
  stopMonitor(ctx.runId);
  monitors.set(ctx.runId, setInterval(() => { void pollSession(ctx, fallbackActor).then(() => checkInitFinished(ctx)); }, 3000));
}
function stopMonitor(runId: string) {
  const t = monitors.get(runId);
  if (t) clearInterval(t);
  monitors.delete(runId);
  settled.delete(runId);
  looked.delete(runId);
  initClosed.delete(runId);
}

/* ── `/init` finished ─────────────────────────────────────────────── */

/** `/init` has no end marker, so DCC decides from two facts: Claude ended a
 *  turn, and the isolated copy has changed. The turn must also stay ended for
 *  a few polls (nothing new in the transcript), so a turn that is followed at
 *  once by more work does not count. A wrong call costs little: the session
 *  stays open through the review, where Claude can still be asked for more.
 *  A session that has exited with the copy changed is finished too — nothing
 *  more will be written, and there is no button to say so. */
const SETTLE_POLLS = 3;
const settled = new Map<string, { lines: number; hits: number }>();
/** What the worktree was last read for, so it is read once per settled transcript and not on every poll while the person thinks. */
const looked = new Map<string, number>();
const initClosed = new Set<string>();
const checking = new Set<string>();
/** Runs being cancelled: their session is killed on purpose, which must not read as a `/init` that ended. */
const closing = new Set<string>();
const SESSION_OVER = -1;

async function checkInitFinished(ctx: Ctx) {
  if (checking.has(ctx.runId) || initClosed.has(ctx.runId) || closing.has(ctx.runId)) return;
  checking.add(ctx.runId);
  try {
    const { run, stages } = await loadRun(ctx.repoId, ctx.runId);
    const init = stages.find((x) => x.stageKey === "init");
    if (init?.status === "Completed") { initClosed.add(ctx.runId); return; }
    const s = sessionOf(run);
    if (init?.status !== "Running" || !run.workspacePath || !run.baselineSha || (s.state !== "live" && s.state !== "ended")) { settled.delete(ctx.runId); return; }
    let at = SESSION_OVER;
    if (s.state === "live") {
      const t = s.transcriptPath ? turnEnded(s.transcriptPath) : null;
      if (!t?.ended) { settled.delete(ctx.runId); return; }
      const before = settled.get(ctx.runId);
      const st = before && before.lines === t.lineCount ? { ...before, hits: before.hits + 1 } : { lines: t.lineCount, hits: 1 };
      settled.set(ctx.runId, st);
      if (st.hits < SETTLE_POLLS) return;
      at = st.lines;
    }
    if (looked.get(ctx.runId) === at) return;
    looked.set(ctx.runId, at);
    if (!(await changedFiles(run.workspacePath, run.baselineSha)).length) return;
    await finishInit(ctx, run);
  } catch { /* a transient error: the next poll tries again */ }
  finally {
    checking.delete(ctx.runId);
  }
}

const FACT_EVENT: Record<TranscriptFact["kind"], string> = {
  prompt: "onboarding.session.prompt",
  command: "onboarding.session.command",
  answer: "onboarding.session.answer",
};

/** Fold the latest status-line snapshot into the run, and turn new
 *  transcript lines into events. Writes only when something changed. */
async function pollSession(ctx: Ctx, fallbackActor: string | null) {
  if (polling.has(ctx.runId)) return;
  polling.add(ctx.runId);
  try {
    const [row] = await withTenant(ctx.clientId, (tx) => tx.select().from(repositoryOnboardingRun).where(eq(repositoryOnboardingRun.id, ctx.runId)).limit(1));
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
    const actor = lastInputUser(ctx.runId) ?? fallbackActor ?? row.triggeredBy;
    if (next.transcriptPath) {
      const scan = scanTranscript(next.transcriptPath, s.transcriptCursor ?? 0, s.lastMessageId ?? null);
      for (const f of scan.facts) {
        const { kind, ...payload } = f;
        await event(ctx, FACT_EVENT[kind], { ...payload, stageKey: row.currentStageKey }, actor);
      }
      next.transcriptCursor = scan.cursor;
      next.apiCalls = (s.apiCalls ?? 0) + scan.apiCalls;
      next.lastMessageId = scan.lastMessageId;
    }
    // Only the fields the monitor owns — never the session's state.
    const owned = { status: next.status, transcriptPath: next.transcriptPath, transcriptCursor: next.transcriptCursor, apiCalls: next.apiCalls, lastMessageId: next.lastMessageId };
    const before = { status: s.status, transcriptPath: s.transcriptPath, transcriptCursor: s.transcriptCursor, apiCalls: s.apiCalls, lastMessageId: s.lastMessageId };
    if (JSON.stringify(owned) !== JSON.stringify(before)) await patchSession(ctx, owned);
  } catch { /* a transient read error: the next tick tries again */ }
  finally {
    polling.delete(ctx.runId);
  }
}

/* ── reads ────────────────────────────────────────────────────────── */

async function runEvents(ctx: Ctx) {
  return withTenant(ctx.clientId, (tx) =>
    tx.select().from(repoAiEvent).where(and(eq(repoAiEvent.repoId, ctx.repoId), sql`${repoAiEvent.payload}->>'runId' = ${ctx.runId}`)).orderBy(asc(repoAiEvent.occurredAt)),
  );
}

export async function getOnboardingRunView(repoId: string, runId: string) {
  const { repo: r, run, stages, ctx } = await loadRun(repoId, runId);
  const events = await runEvents(ctx);
  const session = sessionOf(run);
  const live = terminalState(runId);
  session.state = live === "live" ? "live" : session.state === "live" ? "disconnected" : session.state;
  const totals = sessionTotals(session);
  const rec = recommend("onboarding_init");
  // The same picture the task screens draw, built from this run's worktree.
  const deliver = (stages.find((s) => s.stageKey === "deliver")?.result ?? {}) as Partial<DeliverResult>;
  let codeMap: CodeMap | null = null;
  if (run.workspacePath) {
    codeMap = await codeMapForWorkspace(run.workspacePath, {
      branch: run.branchName, baselineSha: run.baselineSha, prUrl: deliver.prUrl ?? null, prNumber: deliver.prNumber ?? null,
    }).catch(() => null);
  }
  // The run's cost is its ledger rows (claude-in-dcc §8.2) plus what the
  // live process has spent since the last slice — shown, and labelled as
  // not yet recorded, rather than hidden until the stage ends.
  const calls = await callsForEntity(ctx.clientId, { entityKind: "onboarding_run", entityId: runId });
  const sessionCalls = calls.filter((c) => c.capability === "onboarding_init");
  const chatCalls = calls.filter((c) => c.trigger === "chat" || c.trigger === "rollover");
  const cur = session.ledgerCursor ?? ZERO;
  const unrecorded = {
    costUsd: Math.max(0, totals.costUsd - cur.costUsd), inputTokens: Math.max(0, totals.inputTokens - cur.inputTokens),
    outputTokens: Math.max(0, totals.outputTokens - cur.outputTokens), apiDurationMs: Math.max(0, totals.apiDurationMs - cur.apiDurationMs),
  };
  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
  const byStage = new Map<string, { stageKey: string; model: string | null; effort: string | null; costUsd: number }>();
  for (const c of sessionCalls) {
    const k = String(c.meta.stageKey ?? "init");
    const e = byStage.get(k) ?? { stageKey: k, model: c.modelUsed, effort: c.effort, costUsd: 0 };
    e.costUsd += c.costUsd;
    byStage.set(k, e);
  }
  if (unrecorded.costUsd > 0) {
    const k = String(session.ledgerCursor?.stageKey ?? run.currentStageKey ?? "init");
    const e = byStage.get(k) ?? { stageKey: k, model: sessionModelId(session), effort: sessionEffort(session), costUsd: 0 };
    e.costUsd += unrecorded.costUsd;
    byStage.set(k, e);
  }
  const cost = {
    totalCostUsd: sum(sessionCalls, (c) => c.costUsd) + unrecorded.costUsd,
    liveUsd: unrecorded.costUsd,
    apiCalls: session.apiCalls ?? 0,
    inputTokens: sum(sessionCalls, (c) => c.inputTokens) + unrecorded.inputTokens,
    outputTokens: sum(sessionCalls, (c) => c.outputTokens) + unrecorded.outputTokens,
    apiDurationMs: sum(sessionCalls, (c) => c.durationMs ?? 0) + unrecorded.apiDurationMs,
    chat: chatCalls.length
      ? { costUsd: sum(chatCalls, (c) => c.costUsd), calls: chatCalls.length, inputTokens: sum(chatCalls, (c) => c.inputTokens), outputTokens: sum(chatCalls, (c) => c.outputTokens) }
      : null,
    byStage: [...byStage.values()],
    calls,
  };
  return {
    repo: { id: r.id, name: r.name },
    run: { ...run, session },
    stages,
    events,
    definitions: STAGES,
    automation: normalizePolicy(run.automation),
    modelChoices: normalizeModelPolicy(run.modelChoices),
    recommended: { init: { model: rec.model, effort: rec.effort } },
    codeMap,
    cost,
  };
}

export async function getOnboardingFileVersions(repoId: string, runId: string, filePath: string) {
  const { run } = await loadRun(repoId, runId);
  if (!run.workspacePath || !run.baselineSha) throw new OnboardingError("אין עותק מבודד עדיין");
  return fileVersions(run.workspacePath, run.baselineSha, filePath);
}

export async function listOnboardingRuns(repoId: string) {
  const r = await loadRepo(repoId);
  return withTenant(r.clientId, (tx) =>
    tx.select({ id: repositoryOnboardingRun.id, status: repositoryOnboardingRun.status, currentStageKey: repositoryOnboardingRun.currentStageKey, startedAt: repositoryOnboardingRun.startedAt, completedAt: repositoryOnboardingRun.completedAt, branchName: repositoryOnboardingRun.branchName })
      .from(repositoryOnboardingRun).where(eq(repositoryOnboardingRun.repoId, repoId)).orderBy(desc(repositoryOnboardingRun.startedAt)),
  );
}

export async function getLatestOnboardingRun(repoId: string) {
  const [latest] = await listOnboardingRuns(repoId);
  return latest ? { runId: latest.id, status: latest.status as RunStatus, currentStageKey: latest.currentStageKey, completedAt: latest.completedAt } : null;
}

/** The stages and the routing policy's model/effort for the AI stage — the
 *  pre-start page shows both before a run exists. */
export function onboardingStageCatalogue() {
  const rec = recommend("onboarding_init");
  return { stages: STAGES, recommended: { init: { model: rec.model, effort: rec.effort } } };
}

/* ── what the one chat knows about a run (claude-in-dcc design §3) ─── */

/** The facts the chat gets for a `run:<id>` topic: the session's state, what
 *  it did since the previous question (a digest of the transcript from the
 *  cursor), and the files changed in the isolated copy. The chat keeps the
 *  cursor; only what is new is handed over each time. */
export async function onboardingChatFacts(runId: string, cursor: number): Promise<{ facts: Record<string, unknown>; cursor: number }> {
  const [row] = await db.select().from(repositoryOnboardingRun).where(eq(repositoryOnboardingRun.id, runId)).limit(1);
  if (!row) return { facts: {}, cursor };
  const s = sessionOf(row);
  const digest = s.transcriptPath ? digestTranscript(s.transcriptPath, cursor, cursor ? 10_000 : 14_000) : { text: "", cursor, entries: 0 };
  const files = row.workspacePath && row.baselineSha ? await changeSummary(row.workspacePath, row.baselineSha).catch(() => "") : "";
  const stage = row.currentStageKey ? stageDefinition(row.currentStageKey as StageKey)?.title_he ?? row.currentStageKey : "—";
  return {
    facts: {
      "שלב נוכחי": stage,
      "מצב ההרצה": row.status,
      "סשן Claude": s.state === "live" ? "פעיל" : s.state === "ended" ? "נסגר" : s.state === "disconnected" ? "נותק" : "לא התחיל",
      "מה הסשן עשה מאז השאלה הקודמת": digest.text || "(אין חדש)",
      "קבצים ששונו בעותק המבודד": files || "(אין)",
    },
    cursor: digest.cursor,
  };
}

/** Type an instruction into the live session, as the person who pressed send.
 *  DCC sends it only while the session looks idle (its last transcript entry is
 *  a finished answer); otherwise it says why, and `force` sends it anyway. */
export async function sendToOnboardingSession(repoId: string, runId: string, by: Actor, input: { text: string; messageId?: string; force?: boolean }) {
  const { run, ctx } = await loadRun(repoId, runId);
  const text = input.text.replace(/\r\n/g, "\n").trim();
  if (!text) throw new OnboardingError("אין מה לשלוח");
  if (text.length > 4000) throw new OnboardingError("ההוראה ארוכה מדי — עד 4,000 תווים");
  if (terminalState(runId) !== "live") throw new OnboardingError("סשן Claude לא פעיל — חדשו אותו משלב ההטמעה ואז שלחו");
  if (!input.force) {
    const idle = sessionIdle(sessionOf(run).transcriptPath ?? "");
    if (!idle.idle) return { sent: false as const, busy: true as const, reason: idle.why };
  }
  const file = sessionOf(run).transcriptPath ?? "";
  const before = file ? transcriptLineCount(file) : 0;
  // A bracketed paste keeps a multi-line instruction as one message; Enter follows once the terminal has taken it.
  if (!writeTerminalInput(runId, `\x1b[200~${text}\x1b[201~`, by.userId)) throw new OnboardingError("סשן Claude לא פעיל");
  await new Promise((r) => setTimeout(r, 500));
  writeTerminalInput(runId, "\r", by.userId);
  await event(ctx, "onboarding.session.instructed", { text: text.length > 500 ? `${text.slice(0, 499)}…` : text, forced: !!input.force, messageId: input.messageId ?? null }, by.userId);
  // Typed into a terminal is not the same as received: look for the message in the transcript.
  let confirmed = false;
  for (let i = 0; i < 12 && file && !confirmed; i++) {
    await new Promise((r) => setTimeout(r, 500));
    confirmed = promptSeenAfter(file, before, text);
  }
  return { sent: true as const, confirmed };
}

/** For the terminal socket: the run must exist and belong to the repository. */
export async function authorizeOnboardingTerminal(repoId: string, runId: string) {
  const { ctx } = await loadRun(repoId, runId);
  return { clientId: ctx.clientId };
}

/* ── restart ──────────────────────────────────────────────────────── */

/** After an API restart: a git stage that was mid-flight is marked failed
 *  (its button reruns it); a Claude session that was live is marked
 *  disconnected — the same conversation reopens with `--resume`. */
export async function recoverOnboardingRuns(): Promise<number> {
  const live = await db.select().from(repositoryOnboardingRun).where(inArray(repositoryOnboardingRun.status, [...LIVE_RUN_STATUSES]));
  let touched = 0;
  for (const run of live) {
    const ctx: Ctx = { repoId: run.repoId, runId: run.id, clientId: run.clientId, repoName: "" };
    const stages = await db.select().from(repositoryOnboardingStage).where(eq(repositoryOnboardingStage.runId, run.id));
    for (const s of stages) {
      if (s.status === "Running" && (s.stageKey === "prepare" || s.stageKey === "deliver")) {
        await failStage(ctx, s.stageKey, new Error("השלב הופסק כשהשרת הופעל מחדש — הריצו אותו שוב"), null);
        touched++;
      }
    }
    const was = sessionOf(run).state;
    if (was === "live") {
      await patchSession(ctx, { state: "disconnected" });
      await event(ctx, "onboarding.session.disconnected", { reason: "api_restart" }, null);
      terminalLine(run.id, "[השרת הופעל מחדש — הסשן של Claude נותק. אפשר לחדש אותו מאותה נקודה]");
      touched++;
    }
    // A session already cut by an earlier restart must still read as disconnected on the screen.
    if (was === "live" || was === "disconnected") markDisconnected(run.id);
  }
  return touched;
}
