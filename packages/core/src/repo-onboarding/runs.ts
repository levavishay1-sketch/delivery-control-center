import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, withTenant } from "@dcc/db";
import { repo, repoAiEvent, repositoryOnboardingRun, repositoryOnboardingStage } from "@dcc/db/schema";
import { recommend } from "../routing.ts";
import { changedFiles, fileDiff } from "./changes.ts";
import { deliverWorkspace } from "./deliver.ts";
import { appendRepoAiEvent } from "./events.ts";
import { assistantBusy, assistantMessages, assistantModel, askAssistant, markAssistantSent, resetAssistant } from "./assistant.ts";
import { lastInputUser, markDisconnected, startClaudeSession, statusFile, stopClaudeSession, terminalLine, terminalState, writeTerminalInput } from "./session.ts";
import { promptSeenAfter, readStatusSnapshot, scanTranscript, sessionIdle, transcriptLineCount, type TranscriptFact } from "./transcript.ts";
import {
  LIVE_RUN_STATUSES, STAGES, isStageKey, normalizeModelPolicy, normalizePolicy, policyNeedsConsent, presetPolicy, stageDefinition,
  type AutomationPolicy, type ChangedFile, type DeliverResult, type ModelPolicy, type PrepareResult, type ReviewResult, type RunSession,
  type RunStatus, type StageKey, type StageStatus, type StageUsage, type AssistantTotals, sessionTotals,
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
const usageOf = (s: Pick<StageRow, "usage">): StageUsage => (s.usage ?? {}) as StageUsage;
const costNow = (run: Pick<RunRow, "session">) => sessionTotals(sessionOf(run)).costUsd;

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
    log(`baseline ${ws.baselineSha.slice(0, 7)} · ${fileCount.toLocaleString("en-US")} files · branch ${ws.branch}`);
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
    const result: PrepareResult = { branch: ws.branch, baselineSha: ws.baselineSha, defaultBranch: ws.defaultBranch, fileCount, existing };
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
  await startStage(ctx, "init", by.userId, automated, { costAtStart: costNow(run) });
  await launchSession(ctx, run, by, false);
}

async function launchSession(ctx: Ctx, run: RunRow, by: Actor, resume: boolean) {
  const prior = sessionOf(run);
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
  await patchSession(ctx, {
    id: sessionId, state: "live", startedAt: new Date().toISOString(), endedAt: undefined, exitCode: undefined, model, effort,
    status: undefined, base: resume ? sessionTotals(prior) : undefined,
  });
  await event(ctx, resume ? "onboarding.session.resumed" : "onboarding.session.started", { sessionId, model, effort }, by.userId);
  startMonitor(ctx, run.triggeredBy);
}

async function onSessionExit(ctx: Ctx, exitCode: number | null) {
  await pollSession(ctx, null);
  stopMonitor(ctx.runId);
  await patchSession(ctx, { state: "ended", endedAt: new Date().toISOString(), exitCode });
  await event(ctx, "onboarding.session.ended", { exitCode }, lastInputUser(ctx.runId));
}

/** "סיימתי עם ההטמעה" — the person decides when `/init` is done; the
 *  session stays open for the rest of the run. */
export async function completeInitStage(repoId: string, runId: string, by: Actor) {
  const { run, stages, ctx } = await loadRun(repoId, runId);
  const s = stages.find((x) => x.stageKey === "init");
  if (s?.status !== "Running") throw new OnboardingError("שלב ההטמעה לא פעיל");
  await pollSession(ctx, run.triggeredBy);
  const { run: fresh } = await loadRun(repoId, runId);
  const status = sessionOf(fresh).status;
  const files = await changedFiles(fresh.workspacePath!, fresh.baselineSha!);
  await completeStage(ctx, "init", { sessionId: sessionOf(fresh).id ?? "", changedFiles: files.length, completedBy: by.userId }, by.userId,
    { ...usageOf(s), costAtEnd: costNow(fresh), model: status?.model ?? sessionOf(fresh).model ?? null, effort: status?.effort ?? sessionOf(fresh).effort ?? null });
  await drive(repoId, runId);
  return { completed: "init" };
}

export async function resumeOnboardingSession(repoId: string, runId: string, by: Actor) {
  const { run, stages, ctx } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה הסתיימה");
  if (stages.find((s) => s.stageKey === "deliver")?.status === "Completed") throw new OnboardingError("המסירה כבר בוצעה");
  if (!sessionOf(run).id) throw new OnboardingError("עדיין לא היה סשן בהרצה הזו — הריצו את שלב ההטמעה");
  if (terminalState(runId) === "live") throw new OnboardingError("הסשן כבר פעיל");
  await launchSession(ctx, run, by, true);
  return { resumed: true };
}

async function runReview(ctx: Ctx, run: RunRow, by: Actor, automated: boolean) {
  if (!run.workspacePath || !run.baselineSha) throw new OnboardingError("אין עותק מבודד להשוואה");
  await startStage(ctx, "review", by.userId, automated, { costAtStart: costNow(run) });
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

/** Re-read the worktree — after asking Claude for a change during review. */
export async function refreshReview(repoId: string, runId: string) {
  const { run, stages, ctx } = await loadRun(repoId, runId);
  const s = stages.find((x) => x.stageKey === "review");
  if (s?.status !== "WaitingForUser") throw new OnboardingError("שלב הסקירה לא ממתין");
  const files: ChangedFile[] = await changedFiles(run.workspacePath!, run.baselineSha!);
  await patchStage(ctx, "review", { result: { ...((s.result ?? {}) as ReviewResult), changedFiles: files, checkedAt: new Date().toISOString() } });
  return { changedFiles: files };
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
  const files = await changedFiles(run.workspacePath!, run.baselineSha!);
  const fresh = (await loadRun(ctx.repoId, ctx.runId)).run;
  const status = sessionOf(fresh).status;
  const result: ReviewResult = { changedFiles: files, checkedAt: new Date().toISOString(), approvedBy: by.userId, approvedAt: new Date().toISOString(), auto };
  if (auto) await event(ctx, "onboarding.gate.auto_resolved", { stageKey: "review", preset: normalizePolicy(run.automation).preset }, by.userId);
  await event(ctx, "onboarding.review.approved", { files: files.length, auto }, by.userId);
  await completeStage(ctx, "review", result, by.userId, { ...usageOf(s), costAtEnd: costNow(fresh), model: status?.model ?? null, effort: status?.effort ?? null });
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
  await stopClaudeSession(runId, true);
  stopMonitor(runId);
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
  monitors.set(ctx.runId, setInterval(() => { void pollSession(ctx, fallbackActor); }, 3000));
}
function stopMonitor(runId: string) {
  const t = monitors.get(runId);
  if (t) clearInterval(t);
  monitors.delete(runId);
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
  const total = totals.costUsd;
  const rec = recommend("onboarding_init");
  const cost = {
    totalCostUsd: total,
    apiCalls: session.apiCalls ?? 0,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    apiDurationMs: totals.apiDurationMs,
    assistant: session.assistant ?? null,
    byStage: stages.filter((s) => usageOf(s).costAtStart !== undefined).map((s) => {
      const u = usageOf(s);
      const end = s.status === "Completed" ? (u.costAtEnd ?? total) : total;
      return { stageKey: s.stageKey, model: u.model ?? session.status?.model ?? session.model ?? null, effort: u.effort ?? session.status?.effort ?? session.effort ?? null, costUsd: Math.max(0, end - (u.costAtStart ?? 0)) };
    }),
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
    cost,
  };
}

export async function getOnboardingFileDiff(repoId: string, runId: string, filePath: string) {
  const { run } = await loadRun(repoId, runId);
  if (!run.workspacePath || !run.baselineSha) throw new OnboardingError("אין עותק מבודד עדיין");
  return fileDiff(run.workspacePath, run.baselineSha, filePath);
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

/* ── the Hebrew assistant ─────────────────────────────────────────── */

export async function getOnboardingAssistant(repoId: string, runId: string) {
  await loadRun(repoId, runId);
  return { messages: assistantMessages(runId), model: assistantModel(), busy: assistantBusy(runId) };
}

/** Answer a question about the session. Its cost is added to the run's own assistant line. */
export async function askOnboardingAssistant(repoId: string, runId: string, question: string, screen?: string) {
  const { run, ctx } = await loadRun(repoId, runId);
  if (!question.trim()) throw new OnboardingError("כתבו שאלה");
  if (assistantBusy(runId)) throw new OnboardingError("העוזר עדיין עונה על השאלה הקודמת");
  const s = sessionOf(run);
  let a;
  try {
    a = await askAssistant({ runId, question, screen, transcriptPath: s.transcriptPath, workspacePath: run.workspacePath, baselineSha: run.baselineSha });
  } catch (e) {
    throw new OnboardingError(`העוזר לא הצליח לענות: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
  }
  const prev: AssistantTotals = s.assistant ?? { costUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
  await patchSession(ctx, {
    assistant: { costUsd: prev.costUsd + a.costUsd, calls: prev.calls + 1, inputTokens: prev.inputTokens + a.inputTokens, outputTokens: prev.outputTokens + a.outputTokens },
  });
  return { message: a.message, costUsd: a.costUsd };
}

export async function resetOnboardingAssistant(repoId: string, runId: string) {
  await loadRun(repoId, runId);
  resetAssistant(runId);
  return { reset: true };
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
  if (input.messageId) markAssistantSent(runId, input.messageId, !!input.force);
  await event(ctx, "onboarding.assistant.sent", { text: text.length > 500 ? `${text.slice(0, 499)}…` : text, forced: !!input.force }, by.userId);
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
