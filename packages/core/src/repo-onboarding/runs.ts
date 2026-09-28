import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, withTenant } from "@dcc/db";
import { onboardingComponent, onboardingProcess, onboardingTrial, repo, repoAiEvent, repoProfile, repoCoachProposal, repositoryOnboardingRun, repositoryOnboardingStep } from "@dcc/db/schema";
import { git, runClaudeRaw } from "../ai-assist.ts";
import { callsForEntity } from "../claude-center.ts";
import { codeMapForWorkspace, type CodeMap } from "../code-map.ts";
import { renderPrompt, requirePrompt } from "../prompts.ts";
import { estimateUsd, recommend, type Capability } from "../routing.ts";
import { buildComponents, previewAgentsMd, repoFacts, writeDossier, type Author } from "./build.ts";
import { changedFiles, fileVersions } from "./changes.ts";
import { KIND_HE, cardFromSeed, deliverable, familyOf, mergeSeeds, pullRequestReport, readiness, seedsFromProcesses, seedsFromTrials, stepsDeciding } from "./components.ts";
import { diagnoseRepository } from "./diagnose.ts";
import { deliverWorkspace } from "./deliver.ts";
import { DraftError, launchDraftSession, recordSessionSlice, recoverDraftSession, sendToDraftSession, sessionEffort, sessionModelId, sessionOf, setAfterDraftEnded, stopDraftSession, type DraftCtx } from "./draft.ts";
import { legacyDelta, summarizeEval, type EvalRunRecord, type EvalSummary } from "./eval/report.ts";
import { armsRootFor, runEval } from "./eval/run.ts";
import { evalContext, evalTasksFor, type EvalArm, type EvalTask } from "./eval/tasks.ts";
import { appendRepoAiEvent } from "./events.ts";
import { draftPaths, parseInitScan, renderDraft, seedsFromScan, withScanNote, type DraftFile, type InitScan } from "./init-scan.ts";
import { checkTrust, countSourceUse, fetchPage, parseSources, rememberSource, rememberedFor, seedFromSource, tagsToSearch, type RememberedSource } from "./marketplace.ts";
import { gatherEvidence, interviewFor, parseProcesses, processesFromEvidence, renderEvidence, renderInterview, renderProcesses, resolveAnswers } from "./processes.ts";
import { factsForJudge, profileFacts, profileSummary } from "./profile.ts";
import { applyRules, stackTags, type RuleFiring, type RuleSuppression } from "./rules.ts";
import { terminalLine, terminalState } from "./session.ts";
import { digestTranscript, sessionIdle, writtenPaths } from "./transcript.ts";
import { byKind, renderTrials } from "./trials.ts";
import {
  AUTOMATION_LEVELS, LIVE_RUN_STATUSES, STEPS, isStepKey, normalizeAutomation, sessionTotals, stepDefinition,
  type Automation, type BuildResult, type ClarifyingQuestion, type Component, type ComponentSeed, type ConnectResult, type DeliverResult, type DiagnoseResult, type DiscoveredProcess, type InitScanState, type InterviewAnswer, type InterviewQuestion,
  type PlanPhase, type PlanResult, type ProcessesResult, type ProfileCorrection, type Readiness, type RepoProfile, type RunStatus, type StepKey, type StepStatus, type TrialOutcome, type TrialPhase, type TrialResult,
} from "./types.ts";
import { jointCheck } from "./verify.ts";
import { ensureOnboardingWorkspace, existingSetup, runtimeDir, trackedFileCount } from "./workspace.ts";

/**
 * The onboarding run (`openspec/changes/repository-coach`): seven steps, the
 * same for every repository, whose result is different for each. Every
 * transition is persisted and written to `repo_ai_event`; the steps that
 * cost money or write outside the copy wait for a person, by the run's
 * automation level. The code decides stage transitions, what to install and
 * pass/fail wherever it can check; a model only does what code cannot —
 * trial tasks, authoring, the open search, the reviewer's questions.
 */

const execFileAsync = promisify(execFile);

/** A message meant for the person — the API returns it as-is (409). */
export class OnboardingError extends Error {}

type Actor = { userId: string };
type RunRow = typeof repositoryOnboardingRun.$inferSelect;
type StepRow = typeof repositoryOnboardingStep.$inferSelect;
type ComponentRow = typeof onboardingComponent.$inferSelect;
type Ctx = { repoId: string; runId: string; clientId: string; repoName: string; triggeredBy: string };

const RUN_OVER: readonly RunStatus[] = ["Completed", "Cancelled"];
const busy = new Set<string>();

/* ── loading ──────────────────────────────────────────────────────── */

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
  const steps = await withTenant(r.clientId, (tx) => tx.select().from(repositoryOnboardingStep).where(eq(repositoryOnboardingStep.runId, runId)).orderBy(asc(repositoryOnboardingStep.stepOrder)));
  const ctx: Ctx = { repoId, runId, clientId: r.clientId, repoName: r.name, triggeredBy: run.triggeredBy };
  return { repo: r, run, steps, ctx };
}

const stepOf = (steps: readonly StepRow[], key: StepKey) => steps.find((s) => s.stepKey === key);

async function loadProfile(ctx: Ctx): Promise<{ id: string; profile: RepoProfile; corrections: ProfileCorrection[] } | null> {
  const [row] = await withTenant(ctx.clientId, (tx) => tx.select().from(repoProfile).where(eq(repoProfile.runId, ctx.runId)).limit(1));
  return row ? { id: row.id, profile: row.profile as RepoProfile, corrections: (row.corrections ?? []) as ProfileCorrection[] } : null;
}
const requireProfile = async (ctx: Ctx) => { const p = await loadProfile(ctx); if (!p) throw new OnboardingError("אין פרופיל — האבחון עוד לא רץ"); return p; };

async function loadProcesses(ctx: Ctx): Promise<DiscoveredProcess[]> {
  const rows = await withTenant(ctx.clientId, (tx) => tx.select().from(onboardingProcess).where(eq(onboardingProcess.runId, ctx.runId)).orderBy(asc(onboardingProcess.createdAt)));
  return rows.map((r) => ({ key: r.key, title: r.title, source: r.source as DiscoveredProcess["source"], evidence: r.evidence as string[], steps: r.steps as DiscoveredProcess["steps"], trialTaskKey: r.trialTaskKey, impossible: r.impossible }));
}

/** Every run of every task, in order — a task runs more than once per phase, and each run is its own row. A phase run again first deletes its earlier rows. */
async function loadTrials(ctx: Ctx, phase?: TrialPhase): Promise<TrialOutcome[]> {
  const rows = await withTenant(ctx.clientId, (tx) => tx.select().from(onboardingTrial).where(phase ? and(eq(onboardingTrial.runId, ctx.runId), eq(onboardingTrial.phase, phase)) : eq(onboardingTrial.runId, ctx.runId)).orderBy(asc(onboardingTrial.createdAt)));
  return rows.map((r) => ({
    taskKey: r.taskKey, title_he: r.title, phase: r.phase as TrialPhase, runIndex: r.runIndex ?? 0, numTurns: r.numTurns ?? null, graders: (r.graders ?? []) as TrialOutcome["graders"],
    passed: r.passed, failureKind: r.failureKind as TrialOutcome["failureKind"], detail: r.detail, costUsd: Number(r.costUsd), callId: r.callId, judgedBy: r.judgedBy,
  }));
}

const asEvalRecord = (t: TrialOutcome): EvalRunRecord => ({ taskKey: t.taskKey, title_he: t.title_he, arm: t.phase === "baseline" ? "without" : "with", runIndex: t.runIndex ?? 0, passed: t.passed, failureKind: t.failureKind, detail: t.detail, costUsd: t.costUsd, numTurns: t.numTurns ?? null, graders: t.graders ?? [], judgedBy: t.judgedBy, callId: t.callId });

const cardOf = (r: ComponentRow): Component & { id: string } => ({
  id: r.id, key: r.key, kind: r.kind as Component["kind"], family: r.family as Component["family"], title_he: r.title, why_he: r.why, what_he: r.what, source: r.source as Component["source"], sourceRef: r.sourceRef,
  group: r.group as Component["group"], risk: r.risk as Component["risk"], contextTokens: r.contextTokens, verifyHow_he: r.verifyHow, status: r.status as Component["status"], params: (r.params ?? {}) as Record<string, unknown>,
  files: (r.files ?? []) as string[], validation: (r.validation ?? null) as Component["validation"], delta: (r.delta ?? null) as Component["delta"], questions: (r.questions ?? []) as ClarifyingQuestion[],
  decidedBy: r.decidedBy, decidedAt: r.decidedAt?.toISOString() ?? null, declineReason: r.declineReason,
});

async function loadCards(ctx: Ctx): Promise<(Component & { id: string })[]> {
  const rows = await withTenant(ctx.clientId, (tx) => tx.select().from(onboardingComponent).where(eq(onboardingComponent.runId, ctx.runId)).orderBy(asc(onboardingComponent.createdAt)));
  return rows.map(cardOf);
}

/* ── writing ──────────────────────────────────────────────────────── */

async function event(ctx: Ctx, type: string, payload: Record<string, unknown>, actor: string | null) {
  await appendRepoAiEvent({ clientId: ctx.clientId, repoId: ctx.repoId, type, payload: { runId: ctx.runId, ...payload }, actorUserId: actor });
}
const patchRun = (ctx: Ctx, patch: Partial<typeof repositoryOnboardingRun.$inferInsert>) =>
  withTenant(ctx.clientId, (tx) => tx.update(repositoryOnboardingRun).set(patch).where(eq(repositoryOnboardingRun.id, ctx.runId)));
const patchStep = (ctx: Ctx, key: StepKey, patch: Partial<typeof repositoryOnboardingStep.$inferInsert>) =>
  withTenant(ctx.clientId, (tx) => tx.update(repositoryOnboardingStep).set({ ...patch, updatedAt: new Date() }).where(and(eq(repositoryOnboardingStep.runId, ctx.runId), eq(repositoryOnboardingStep.stepKey, key))));

async function startStep(ctx: Ctx, key: StepKey, actor: string, automated: boolean) {
  await patchStep(ctx, key, { status: "Running", startedAt: new Date(), completedAt: null, errors: [] });
  await patchRun(ctx, { status: "Running", currentStepKey: key });
  await event(ctx, "onboarding.step.started", { stepKey: key, automated }, actor);
  terminalLine(ctx.runId, `── ${stepDefinition(key)?.title_he ?? key} ──`);
}
async function waitStep(ctx: Ctx, key: StepKey, result: unknown, actor: string | null, why: string) {
  await patchStep(ctx, key, { status: "WaitingForUser", result: result as object });
  await patchRun(ctx, { status: "WaitingForUser", currentStepKey: key });
  await event(ctx, "onboarding.step.waiting", { stepKey: key, why }, actor);
  terminalLine(ctx.runId, `⏸ ${why}`);
}
async function completeStep(ctx: Ctx, key: StepKey, result: unknown, actor: string | null) {
  await patchStep(ctx, key, { status: "Completed", completedAt: new Date(), result: result as object });
  const { steps } = await loadRun(ctx.repoId, ctx.runId);
  const next = steps.find((s) => s.status !== "Completed");
  await patchRun(ctx, next ? { status: next.status === "WaitingForUser" ? "WaitingForUser" : "Running", currentStepKey: next.stepKey } : { status: "Completed", currentStepKey: null, completedAt: new Date() });
  await event(ctx, "onboarding.step.completed", { stepKey: key }, actor);
  if (!next) { await event(ctx, "onboarding.run.completed", {}, actor); terminalLine(ctx.runId, "✓ ההרצה הושלמה"); }
}
async function failStep(ctx: Ctx, key: StepKey, error: unknown, actor: string | null) {
  const message = error instanceof Error ? error.message : String(error);
  await patchStep(ctx, key, { status: "Failed", completedAt: new Date(), errors: [message] });
  await patchRun(ctx, { status: "Failed", currentStepKey: key });
  await event(ctx, "onboarding.step.failed", { stepKey: key, error: message.slice(0, 500) }, actor);
  terminalLine(ctx.runId, `✗ ${stepDefinition(key)?.title_he ?? key}: ${message}`);
}

/** Runs the next pending step by itself, when its start needs nobody. A step that waits (the interview, the trial's cost, the plan, the delivery) stops here. */
async function advance(ctx: Ctx, by: Actor) {
  const { run, steps } = await loadRun(ctx.repoId, ctx.runId);
  if (RUN_OVER.includes(run.status as RunStatus) || run.status === "Failed") return;
  const next = steps.find((s) => s.status !== "Completed");
  if (!next || next.status !== "Pending" || !isStepKey(next.stepKey)) return;
  await runOnboardingStep(ctx.repoId, ctx.runId, next.stepKey, by, { automated: true });
}

/* ── the Claude calls of a run ────────────────────────────────────── */

type CallOpts = {
  capability: Capability; label: string; stepKey: StepKey; by: string; cwd: string; lean?: boolean; tools?: string; commands?: boolean; maxTurns?: number; timeoutMs?: number; extraArgs?: string[];
  /** A lean call's read-only tools, the folders they may read, and whether it may think (a lean call answers in one turn without thinking unless told). */
  leanTools?: string; addDirs?: string[]; think?: boolean;
};

/** One instruction from the library, rendered, sent — and a ledger row with the step it belongs to. A lean call carries the whole prompt as its system prompt (no CLI preamble, no tools). */
async function callModel(ctx: Ctx, promptKey: string, vars: Record<string, string | boolean | undefined>, o: CallOpts): Promise<{ text: string; costUsd: number; callId: string | null }> {
  const body = renderPrompt((await requirePrompt(promptKey)).body, vars);
  const ledger = { clientId: ctx.clientId, userId: o.by, capability: o.capability, trigger: "button" as const, entity: { kind: "onboarding_run" as const, id: ctx.runId }, screen: "onboarding", label: o.label, meta: { stepKey: o.stepKey, promptKey } };
  let res;
  if (o.lean) {
    const dir = runtimeDir(ctx.runId);
    mkdirSync(dir, { recursive: true });
    const sys = path.join(dir, `${promptKey.replace(/\W/g, "_")}-${randomUUID().slice(0, 8)}.txt`);
    writeFileSync(sys, body, "utf8");
    res = await runClaudeRaw(dir, "Answer now, exactly in the format the instructions require.", { ledger, maxTurns: o.maxTurns ?? 1, timeoutMs: o.timeoutMs ?? 180_000, env: o.think ? {} : { MAX_THINKING_TOKENS: "0" }, lean: { systemPromptFile: sys, tools: o.leanTools, addDirs: o.addDirs } });
  } else {
    res = await runClaudeRaw(o.cwd, body, { ledger, maxTurns: o.maxTurns ?? 40, timeoutMs: o.timeoutMs ?? 480_000, commands: o.commands, tools: o.tools });
  }
  return { text: res.text, costUsd: res.meta.costUsd ?? 0, callId: res.callId };
}

/* ── starting a run ───────────────────────────────────────────────── */

export async function startOnboardingRun(repoId: string, by: Actor, opts: { automation?: unknown; kind?: "onboarding" | "coach"; proposalIds?: string[] } = {}) {
  const r = await loadRepo(repoId);
  const live = await withTenant(r.clientId, (tx) => tx.select({ id: repositoryOnboardingRun.id }).from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.repoId, repoId), inArray(repositoryOnboardingRun.status, [...LIVE_RUN_STATUSES]))).limit(1));
  if (live.length) throw new OnboardingError("כבר יש הרצה פעילה לריפו הזה — סיימו או בטלו אותה קודם");
  const automation = normalizeAutomation(opts.automation);
  const kind = opts.kind === "coach" ? "coach" : "onboarding";
  const runId = randomUUID();
  await withTenant(r.clientId, async (tx) => {
    await tx.insert(repositoryOnboardingRun).values({ id: runId, repoId, clientId: r.clientId, kind, status: "Pending", currentStepKey: STEPS[0]!.key, automation, session: { state: "none" }, triggeredBy: by.userId });
    await tx.insert(repositoryOnboardingStep).values(STEPS.map((s) => ({ runId, clientId: r.clientId, stepKey: s.key, stepOrder: s.order })));
    if (kind === "coach" && opts.proposalIds?.length) await tx.update(repoCoachProposal).set({ runId, status: "approved" }).where(inArray(repoCoachProposal.id, opts.proposalIds));
  });
  const ctx: Ctx = { repoId, runId, clientId: r.clientId, repoName: r.name, triggeredBy: by.userId };
  await event(ctx, "onboarding.run.started", { level: automation.level, kind, proposals: opts.proposalIds ?? [] }, by.userId);
  terminalLine(runId, `DCC · ${kind === "coach" ? "המאמן" : "הטמעת AI"} · ${r.name} · הרצה ${runId.slice(0, 8)} · מדרגה: ${automation.level}`);
  await advance(ctx, by);
  return { runId };
}

/* ── running a step ───────────────────────────────────────────────── */

const STEP_ORDER: readonly StepKey[] = STEPS.map((s) => s.key);
function runnable(steps: readonly StepRow[], key: StepKey): boolean {
  const s = stepOf(steps, key);
  if (!s || !(["Pending", "Failed"] as StepStatus[]).includes(s.status as StepStatus)) return false;
  return steps.filter((x) => x.stepOrder < s.stepOrder).every((x) => x.status === "Completed");
}

export async function runOnboardingStep(repoId: string, runId: string, key: string, by: Actor, opts: { automated?: boolean } = {}) {
  if (!isStepKey(key)) throw new OnboardingError("צעד לא מוכר");
  if (busy.has(runId)) throw new OnboardingError("פעולה אחרת בהרצה הזו עדיין מתבצעת");
  busy.add(runId);
  let ctx: Ctx;
  try {
    const loaded = await loadRun(repoId, runId);
    ctx = loaded.ctx;
    if (RUN_OVER.includes(loaded.run.status as RunStatus)) throw new OnboardingError("ההרצה הסתיימה");
    if (!runnable(loaded.steps, key)) throw new OnboardingError("הצעד הזה עוד לא זמין — הצעדים שלפניו צריכים להסתיים קודם");
    await startStep(ctx, key, by.userId, !!opts.automated);
  } finally {
    busy.delete(runId);
  }
  // The work itself runs after the lock is released: a long step must not block the screen's reads or a cancel.
  void (async () => {
    try {
      const { run } = await loadRun(repoId, runId);
      switch (key) {
        case "connect": await runConnect(ctx, run, by); break;
        case "diagnose": await runDiagnose(ctx, run, by); break;
        case "processes": await runProcessesPhase1(ctx, run, by); break;
        case "trial": await gateTrial(ctx, run, by); break;
        case "plan": await runPlan(ctx, run, by); break;
        case "build": await runBuild(ctx, run, by); break;
        case "deliver": await waitStep(ctx, "deliver", { files: await deliverableFiles(ctx) }, by.userId, "המסירה ממתינה ללחיצה — שום דבר לא יוצא מהמחשב לפני כן"); break;
      }
    } catch (e) {
      await failStep(ctx, key, e, by.userId);
    }
  })();
  return { started: key };
}

/* ── 0. connect ───────────────────────────────────────────────────── */

async function runConnect(ctx: Ctx, run: RunRow, by: Actor) {
  const r = await loadRepo(ctx.repoId);
  const log = (line: string) => terminalLine(ctx.runId, line);
  const ws = await ensureOnboardingWorkspace(r, ctx.runId, log);
  const fileCount = await trackedFileCount(ws.dir);
  const existing = existingSetup(ws.dir);
  log(`baseline ${ws.baselineSha.slice(0, 7)} on ${ws.defaultBranch ?? "HEAD"} · ${fileCount.toLocaleString("en-US")} files · branch ${ws.branch}`);
  await patchRun(ctx, { workspacePath: ws.dir, baselineSha: ws.baselineSha, branchName: ws.branch, defaultBranch: ws.defaultBranch });
  const result: ConnectResult = { branch: ws.branch, baselineSha: ws.baselineSha, defaultBranch: ws.defaultBranch, baseFrom: ws.baseFrom, fileCount, existing, level: normalizeAutomation(run.automation).level };
  await completeStep(ctx, "connect", result, by.userId);
  await advance(ctx, by);
}

/* ── 1. diagnose — no model, free ─────────────────────────────────── */

async function runDiagnose(ctx: Ctx, run: RunRow, by: Actor) {
  if (!run.workspacePath) throw new OnboardingError("אין עותק מבודד — החיבור לא רץ");
  const t0 = Date.now();
  const profile = await diagnoseRepository(run.workspacePath, ctx.repoName, { log: (l) => terminalLine(ctx.runId, l) });
  const prev = await loadProfile(ctx);
  const corrections = prev?.corrections ?? [];
  let id: string;
  if (prev) {
    await withTenant(ctx.clientId, (tx) => tx.update(repoProfile).set({ profile, baselineSha: run.baselineSha }).where(eq(repoProfile.id, prev.id)));
    id = prev.id;
  } else {
    const [row] = await withTenant(ctx.clientId, (tx) => tx.insert(repoProfile).values({ repoId: ctx.repoId, clientId: ctx.clientId, runId: ctx.runId, baselineSha: run.baselineSha, profile, corrections: [] }).returning({ id: repoProfile.id }));
    id = row!.id;
  }
  const facts = profileFacts(profile, corrections);
  for (const f of facts) terminalLine(ctx.runId, `${f.label_he}: ${f.value_he}`);
  const result: DiagnoseResult = { profileId: id, facts: facts.length, durationMs: Date.now() - t0, corrections: corrections.length };
  await event(ctx, "onboarding.profile.written", { facts: facts.length, languages: profile.languages.slice(0, 3).map((l) => l.language), durationMs: result.durationMs }, by.userId);
  await completeStep(ctx, "diagnose", result, by.userId);
  await advance(ctx, by);
}

/** "זה לא נכון" on a fact of the profile: recorded, and the plan (when it already exists) is drawn again without the rules that read that fact. */
export async function correctProfileFact(repoId: string, runId: string, by: Actor, input: { path: string; note?: string | null; undo?: boolean }) {
  const { run, steps, ctx } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה הסתיימה");
  const p = await requireProfile(ctx);
  const pathKey = input.path.trim();
  if (!pathKey || !/^[a-z_][\w./ -]*$/i.test(pathKey)) throw new OnboardingError("עובדה לא מוכרת");
  const corrections = input.undo ? p.corrections.filter((c) => c.path !== pathKey) : [...p.corrections.filter((c) => c.path !== pathKey), { path: pathKey, note: input.note?.trim() || null, by: by.userId, at: new Date().toISOString() }];
  await withTenant(ctx.clientId, (tx) => tx.update(repoProfile).set({ corrections }).where(eq(repoProfile.id, p.id)));
  await event(ctx, "onboarding.profile.corrected", { path: pathKey, note: input.note ?? null, undo: !!input.undo }, by.userId);
  if (stepOf(steps, "plan")?.status === "WaitingForUser") await replan(ctx, by, "corrected");
  return { corrections };
}

/* ── 2. processes: the interview, then the model ──────────────────── */

type ProcessesWaiting = { questions: InterviewQuestion[]; evidence: { source: string; title: string; lines: number }[] };

async function runProcessesPhase1(ctx: Ctx, run: RunRow, by: Actor) {
  const p = await requireProfile(ctx);
  if (run.kind === "coach") { await reuseFromPreviousRun(ctx, by); return; }
  const questions = interviewFor(p.profile);
  const evidence = gatherEvidence(p.profile, run.workspacePath);
  const waiting: ProcessesWaiting = { questions, evidence: evidence.map((e) => ({ source: e.source, title: e.title, lines: e.lines.length })) };
  await waitStep(ctx, "processes", waiting, by.userId, questions.length ? `${questions.length} שאלות קצרות — כל אחת עם ברירת מחדל` : "אין שאלות; לחצו להמשיך לפירוק התהליכים");
}

/** The person answered (or continued with the defaults): the model breaks the processes into steps, the code decides each step. */
export async function answerInterview(repoId: string, runId: string, by: Actor, answers: Record<string, string>) {
  const { run, steps, ctx } = await loadRun(repoId, runId);
  const s = stepOf(steps, "processes");
  if (s?.status !== "WaitingForUser") throw new OnboardingError("הראיון לא ממתין לתשובות");
  const waiting = (s.result ?? { questions: [] }) as ProcessesWaiting;
  const resolved = resolveAnswers(waiting.questions, answers);
  await patchStep(ctx, "processes", { status: "Running", result: { ...waiting, answers: resolved } });
  await patchRun(ctx, { status: "Running" });
  await event(ctx, "onboarding.interview.answered", { answered: resolved.filter((a) => !a.assumed).length, assumed: resolved.filter((a) => a.assumed).length, answers: resolved }, by.userId);
  void runProcessesPhase2(ctx, run, by, waiting.questions, resolved).catch((e) => failStep(ctx, "processes", e, by.userId));
  return { answers: resolved };
}

async function runProcessesPhase2(ctx: Ctx, run: RunRow, by: Actor, questions: InterviewQuestion[], answers: InterviewAnswer[]) {
  const p = await requireProfile(ctx);
  const evidence = gatherEvidence(p.profile, run.workspacePath);
  let processes: DiscoveredProcess[] = [];
  let costUsd = 0;
  try {
    const res = await callModel(ctx, "onboarding.processes", { REPO_NAME: ctx.repoName, PROFILE: profileSummary(p.profile), EVIDENCE: renderEvidence(evidence), INTERVIEW: renderInterview(questions, answers) },
      { capability: "onboarding_processes", label: "פירוק התהליכים לצעדים", stepKey: "processes", by: by.userId, cwd: run.workspacePath!, maxTurns: 30, timeoutMs: 480_000 });
    costUsd = res.costUsd;
    processes = parseProcesses(res.text);
  } catch (e) {
    terminalLine(ctx.runId, `הקריאה למודל נכשלה (${(e as Error).message.slice(0, 120)}) — התהליכים נגזרים מהראיות בלבד`);
  }
  if (!processes.length) processes = processesFromEvidence(p.profile);
  // A process that needs a build cannot be exercised where the build cannot run.
  if (p.profile.windows_build.windows_only_build && answers.find((a) => a.key === "runner")?.value !== "yes") {
    for (const pr of processes) if (/\b(build|release|publish|deploy|package)\b/i.test(pr.title)) pr.impossible = "ה-build רץ רק ב-Windows ואין מריץ מחובר";
  }
  await withTenant(ctx.clientId, async (tx) => {
    await tx.delete(onboardingProcess).where(eq(onboardingProcess.runId, ctx.runId));
    if (processes.length) await tx.insert(onboardingProcess).values(processes.map((pr) => ({ runId: ctx.runId, clientId: ctx.clientId, key: pr.key, title: pr.title, source: pr.source, evidence: pr.evidence, steps: pr.steps, trialTaskKey: pr.trialTaskKey, impossible: pr.impossible })));
  });
  const allSteps = processes.flatMap((pr) => pr.steps);
  for (const pr of processes) terminalLine(ctx.runId, `תהליך: ${pr.title} — ${pr.steps.map((s) => `${s.title} → ${s.decision}`).join("; ")}`);
  const result: ProcessesResult = { processes: processes.length, steps: allSteps.length, agents: allSteps.filter((s) => s.decision === "agent").length, skills: allSteps.filter((s) => s.decision === "skill").length, questions: questions.length, answered: answers.filter((a) => !a.assumed).length, assumed: answers.filter((a) => a.assumed).length, costUsd };
  await event(ctx, "onboarding.processes.mapped", result, by.userId);
  await completeStep(ctx, "processes", { ...result, questions, answers }, by.userId);
  await advance(ctx, by);
}

/** A coach run reuses the last finished run's processes and trials: the diagnosis is free and runs again, the rest does not need to. */
async function reuseFromPreviousRun(ctx: Ctx, by: Actor) {
  const [prev] = await withTenant(ctx.clientId, (tx) => tx.select({ id: repositoryOnboardingRun.id }).from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.repoId, ctx.repoId), eq(repositoryOnboardingRun.status, "Completed"), eq(repositoryOnboardingRun.kind, "onboarding"))).orderBy(desc(repositoryOnboardingRun.completedAt)).limit(1));
  if (prev) {
    const src: Ctx = { ...ctx, runId: prev.id };
    const processes = await loadProcesses(src);
    const trials = await loadTrials(src, "baseline");
    await withTenant(ctx.clientId, async (tx) => {
      if (processes.length) await tx.insert(onboardingProcess).values(processes.map((pr) => ({ runId: ctx.runId, clientId: ctx.clientId, key: pr.key, title: pr.title, source: pr.source, evidence: pr.evidence, steps: pr.steps, trialTaskKey: pr.trialTaskKey, impossible: pr.impossible })));
      if (trials.length) await tx.insert(onboardingTrial).values(trials.map((t) => ({ runId: ctx.runId, clientId: ctx.clientId, phase: "baseline", taskKey: t.taskKey, title: t.title_he, prompt: "(reused)", passed: t.passed, failureKind: t.failureKind, detail: t.detail, answer: "", judgedBy: t.judgedBy, costUsd: String(t.costUsd), callId: null })));
    });
  }
  await completeStep(ctx, "processes", { reused: !!prev, from: prev?.id ?? null }, by.userId);
  await completeStep(ctx, "trial", { reused: !!prev, from: prev?.id ?? null }, by.userId);
  await advance(ctx, by);
}

/* ── 3. the measurement — step 4 runs the "without" arm, the build runs the "with" arm ── */

/** The bank's tasks for this run, with the context the graders read and the hints the judge gets. */
async function evalSetup(ctx: Ctx) {
  const p = await requireProfile(ctx);
  const processes = await loadProcesses(ctx);
  const tasks = evalTasksFor(p.profile, processes);
  return { profile: p.profile, processes, tasks, evalCtx: evalContext(p.profile, processes), hints: factsForJudge(p.profile) };
}

/** What a measurement will roughly cost, from what earlier runs averaged (an executor run ~$0.35, a judge with tools ~$0.10). */
const EXECUTOR_RUN_USD = 0.35;
const JUDGE_RUN_USD = 0.1;
export const evalEstimateUsd = (tasks: readonly EvalTask[], arms: number, runs: number) =>
  Math.round((tasks.length * arms * runs * EXECUTOR_RUN_USD + tasks.filter((t) => t.judge).length * arms * runs * JUDGE_RUN_USD) * 100) / 100;
/** The cap the run stops at: the estimate with room for the second pass, never below a few dollars. */
const evalCapUsd = (estimate: number) => Math.max(4, Math.round(estimate * 1.8 * 100) / 100);

async function gateTrial(ctx: Ctx, run: RunRow, by: Actor) {
  if (run.kind === "coach") { await completeStep(ctx, "trial", { reused: true }, by.userId); await advance(ctx, by); return; }
  const { tasks } = await evalSetup(ctx);
  const estimate = evalEstimateUsd(tasks, 1, 1);
  const waiting = { tasks: tasks.map((t) => ({ key: t.key, title_he: t.title_he, kind: t.kind, judge: t.judge ? "model" : "code" })), estimateUsd: estimate, capUsd: evalCapUsd(estimate), arms: ["without"] as EvalArm[], runs: 1 };
  if (normalizeAutomation(run.automation).level === "reversible_auto") { await patchStep(ctx, "trial", { result: waiting }); await runEvalPhase(ctx, run, by, "baseline"); return; }
  await waitStep(ctx, "trial", waiting, by.userId, `המדידה ממתינה לאישור על העלות (~$${estimate.toFixed(2)}, ${tasks.length} משימות, תקרה $${evalCapUsd(estimate)})`);
}

export async function approveTrial(repoId: string, runId: string, by: Actor) {
  const { run, steps, ctx } = await loadRun(repoId, runId);
  if (stepOf(steps, "trial")?.status !== "WaitingForUser") throw new OnboardingError("המדידה לא ממתינה לאישור");
  await patchStep(ctx, "trial", { status: "Running" });
  await patchRun(ctx, { status: "Running" });
  await event(ctx, "onboarding.trial.approved", {}, by.userId);
  void runEvalPhase(ctx, run, by, "baseline").catch((e) => failStep(ctx, "trial", e, by.userId));
  return { approved: true };
}

/**
 * One arm of the measurement, every task, one run each — then a second run of
 * the tasks whose arms disagree once both arms exist. `baseline` is the arm
 * without the delivered set (step 4); `after` is the arm with exactly the
 * files that would be delivered (the build), so what is measured is what ships.
 * Both arms are detached worktrees off the run's copy, loading only the copy's
 * own configuration; every run is a row and an event.
 */
async function runEvalPhase(ctx: Ctx, run: RunRow, by: Actor, phase: TrialPhase): Promise<EvalSummary> {
  if (!run.workspacePath || !run.baselineSha) throw new OnboardingError("אין עותק מבודד");
  const dir = run.workspacePath;
  const { tasks, evalCtx, hints } = await evalSetup(ctx);
  const arm: EvalArm = phase === "baseline" ? "without" : "with";
  const prior = phase === "after" ? (await loadTrials(ctx, "baseline")).map(asEvalRecord) : [];
  await withTenant(ctx.clientId, (tx) => tx.delete(onboardingTrial).where(and(eq(onboardingTrial.runId, ctx.runId), eq(onboardingTrial.phase, phase))));
  const delivered = phase === "after" ? await deliverableFiles(ctx) : [];
  const estimate = evalEstimateUsd(tasks, phase === "after" ? 2 : 1, 1);
  const capUsd = evalCapUsd(estimate);
  terminalLine(ctx.runId, `מדידה ${arm === "without" ? "בלי הסט" : "עם הסט שיימסר"}: ${tasks.length} משימות, אומדן ~$${estimate.toFixed(2)}, תקרה $${capUsd}${phase === "after" ? ` · ${delivered.length} קבצים בזרוע "עם"` : ""}`);
  const res = await runEval({
    ledger: { clientId: ctx.clientId, userId: by.userId, trigger: "button", entity: { kind: "onboarding_run", id: ctx.runId }, screen: "onboarding", meta: { stepKey: phase === "baseline" ? "trial" : "build", phase } },
    sharedDir: dir, baselineSha: run.baselineSha, delivered: { fromDir: dir, files: delivered }, armsRoot: armsRootFor(runtimeDir(ctx.runId)), workDir: runtimeDir(ctx.runId),
    tasks, ctx: evalCtx, hints, runsPerTask: 1, extraRunWhenDiffer: phase === "after", maxUsd: capUsd, arms: [arm], priorRuns: prior,
    render: async (key, vars) => renderPrompt((await requirePrompt(key)).body, vars),
    log: (l) => terminalLine(ctx.runId, l),
    onRun: async (rec) => {
      const task = tasks.find((t) => t.key === rec.taskKey)!;
      const rowPhase: TrialPhase = rec.arm === "without" ? "baseline" : "after";
      await withTenant(ctx.clientId, (tx) => tx.insert(onboardingTrial).values({
        runId: ctx.runId, clientId: ctx.clientId, phase: rowPhase, taskKey: rec.taskKey, title: rec.title_he, prompt: task.prompt, passed: rec.passed, failureKind: rec.failureKind, detail: rec.detail,
        answer: rec.answer ?? "", judgedBy: rec.judgedBy, costUsd: String(rec.costUsd), callId: rec.callId, runIndex: rec.runIndex, numTurns: rec.numTurns, graders: rec.graders, exercises: task.exercises,
      }));
      await event(ctx, "onboarding.trial.task", { phase: rowPhase, arm: rec.arm, runIndex: rec.runIndex, taskKey: rec.taskKey, title: rec.title_he, kind: task.kind, passed: rec.passed, failureKind: rec.failureKind, detail: rec.detail.slice(0, 300), costUsd: rec.costUsd, numTurns: rec.numTurns, judgedBy: rec.judgedBy, graders: rec.graders.filter((g) => !g.skipped).map((g) => ({ type: g.type, passed: g.passed })) }, by.userId);
    },
  });
  if (res.stoppedAtCap) await event(ctx, "onboarding.trial.stopped_at_cap", { phase, capUsd, spentUsd: res.spentUsd, runs: res.runs.length }, by.userId);
  if (phase === "baseline") {
    const mine = res.runs;
    const result: TrialResult = { phase, tasks: tasks.length, passed: res.summary.tasks.filter((t) => t.without.passK).length, costUsd: res.spentUsd, byKind: byKind(mine.map((r) => ({ ...r, phase: "baseline" as const }))), runs: 1, stoppedAtCap: res.stoppedAtCap };
    await completeStep(ctx, "trial", result, by.userId);
    await advance(ctx, by);
  }
  return res.summary;
}

/* ── 4. the plan: cards from every source ─────────────────────────── */

async function marketplaceSeeds(ctx: Ctx, run: RunRow, by: Actor, profile: RepoProfile): Promise<{ seeds: ComponentSeed[]; found: number; remembered: number; searched: boolean; skipped: string | null; costUsd: number }> {
  const tags = stackTags(profile);
  const remembered = await rememberedFor(tags);
  const level = normalizeAutomation(run.automation).level;
  const toSearch = tagsToSearch(tags, remembered);
  let searched = false;
  let skipped: string | null = null;
  let found = 0;
  let costUsd = 0;
  const sources: RememberedSource[] = [...remembered];
  if (level === "locked") skipped = "המדרגה נעולה — חיפוש פתוח ברשת לא רץ בלי אישור";
  else if (!toSearch.length) skipped = "כל תגיות הסטאק כבר מוכרות מהזיכרון";
  else {
    try {
      const known = remembered.map((r) => `${r.name} (${r.kind}) ${r.url}`).join("; ") || "(nothing yet)";
      const res = await callModel(ctx, "onboarding.marketplace", { STACK: toSearch.join(", "), PROFILE_SUMMARY: profileSummary(profile), KNOWN: known }, { capability: "onboarding_marketplace", label: `חיפוש רכיבים מוכנים: ${toSearch.slice(0, 4).join(", ")}`, stepKey: "plan", by: by.userId, cwd: runtimeDir(ctx.runId), tools: "WebSearch,WebFetch", maxTurns: 30, timeoutMs: 600_000 });
      costUsd = res.costUsd;
      searched = true;
      for (const s of parseSources(res.text)) {
        const page = s.kind === "mcp" ? fetchPage(s.url) : null;
        const { trust, checks } = checkTrust(s, page);
        const row = await rememberSource({ ...s, tags: [...new Set([...s.tags, ...toSearch.filter((t) => (s.tags.join(" ") + s.name + (s.description ?? "")).toLowerCase().includes(t.split("-")[0]!))])] }, trust, checks);
        if (!sources.some((x) => x.id === row.id)) sources.push(row);
        found++;
        await event(ctx, "onboarding.marketplace.found", { kind: s.kind, name: s.name, url: s.url, publisher: s.publisher, trust, suspicious: checks.suspicious.length }, by.userId);
        terminalLine(ctx.runId, `  מקור: ${s.name} (${s.kind}) — ${trust}${checks.suspicious.length ? " ⚠ תיאורים חשודים" : ""}`);
      }
    } catch (e) {
      skipped = `החיפוש נכשל: ${(e as Error).message.slice(0, 120)}`;
      terminalLine(ctx.runId, skipped);
    }
  }
  const seeds: ComponentSeed[] = [];
  for (const r of sources) {
    const matched = (r.tags as string[]).filter((t) => tags.includes(t));
    if (!matched.length) continue;
    seeds.push(seedFromSource(r, r.description ?? "", matched));
  }
  return { seeds, found, remembered: remembered.length, searched, skipped, costUsd };
}

async function reviewerSeeds(ctx: Ctx, run: RunRow, by: Actor, profile: RepoProfile, processes: DiscoveredProcess[], trials: TrialOutcome[], seeds: ComponentSeed[]): Promise<{ seeds: ComponentSeed[]; redundant: { key: string; why: string }[]; costUsd: number } | null> {
  try {
    const res = await callModel(ctx, "onboarding.review", {
      REPO_NAME: ctx.repoName, PROFILE_SUMMARY: profileSummary(profile), PROCESSES: renderProcesses(processes), TRIALS: renderTrials(trials),
      COMPONENTS: seeds.map((s) => `- [${s.key}] ${s.kind} · ${s.title_he} — ${s.why_he}${s.notRecommended ? " (not recommended here)" : ""}`).join("\n"),
    }, { capability: "onboarding_review", label: "הסוקר: מה חסר ומה מיותר", stepKey: "plan", by: by.userId, cwd: run.workspacePath!, lean: true, timeoutMs: 240_000 });
    const start = res.text.indexOf("{");
    const o = JSON.parse(res.text.slice(start, res.text.lastIndexOf("}") + 1)) as { missing?: { kind?: string; title?: string; why?: string; processKey?: string | null; stepKey?: string | null; slug?: string | null }[]; redundant?: { key?: string; why?: string }[] };
    const kinds = new Set<string>(["rule", "hook", "permission", "skill", "agent", "mcp", "plugin", "lsp", "scaffold", "doc", "script"]);
    const slugOf = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
    const out: ComponentSeed[] = (o.missing ?? []).filter((m) => m?.title && kinds.has(String(m.kind))).slice(0, 6).map((m, i) => {
      const kind = m.kind as ComponentSeed["kind"];
      // The file name comes from stable keys, never from a title: the process and step the reviewer named, or its own slug.
      const processKey = m.processKey && processes.some((p) => p.key === m.processKey) ? m.processKey : null;
      const stepKey = processKey ? processes.find((p) => p.key === processKey)!.steps.find((s) => s.key === m.stepKey)?.key ?? null : null;
      const slug = slugOf(m.slug) || slugOf(m.title) || `${i + 1}`;
      return { key: `reviewer_${slug}_${kind}`.slice(0, 60), kind, family: familyOf(kind), risk: kind === "mcp" ? "external" : kind === "rule" || kind === "doc" || kind === "permission" ? "reversible" : "significant", source: "reviewer", sourceRef: "onboarding.review", title_he: String(m.title).slice(0, 120), why_he: `הסוקר: ${String(m.why ?? "").slice(0, 400)}`, what_he: `${KIND_HE[kind]} שהסוקר הצביע עליו כחסר; נבנה כמו כל רכיב אם יאושר.`, verifyHow_he: "לפי הסוג, כמו כל רכיב.", params: { template: kind === "skill" ? "process-skill" : kind === "agent" ? "process-agent" : undefined, text: kind === "rule" ? String(m.title) : undefined, fromReviewer: true, process: processKey ?? "reviewer", step: stepKey ?? slug, stepTitle: String(m.title).slice(0, 120) } };
    });
    return { seeds: out, redundant: (o.redundant ?? []).filter((r) => r?.key).map((r) => ({ key: String(r.key), why: String(r.why ?? "") })), costUsd: res.costUsd };
  } catch (e) {
    terminalLine(ctx.runId, `הסוקר לא ענה (${(e as Error).message.slice(0, 100)})`);
    return null;
  }
}

async function upsertCards(ctx: Ctx, cards: readonly Component[], keepDecisions: boolean) {
  const existing = keepDecisions ? await loadCards(ctx) : [];
  await withTenant(ctx.clientId, async (tx) => {
    const keep = new Set(cards.map((c) => c.key));
    if (!cards.length) await tx.delete(onboardingComponent).where(eq(onboardingComponent.runId, ctx.runId));
    else await tx.delete(onboardingComponent).where(and(eq(onboardingComponent.runId, ctx.runId), sql`${onboardingComponent.key} not in (${sql.join(cards.map((c) => sql`${c.key}`), sql`, `)})`));
    for (const c of cards) {
      const prev = existing.find((e) => e.key === c.key);
      const decided = prev && prev.status !== "proposed" && prev.decidedBy ? { status: prev.status, decidedBy: prev.decidedBy, decidedAt: prev.decidedAt ? new Date(prev.decidedAt) : null, declineReason: prev.declineReason, questions: prev.questions } : {};
      const values = { runId: ctx.runId, clientId: ctx.clientId, key: c.key, kind: c.kind, family: c.family, title: c.title_he, why: c.why_he, what: c.what_he, source: c.source, sourceRef: c.sourceRef, group: c.group, risk: c.risk, contextTokens: c.contextTokens, verifyHow: c.verifyHow_he, status: c.status, params: c.params, files: c.files, validation: c.validation, delta: c.delta, questions: c.questions, decidedBy: c.decidedBy, decidedAt: c.decidedAt ? new Date(c.decidedAt) : null, declineReason: c.declineReason, ...decided, updatedAt: new Date() };
      if (prev) await tx.update(onboardingComponent).set(values).where(eq(onboardingComponent.id, prev.id));
      else await tx.insert(onboardingComponent).values(values);
      keep.delete(c.key);
    }
  });
}

type PlanExtras = { firings: RuleFiring[]; suppressed: RuleSuppression[]; redundant: { key: string; why: string }[] };

async function runPlan(ctx: Ctx, run: RunRow, by: Actor) {
  const p = await requireProfile(ctx);
  const level = normalizeAutomation(run.automation).level;
  const processes = await loadProcesses(ctx);
  const trials = await loadTrials(ctx, "baseline");
  let costUsd = 0;
  let seeds: ComponentSeed[];
  let rules = { fired: [] as RuleFiring[], suppressed: [] as RuleSuppression[] };
  let market = { seeds: [] as ComponentSeed[], found: 0, remembered: 0, searched: false, skipped: null as string | null, costUsd: 0 };
  let review: Awaited<ReturnType<typeof reviewerSeeds>> = null;
  if (run.kind === "coach") {
    seeds = await coachSeeds(ctx);
  } else {
    rules = applyRules(p.profile, p.corrections);
    for (const f of rules.fired) terminalLine(ctx.runId, `כלל ${f.rule}: ${f.reason_he}`);
    for (const s of rules.suppressed) terminalLine(ctx.runId, `כלל ${s.rule} לא הופעל — סימנת את "${s.fact}" כלא נכון`);
    const fromRules = rules.fired.flatMap((f) => f.components);
    const fromProcesses = seedsFromProcesses(processes);
    const fromTrials = seedsFromTrials(trials, [...fromRules, ...fromProcesses]);
    market = await marketplaceSeeds(ctx, run, by, p.profile);
    costUsd += market.costUsd;
    seeds = mergeSeeds(fromRules, fromProcesses, fromTrials, market.seeds);
    review = await reviewerSeeds(ctx, run, by, p.profile, processes, trials, seeds);
    if (review) { costUsd += review.costUsd; seeds = mergeSeeds(seeds, review.seeds); }
  }
  const cards = seeds.map((s) => cardFromSeed(s, level));
  if (run.kind === "coach") for (const c of cards) if (c.status === "proposed") c.status = "approved";
  for (const r of review?.redundant ?? []) { const c = cards.find((x) => x.key === r.key); if (c) c.why_he = `${c.why_he} הסוקר: ייתכן שמיותר — ${r.why}`; }
  await upsertCards(ctx, cards, true);
  const byGroup = { auto: cards.filter((c) => c.group === "auto").length, approval: cards.filter((c) => c.group === "approval").length, not_recommended: cards.filter((c) => c.group === "not_recommended").length };
  // The cards are drawn now but decided only after the /init draft (a person's choice) was set aside and scanned — so the scan's verdicts reach the cards before anyone approves them.
  const { tasks } = await evalSetup(ctx);
  const phase: PlanPhase = run.kind === "coach" ? "decide" : "draft";
  const result: PlanResult & PlanExtras = {
    rulesFired: rules.fired.map((f) => f.rule), rulesSuppressed: rules.suppressed.map((s) => ({ rule: s.rule, fact: s.fact })), components: cards.length, byGroup,
    marketplace: { searched: market.searched, found: market.found, remembered: market.remembered, skipped: market.skipped }, reviewer: review ? { missing: review.seeds.length, redundant: review.redundant.length } : null, costUsd,
    firings: rules.fired, suppressed: rules.suppressed, redundant: review?.redundant ?? [],
    phase, buildEstimateUsd: evalEstimateUsd(tasks, 2, 1) + Math.round(cards.filter((c) => ["skill", "agent", "doc", "scaffold"].includes(c.kind) && c.group !== "not_recommended").length * 0.3 * 100) / 100,
  };
  await event(ctx, "onboarding.plan.drawn", { rulesFired: result.rulesFired, components: cards.length, byGroup, marketplace: result.marketplace, reviewer: result.reviewer, phase }, by.userId);
  if (run.kind === "coach") { await completeStep(ctx, "plan", result, by.userId); await advance(ctx, by); return; }
  await waitStep(ctx, "plan", result, by.userId, `התוכנית מוכנה (${cards.length} כרטיסים). קודם — טיוטת /init אם רוצים, ואז ההחלטות`);
}

/** The plan step's phase as it is now; a run made before phases existed is at "decide". */
async function planPhase(ctx: Ctx): Promise<{ status: StepStatus | null; phase: PlanPhase }> {
  const { steps } = await loadRun(ctx.repoId, ctx.runId);
  const plan = stepOf(steps, "plan");
  return { status: (plan?.status as StepStatus) ?? null, phase: ((plan?.result as PlanResult | null)?.phase ?? "decide") };
}

/** "בלי טיוטה": straight to the decisions. */
export async function skipDraft(repoId: string, runId: string, by: Actor) {
  const { run, ctx } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה הסתיימה");
  const { status, phase } = await planPhase(ctx);
  if (status !== "WaitingForUser") throw new OnboardingError("התוכנית לא ממתינה");
  if (phase !== "draft") return { phase };
  if (terminalState(runId) === "live") throw new OnboardingError("סשן הטיוטה עוד פעיל — סגרו אותו, ואז הוא ייסרק ותגיעו להחלטות");
  await mergePlanResult(ctx, { phase: "decide" });
  await event(ctx, "onboarding.plan.phase", { phase: "decide", why: "skipped_draft" }, by.userId);
  terminalLine(runId, "בלי טיוטת /init — הכרטיסים פתוחים להחלטה");
  return { phase: "decide" as PlanPhase };
}

/**
 * When the draft session ends (the person closed it, or the cap did): the draft is set aside, scanned against the
 * clean copy, its verdicts applied to the cards — and only then do the cards open for decision. The start of a build
 * never overlaps this: both hold `planBusy`.
 */
async function afterDraft(ctx: Ctx, by: string) {
  const { run } = await loadRun(ctx.repoId, ctx.runId);
  const { status, phase } = await planPhase(ctx);
  if (status !== "WaitingForUser" || phase !== "draft" || planBusy.has(ctx.runId)) return;
  planBusy.add(ctx.runId);
  try {
    await mergePlanResult(ctx, { phase: "aside" });
    const draft = await draftOf(run);
    await setDraftAside(ctx, { userId: by });
    if (draft.length) {
      await mergePlanResult(ctx, { phase: "scan" });
      await beginScan(ctx, by, draft.map((f) => f.path));
      try { await runInitScan(ctx, run, { userId: by }, draft); }
      catch (e) { await failInitScan(ctx, by, (e as Error).message.slice(0, 300)); }
    } else terminalLine(ctx.runId, "סשן הטיוטה לא כתב כלום — אין מה לסרוק");
    await mergePlanResult(ctx, { phase: "decide" });
    await event(ctx, "onboarding.plan.phase", { phase: "decide", why: draft.length ? "draft_scanned" : "draft_empty" }, by);
  } catch (e) {
    await mergePlanResult(ctx, { phase: "decide" });
    await event(ctx, "onboarding.plan.phase", { phase: "decide", why: `after_draft_failed: ${(e as Error).message.slice(0, 200)}` }, by);
  } finally {
    planBusy.delete(ctx.runId);
  }
}
setAfterDraftEnded(async (d, by) => afterDraft({ repoId: d.repoId, runId: d.runId, clientId: d.clientId, repoName: "", triggeredBy: d.triggeredBy }, by ?? d.triggeredBy));

/** After a correction while the plan waits: the rules run again; decisions already taken on cards that still exist are kept. */
async function replan(ctx: Ctx, by: Actor, why: string) {
  const { run, steps } = await loadRun(ctx.repoId, ctx.runId);
  const plan = stepOf(steps, "plan");
  if (plan?.status !== "WaitingForUser") return;
  const p = await requireProfile(ctx);
  const level = normalizeAutomation(run.automation).level;
  const rules = applyRules(p.profile, p.corrections);
  const existing = await loadCards(ctx);
  const nonRule = existing.filter((c) => c.source !== "rule");
  const cards = [...rules.fired.flatMap((f) => f.components).map((s) => cardFromSeed(s, level)), ...nonRule];
  await upsertCards(ctx, cards, true);
  const byGroup = { auto: cards.filter((c) => c.group === "auto").length, approval: cards.filter((c) => c.group === "approval").length, not_recommended: cards.filter((c) => c.group === "not_recommended").length };
  await mergePlanResult(ctx, { rulesFired: rules.fired.map((f) => f.rule), rulesSuppressed: rules.suppressed.map((s) => ({ rule: s.rule, fact: s.fact })), firings: rules.fired, suppressed: rules.suppressed, components: cards.length, byGroup });
  await event(ctx, "onboarding.plan.redrawn", { why, rulesFired: rules.fired.map((f) => f.rule), suppressed: rules.suppressed }, by.userId);
}

/** The seeds of a coach run: the approved proposals' components. */
async function coachSeeds(ctx: Ctx): Promise<ComponentSeed[]> {
  const rows = await withTenant(ctx.clientId, (tx) => tx.select().from(repoCoachProposal).where(eq(repoCoachProposal.runId, ctx.runId)));
  return rows.map((r) => {
    const ev = (r.evidence ?? {}) as { seed?: ComponentSeed };
    if (ev.seed) return { ...ev.seed, source: "coach", sourceRef: r.id };
    return { key: (r.componentKey ?? `coach_${r.id.slice(0, 8)}`).slice(0, 60), kind: "rule", family: "knowledge", risk: "reversible", source: "coach", sourceRef: r.id, title_he: r.title, why_he: r.why, what_he: "שורת הנחיה מהצעת המאמן.", verifyHow_he: "נטענת בכל סשן.", params: { text: r.title } };
  });
}

/* ── decisions on the cards ───────────────────────────────────────── */

export async function decideComponent(repoId: string, runId: string, by: Actor, input: { key: string; decision: "approve" | "decline" | "defer" | "undo"; reason?: string | null; answers?: Record<string, string> }) {
  const { run, steps, ctx } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה הסתיימה");
  if (stepOf(steps, "plan")?.status !== "WaitingForUser") throw new OnboardingError("התוכנית לא ממתינה להחלטות");
  const cards = await loadCards(ctx);
  const c = cards.find((x) => x.key === input.key);
  if (!c) throw new OnboardingError("הכרטיס לא נמצא");
  if (c.kind === "report") throw new OnboardingError("דיווח לא מאשרים ולא דוחים — הוא מידע");
  const questions = c.questions.map((q) => ({ ...q, answer: input.answers?.[q.key]?.trim() || q.answer }));
  const status: Component["status"] = input.decision === "approve" ? "approved" : input.decision === "decline" ? "declined" : input.decision === "defer" ? "deferred" : "proposed";
  await withTenant(ctx.clientId, (tx) => tx.update(onboardingComponent).set({ status, questions, decidedBy: input.decision === "undo" ? null : by.userId, decidedAt: input.decision === "undo" ? null : new Date(), declineReason: input.decision === "decline" ? input.reason?.trim() || null : null, updatedAt: new Date() }).where(eq(onboardingComponent.id, c.id)));
  await event(ctx, "onboarding.card.decided", { key: c.key, title: c.title_he, decision: input.decision, reason: input.reason ?? null }, by.userId);
  return { key: c.key, status };
}

/** Approve as a set: every card still waiting in the approval group (or the named keys). */
export async function decideComponentSet(repoId: string, runId: string, by: Actor, input: { keys?: string[]; decision: "approve" | "decline"; reason?: string | null }) {
  const { run, steps, ctx } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה הסתיימה");
  if (stepOf(steps, "plan")?.status !== "WaitingForUser") throw new OnboardingError("התוכנית לא ממתינה להחלטות");
  // A question only a person decides (the scan's "ask": a permission, a policy) is never answered as part of a set.
  const cards = (await loadCards(ctx)).filter((c) => c.status === "proposed" && c.kind !== "report" && (input.keys ? input.keys.includes(c.key) : c.params.decision !== "ask"));
  const status = input.decision === "approve" ? "approved" : "declined";
  for (const c of cards) await withTenant(ctx.clientId, (tx) => tx.update(onboardingComponent).set({ status, decidedBy: by.userId, decidedAt: new Date(), declineReason: input.decision === "decline" ? input.reason?.trim() || null : null, updatedAt: new Date() }).where(eq(onboardingComponent.id, c.id)));
  await event(ctx, "onboarding.cards.decided_set", { decision: input.decision, keys: cards.map((c) => c.key) }, by.userId);
  return { decided: cards.length };
}

/** "תכין skill לתהליך X" — a person's request becomes a card with at most three questions, built and verified like every other card. */
export async function requestComponent(repoId: string, runId: string, by: Actor, input: { text: string }) {
  const { run, steps, ctx } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה הסתיימה");
  const plan = stepOf(steps, "plan");
  if (plan?.status !== "WaitingForUser") throw new OnboardingError("בקשה לרכיב אפשרית כשהתוכנית פתוחה לאישור");
  const text = input.text.trim();
  if (!text) throw new OnboardingError("כתבו מה הרכיב צריך לעשות");
  const p = await requireProfile(ctx);
  const processes = await loadProcesses(ctx);
  const res = await callModel(ctx, "onboarding.request", { REPO_NAME: ctx.repoName, REQUEST: text.slice(0, 2000), PROFILE_SUMMARY: profileSummary(p.profile), PROCESSES: renderProcesses(processes) }, { capability: "onboarding_processes", label: `בקשה לרכיב: ${text.slice(0, 60)}`, stepKey: "plan", by: by.userId, cwd: run.workspacePath!, lean: true, timeoutMs: 120_000 });
  const start = res.text.indexOf("{");
  let o: { kind?: string; title?: string; what?: string; questions?: { key?: string; question_he?: string; default?: string }[] } = {};
  try { o = JSON.parse(res.text.slice(start, res.text.lastIndexOf("}") + 1)) as typeof o; } catch { /* handled below */ }
  const kind = (["skill", "agent", "hook", "rule", "doc", "mcp"] as const).find((k) => k === o.kind) ?? "skill";
  const title = String(o.title ?? text.slice(0, 80)).slice(0, 120);
  const questions: ClarifyingQuestion[] = (o.questions ?? []).filter((q) => q?.question_he).slice(0, 3).map((q, i) => ({ key: String(q.key ?? `q${i + 1}`).slice(0, 40), question_he: String(q.question_he).slice(0, 300), default: String(q.default ?? "").slice(0, 200), answer: null }));
  const seed: ComponentSeed = {
    key: `user_${Date.now().toString(36)}_${kind}`, kind, family: familyOf(kind), risk: kind === "mcp" ? "external" : kind === "rule" || kind === "doc" ? "reversible" : "significant", source: "user", sourceRef: by.userId,
    title_he: title, why_he: `ביקשת: "${text.slice(0, 300)}"`, what_he: String(o.what ?? "").slice(0, 400) || `${KIND_HE[kind]} לפי הבקשה.`, verifyHow_he: "נבנה ומאומת כמו כל רכיב; אתה מחליט אם עזר.",
    params: { template: kind === "skill" ? "process-skill" : kind === "agent" ? "process-agent" : undefined, text: kind === "rule" ? title : undefined, request: text, what: o.what ?? "", stepTitle: title }, questions,
  };
  const card = cardFromSeed(seed, normalizeAutomation(run.automation).level);
  card.group = "approval";
  card.status = "proposed";
  const existing = await loadCards(ctx);
  await upsertCards(ctx, [...existing, card], true);
  await event(ctx, "onboarding.card.requested", { key: card.key, kind, title, questions: questions.length, costUsd: res.costUsd }, by.userId);
  return { key: card.key, kind, title, questions };
}

/* ── the scan of the /init draft: what to take, merge, or leave out ─── */

/** The draft as it is now in the copy: the files the session wrote, and the changed files where instructions live, before and after. */
async function draftOf(run: RunRow): Promise<DraftFile[]> {
  if (!run.workspacePath || !run.baselineSha) return [];
  const s = sessionOf(run);
  const written = s.transcriptPath ? writtenPaths(s.transcriptPath, run.workspacePath) : [];
  const paths = draftPaths(written, await changedFiles(run.workspacePath, run.baselineSha));
  const out: DraftFile[] = [];
  for (const p of paths) {
    const v = await fileVersions(run.workspacePath, run.baselineSha, p).catch(() => null);
    if (!v || v.binary || v.tooLarge || v.before?.trimEnd() === v.after?.trimEnd()) continue;
    out.push({ path: p, before: v.before, after: v.after });
  }
  return out;
}

/** Keys of the plan step's result set in one statement, the rest left as they are — so a scan and a replan never write back each other's stale copy. */
const mergePlanResult = (ctx: Ctx, patch: Record<string, unknown>) =>
  withTenant(ctx.clientId, (tx) => tx.update(repositoryOnboardingStep)
    .set({ result: sql`coalesce(${repositoryOnboardingStep.result}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
    .where(and(eq(repositoryOnboardingStep.runId, ctx.runId), eq(repositoryOnboardingStep.stepKey, "plan"))));

/** The scan's state lives in the plan step's result, next to the rest of the plan — the screen polls it. */
const patchInitScan = (ctx: Ctx, scan: InitScanState) => mergePlanResult(ctx, { initScan: scan });

/** A failed scan keeps the last one's result beside the error, so the cards on the screen still have their reasons. */
async function failInitScan(ctx: Ctx, by: string | null, error: string, reason?: string) {
  const { steps } = await loadRun(ctx.repoId, ctx.runId);
  const prev = ((stepOf(steps, "plan")?.result ?? {}) as { initScan?: InitScanState }).initScan;
  await patchInitScan(ctx, { ...(prev?.verdict ? prev : { startedAt: prev?.startedAt ?? new Date().toISOString(), by: by ?? "", files: prev?.files ?? [] }), state: "failed", error, failedAt: new Date().toISOString() } as InitScanState);
  await event(ctx, "onboarding.draft.scan_failed", { error, reason: reason ?? null }, by);
  terminalLine(ctx.runId, `✗ סריקת טיוטת /init נכשלה: ${error}`);
}

/** One of the two things that change the plan's cards from the draft at a time: the scan, or the start of the build. */
const planBusy = new Set<string>();

/** "סרוק מה ש-/init עשה": the editor runs in the background (minutes, it reads the code to check claims); the screen follows its state. */
export async function scanInitDraft(repoId: string, runId: string, by: Actor) {
  const { run, steps, ctx } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה הסתיימה");
  if (stepOf(steps, "plan")?.status !== "WaitingForUser") throw new OnboardingError("סריקת הטיוטה אפשרית כשהתוכנית פתוחה לאישור");
  if (!run.workspacePath || !run.baselineSha) throw new OnboardingError("אין עותק מבודד");
  if (planBusy.has(runId)) throw new OnboardingError("סריקה של הטיוטה או תחילת בנייה כבר רצות בהרצה הזו");
  planBusy.add(runId);
  let files: string[];
  try {
    const s = sessionOf(run);
    if (terminalState(runId) === "live" && s.transcriptPath && !sessionIdle(s.transcriptPath).idle) throw new OnboardingError("סשן הטיוטה עוד עובד — חכו שיסיים את התור (או עצרו אותו) ואז סרקו");
    const draft = await draftOf(run);
    if (!draft.length) throw new OnboardingError("סשן הטיוטה עוד לא כתב כלום בעותק — אין מה לסרוק");
    files = draft.map((f) => f.path);
    await beginScan(ctx, by.userId, files);
    void runInitScan(ctx, run, by, draft)
      .catch((e) => failInitScan(ctx, by.userId, (e as Error).message.slice(0, 300)).catch((x) => console.error("[onboarding] a failed scan could not be recorded:", x)))
      .finally(() => planBusy.delete(runId));
  } catch (e) {
    planBusy.delete(runId);
    throw e;
  }
  return { scanning: true, files: files.length };
}

/** The scan's "running" state and its event — the same whether a person pressed the button or the session ending started it. */
async function beginScan(ctx: Ctx, by: string, files: string[]) {
  const { steps } = await loadRun(ctx.repoId, ctx.runId);
  const prev = ((stepOf(steps, "plan")?.result ?? {}) as { initScan?: InitScanState }).initScan;
  await patchInitScan(ctx, { ...(prev?.verdict ? prev : {}), state: "running", startedAt: new Date().toISOString(), by, files, error: undefined, failedAt: undefined });
  await event(ctx, "onboarding.draft.scan_started", { files }, by);
  terminalLine(ctx.runId, `סריקת טיוטת /init: ${files.length} קבצים — ${files.slice(0, 6).join(", ")}`);
}

async function runInitScan(ctx: Ctx, run: RunRow, by: Actor, draft: DraftFile[]) {
  const dir = run.workspacePath!;
  const startedAt = new Date().toISOString();
  const p = await requireProfile(ctx);
  const processes = await loadProcesses(ctx);
  const trials = await loadTrials(ctx, "baseline");
  const cards = await loadCards(ctx);
  const ours = cards.filter((c) => c.source !== "init");
  const earlier = cards.filter((c) => c.source === "init" && c.status !== "proposed");
  const { steps } = await loadRun(ctx.repoId, ctx.runId);
  const interview = (stepOf(steps, "processes")?.result ?? {}) as { questions?: InterviewQuestion[]; answers?: InterviewAnswer[] };
  const said = (await runEvents(ctx)).filter((e) => e.type === "onboarding.session.answer").map((e) => { const q = e.payload as { question?: string; answer?: string }; return `- ${q.question ?? ""} → ${q.answer ?? ""}`; });
  const res = await callModel(ctx, "onboarding.init_scan", {
    REPO_NAME: ctx.repoName, PROFILE_SUMMARY: profileSummary(p.profile),
    FACTS: profileFacts(p.profile, p.corrections).map((f) => `- ${f.label_he}: ${f.value_he}${f.corrected ? " (marked wrong by a person)" : ""}`).join("\n"),
    INTERVIEW: renderInterview(interview.questions ?? [], interview.answers ?? []), PROCESSES: renderProcesses(processes), TRIALS: renderTrials(trials),
    SESSION_ANSWERS: said.length ? said.join("\n") : "(the person answered no question in the session)",
    OURS_AGENTS: previewAgentsMd(dir, p.profile, ctx.repoName, cards),
    OUR_CARDS: [
      ...ours.map((c) => `- [${c.key}] ${c.kind} · ${c.status} · ${c.title_he} — ${c.why_he.slice(0, 280)}${c.kind === "rule" && c.params.text ? ` — the line: "${String(c.params.text).slice(0, 300)}"` : ""}`),
      // What an earlier scan already took and a person decided: not to be proposed again; a better text names it in "replaces".
      ...earlier.map((c) => `- [${c.key}] ${c.kind} · ${c.status} · taken from the draft by an earlier scan · ${c.title_he} — the text: "${String(c.params.text ?? "").slice(0, 400)}"`),
    ].join("\n") || "(no cards)",
    DRAFT: `The isolated copy of the repository, to read with Read, Grep and Glob: ${dir}\n\n${renderDraft(draft)}`,
  }, { capability: "onboarding_init_scan", label: "סריקת טיוטת /init", stepKey: "plan", by: by.userId, cwd: dir, lean: true, leanTools: "Read,Grep,Glob", addDirs: [dir], think: true, maxTurns: 40, timeoutMs: 900_000 });
  const scan = parseInitScan(res.text);
  const f = repoFacts(p.profile, ctx.repoName, null);
  const knownCommands = [...p.profile.build.commands, ...p.profile.ci.commands, f.testCommand ?? "", f.lintCommand ?? ""].filter(Boolean);
  const inBase = new Set<string>();
  for (const it of scan.items) if (it.form === "file" && (await git(["cat-file", "-e", `${run.baselineSha}:${it.target.replace(/^\.\//, "")}`], dir)).code === 0) inBase.add(it.target.replace(/^\.\//, ""));
  // The call takes minutes; a person may have decided, asked for a card or corrected a fact meanwhile — write against the cards as they are now.
  const now = await loadCards(ctx);
  const oursNow = now.filter((c) => c.source !== "init");
  const { seeds, refused } = seedsFromScan({ scan, dir, knownCommands, ours: now, inBaseline: (x) => inBase.has(x) });
  // What the scan takes always waits for a person, whatever the automation level.
  const level = normalizeAutomation(run.automation).level;
  const taken = seeds.map((sd) => { const c = cardFromSeed(sd, level); if (c.group !== "not_recommended") { c.group = "approval"; c.status = "proposed"; } return c; });
  // A card of an earlier scan that a person already decided on stays; an undecided one is replaced by this scan.
  const kept = now.filter((c) => c.source === "init" && c.decidedBy && !taken.some((t) => t.key === c.key));
  const removed = now.filter((c) => c.source === "init" && !c.decidedBy && !taken.some((t) => t.key === c.key)).map((c) => c.key);
  const stays = [...oursNow, ...kept];
  const drop = new Map(scan.dropOurs.filter((d) => stays.some((c) => c.key === d.key)).map((d) => [d.key, d.why]));
  // A card of ours the scan found redundant is DECLINED, with the reason and an undo — not annotated for a person to notice
  // (in the Trade run the six "redundant" cards were approved as a set an hour before the scan, and all were built).
  // A decision a person already took stands.
  const now2 = new Date().toISOString();
  const noted = stays.map((c) => {
    const why = drop.get(c.key) ?? null;
    if (why && !c.decidedBy && c.status === "proposed") return { ...c, status: "declined" as const, declineReason: `הסריקה: ${why.slice(0, 300)}`, decidedBy: ctx.triggeredBy, decidedAt: now2, params: { ...c.params, declinedBy: "scan" } };
    return { ...c, why_he: withScanNote(c.why_he, why) };
  });
  const applied = noted.filter((c) => (c.params as { declinedBy?: string }).declinedBy === "scan" && !stays.find((s) => s.key === c.key)?.decidedBy).map((c) => c.key);
  await upsertCards(ctx, [...noted, ...taken], true);
  if (applied.length) await event(ctx, "onboarding.draft.scan_applied", { declined: applied }, by.userId);
  const done: InitScanState = {
    state: "done", startedAt, finishedAt: new Date().toISOString(), by: by.userId, files: draft.map((d) => d.path),
    verdict: scan.verdict, summary: scan.summary, compare: scan.compare,
    cards: taken.map((c) => ({ key: c.key, title: c.title_he, decision: String(c.params.decision ?? "take"), notRecommended: c.group === "not_recommended" })),
    dropOurs: [...drop].map(([key, why]) => ({ key, title: stays.find((c) => c.key === key)!.title_he, why })), reject: scan.reject, refused, costUsd: res.costUsd,
  };
  await patchInitScan(ctx, done);
  await event(ctx, "onboarding.draft.scanned", {
    verdict: scan.verdict, cards: taken.length, asks: taken.filter((c) => c.params.decision === "ask").length, dropOurs: drop.size, rejected: scan.reject.length + refused.length, costUsd: res.costUsd,
    created: taken.map((c) => c.key), removed, noted: [...drop.keys()],
  }, by.userId);
  terminalLine(ctx.runId, `סריקת טיוטת /init: ${VERDICT_HE[scan.verdict]} · ${taken.length} כרטיסים חדשים לאישור · ${applied.length} משלנו נדחו כמיותרים (אפשר לבטל) · ${scan.reject.length + refused.length} לא נלקחו`);
}

const VERDICT_HE: Record<InitScan["verdict"], string> = { adopt: "הטיוטה טובה יותר — לוקחים את רובה", merge: "משלבים את שתיהן", partial: "שלנו הבסיס, תוספות מהטיוטה", keep_ours: "נשארים עם שלנו" };

/**
 * Before the build writes anything, the copy goes back to where the run started: nothing but DCC's own `.dcc/`
 * differs from the baseline before the build, so every difference is the draft — what the session wrote with any
 * tool, committed or not. Commits the session made are undone first (their changes stay in the files), every
 * changed file is kept under the run's runtime folder, and each is put back to the baseline or removed. So what
 * the session wrote reaches the pull request only through a card a person approved. Recorded; nothing is lost.
 */
async function setDraftAside(ctx: Ctx, by: Actor): Promise<string[]> {
  const { run } = await loadRun(ctx.repoId, ctx.runId);
  const dir = run.workspacePath;
  const base = run.baselineSha;
  if (!dir || !base) return [];
  // stdout alone: a warning git prints on stderr (line endings on Windows) must not become a file name.
  const g = async (args: string[], what: string) => {
    try {
      const r = await execFileAsync("git", ["-c", "core.longpaths=true", "-c", "core.quotepath=off", "--literal-pathspecs", ...args], { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
      return r.stdout;
    } catch (e) {
      throw new OnboardingError(`לא ניתן להזיז את טיוטת /init הצידה (${what}): ${String((e as { stderr?: string }).stderr || (e as Error).message).slice(0, 200)}`);
    }
  };
  const nul = (out: string) => out.split("\0").map((x) => x.trim()).filter(Boolean);
  const commits = (await g(["rev-list", `${base}..HEAD`], "רשימת ה-commits")).split("\n").map((x) => x.trim()).filter(Boolean);
  const changed = new Map<string, string>();
  const status = nul(await g(["diff", "--name-status", "--no-renames", "-z", base], "מה השתנה"));
  for (let i = 0; i + 1 < status.length; i += 2) changed.set(status[i + 1]!, status[i]!);
  for (const p of nul(await g(["ls-files", "--others", "--exclude-standard", "-z"], "קבצים חדשים"))) changed.set(p, "?");
  // Ignored files too: what a session built or installed (bin/obj of a test project, node_modules) is not in the baseline
  // either, and left behind it misled the next steps — a skill was written for a test project whose sources were gone
  // but whose DLLs remained. These are removed, not kept.
  const ignored = nul(await g(["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], "קבצים שנוצרו ומתעלמים מהם")).filter((p) => !p.startsWith(".dcc/"));
  for (const p of [...changed.keys()]) if (p.startsWith(".dcc/")) changed.delete(p);
  if (!changed.size && !commits.length && !ignored.length) return [];
  const keep = path.join(runtimeDir(ctx.runId), "init-draft");
  for (const p of changed.keys()) {
    const from = path.join(dir, p);
    if (existsSync(from) && statSync(from).isFile()) { const to = path.join(keep, p); mkdirSync(path.dirname(to), { recursive: true }); copyFileSync(from, to); }
  }
  const files = [...changed.keys()];
  await event(ctx, "onboarding.draft.set_aside", { files: files.slice(0, 200), count: files.length, commitsUndone: commits, keptAt: keep }, by.userId);
  try {
    if (commits.length) await g(["reset", "--quiet", "--mixed", base], "ביטול ה-commits של הסשן");
    const restore = files.filter((p) => changed.get(p) !== "A" && changed.get(p) !== "?");
    for (let i = 0; i < restore.length; i += 100) await g(["checkout", base, "--", ...restore.slice(i, i + 100)], "החזרת קבצים");
    for (const p of files.filter((x) => !restore.includes(x))) rmSync(path.join(dir, p), { force: true });
    for (const p of ignored) rmSync(path.join(dir, p), { force: true, recursive: true });
    removeEmptyDirs(dir, [...files, ...ignored]);
  } catch (e) {
    await event(ctx, "onboarding.draft.set_aside_failed", { error: (e as Error).message.slice(0, 300) }, by.userId);
    throw e;
  }
  terminalLine(ctx.runId, `טיוטת /init הוזזה הצידה (${files.length} קבצים${ignored.length ? `, ${ignored.length} קבצים שנבנו או הותקנו נמחקו` : ""}${commits.length ? `, ${commits.length} commits בוטלו` : ""}; נשמרו ב-${keep}) — רק מה שאושר בכרטיס נכנס`);
  return files;
}

/** The folders that held only what was set aside — an empty `Test/Some.Project/` would still pass an "exists" check. */
function removeEmptyDirs(root: string, removed: readonly string[]) {
  const dirs = [...new Set(removed.map((p) => path.dirname(p)).filter((d) => d && d !== "."))].sort((a, b) => b.length - a.length);
  for (const d of dirs) {
    let cur = d;
    while (cur && cur !== "." && !cur.startsWith(".dcc")) {
      const abs = path.join(root, cur);
      try { if (existsSync(abs) && statSync(abs).isDirectory() && readdirSync(abs).length === 0) rmSync(abs, { recursive: true, force: true }); else break; } catch { break; }
      cur = path.dirname(cur);
    }
  }
}

/* ── 5. build: install by family, verify per kind, trial again ─────── */

export async function startBuild(repoId: string, runId: string, by: Actor) {
  const { run, steps, ctx } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה הסתיימה");
  const plan = stepOf(steps, "plan");
  if (plan?.status !== "WaitingForUser") throw new OnboardingError("התוכנית לא ממתינה");
  const cards = await loadCards(ctx);
  const approved = cards.filter((c) => c.status === "approved");
  if (!approved.length) throw new OnboardingError("שום רכיב לא אושר — אשרו לפחות אחד, או בטלו את ההרצה");
  if (planBusy.has(runId)) throw new OnboardingError("סריקת טיוטת /init עוד רצה — חכו שתסתיים, או בנו אחריה");
  planBusy.add(runId);
  try {
    // A phase after the draft was already set aside and scanned by `afterDraft`; a build from the draft phase (nothing written, or the person chose to build anyway) sets it aside here.
    await mergePlanResult(ctx, { phase: "decide" });
    if (terminalState(runId) === "live") await stopDraftSession(draftCtx(ctx), by.userId);
    if (sessionOf(run).id) await recordSessionSlice(draftCtx(ctx), by.userId);
    await setDraftAside(ctx, by);
  } catch (e) {
    planBusy.delete(runId);
    throw e;
  }
  planBusy.delete(runId);
  const planNow = stepOf((await loadRun(repoId, runId)).steps, "plan")?.result ?? plan.result ?? {};
  await completeStep(ctx, "plan", { ...(planNow as object), decided: cards.filter((c) => c.status !== "proposed").length, approved: approved.length, declined: cards.filter((c) => c.status === "declined" && c.group !== "not_recommended").length, deferred: cards.filter((c) => c.status === "deferred").length, undecided: cards.filter((c) => c.status === "proposed").length }, by.userId);
  await runOnboardingStep(repoId, runId, "build", by, { automated: true });
  return { building: approved.length };
}

async function runBuild(ctx: Ctx, run: RunRow, by: Actor) {
  if (!run.workspacePath) throw new OnboardingError("אין עותק מבודד");
  const dir = run.workspacePath;
  const p = await requireProfile(ctx);
  const processes = await loadProcesses(ctx);
  const cards = await loadCards(ctx);
  let costUsd = 0;
  // The author reads the copy through an added folder, apart from the copy's own instructions: what an earlier card
  // wrote into AGENTS.md (a draft section, say) must not become the author's instructions (a skill for a test project
  // that existed only in the draft, in the Trade run). One fix attempt carries the validator's message.
  const author: Author = async ({ component, format, process, evidence, fix }) => {
    const res = await callModel(ctx, "onboarding.author", {
      REPO_NAME: ctx.repoName, PROFILE_SUMMARY: profileSummary(p.profile),
      COMPONENT: `The repository's working copy, to read with Read, Grep and Glob (absolute path): ${dir}\n${KIND_HE[component.kind]} · ${component.title_he}\nWhy: ${component.why_he}\nWhat: ${component.what_he}\nParameters: ${JSON.stringify(component.params).slice(0, 1500)}${component.questions.length ? `\nAnswers: ${component.questions.map((q) => `${q.question_he} → ${q.answer ?? q.default}`).join("; ")}` : ""}`,
      PROCESS: process ? `${process.title}\n${process.steps.map((s) => `- ${s.title}: ${s.what}`).join("\n")}` : undefined, EVIDENCE: evidence, FORMAT: format, FIX: fix,
    }, { capability: "onboarding_author", label: `${fix ? "תיקון" : "כתיבה"}: ${component.title_he}`, stepKey: "build", by: by.userId, cwd: dir, lean: true, leanTools: "Read,Grep,Glob", addDirs: [dir], think: true, maxTurns: 25, timeoutMs: 420_000 });
    costUsd += res.costUsd;
    return res.text;
  };
  const outcomes = await buildComponents({ dir, repoName: ctx.repoName, profile: p.profile, cards, processes, author, log: (l) => terminalLine(ctx.runId, l) });
  const removedFiles: string[] = outcomes.removedFiles ?? [];
  for (const o of outcomes) {
    const c = cards.find((x) => x.key === o.key)!;
    await withTenant(ctx.clientId, (tx) => tx.update(onboardingComponent).set({ status: o.status, files: o.files, validation: o.validation, updatedAt: new Date() }).where(eq(onboardingComponent.id, c.id)));
    await event(ctx, "onboarding.build.component", { key: o.key, title: c.title_he, kind: c.kind, status: o.status, files: o.files, validation: o.validation ? { how: o.validation.how, passed: o.validation.passed, detail: o.validation.detail.slice(0, 300) } : null, notes: o.notes, retried: o.retry ? { how: o.retry.how, detail: o.retry.detail.slice(0, 200) } : null, removed: o.removed }, by.userId);
  }
  if (removedFiles.length) await event(ctx, "onboarding.build.removed", { files: removedFiles }, by.userId);
  const built = await loadCards(ctx);
  const joint = jointCheck(built, dir);
  for (const d of joint.duplicates) terminalLine(ctx.runId, `כפילות: ${d}`);
  for (const d of joint.contradictions) terminalLine(ctx.runId, `סתירה: ${d}`);
  terminalLine(ctx.runId, `הקשר שנטען בכל סשן: ~${joint.alwaysLoadedTokens.toLocaleString("en-US")} טוקנים`);
  // The measurement's "with" arm: the same tasks, on a copy holding exactly the files that would be delivered — the only
  // measure that says whether the set helped, and the only one that says it per component.
  let evalSummary: EvalSummary | null = null;
  const baseline = await loadTrials(ctx, "baseline");
  if (baseline.length && run.kind !== "coach") {
    evalSummary = await runEvalPhase(ctx, run, by, "after");
    for (const cs of evalSummary.components) {
      const c = built.find((x) => x.key === cs.key);
      if (c) await withTenant(ctx.clientId, (tx) => tx.update(onboardingComponent).set({ delta: cs.delta, updatedAt: new Date() }).where(eq(onboardingComponent.id, c.id)));
    }
    const t = evalSummary.totals;
    terminalLine(ctx.runId, `מדידה: עם ${t.with.passK}/${t.measured} · בלי ${t.without.passK}/${t.measured} · השתפרו ${t.improved}, הורעו ${t.worse}, אותו דבר ${t.same} · עלות להרצה ${t.costChange == null ? "—" : `${t.costChange >= 0 ? "+" : ""}${Math.round(t.costChange * 100)}%`}`);
    for (const cs of evalSummary.components) if (cs.removalProposed) terminalLine(ctx.runId, `  מוצע להסרה: ${cs.key} — ${cs.why_he}`);
  }
  const delta = evalSummary ? legacyDelta(evalSummary) : null;
  const withDelta = await loadCards(ctx);
  // The repository's own record (`.dcc/onboarding.json`), delivered with the components.
  const dossier = writeDossier(dir, { profile: p.profile, corrections: p.corrections, cards: withDelta, trials: await loadTrials(ctx), processes, runId: ctx.runId, baselineSha: run.baselineSha, eval: evalSummary });
  const files = [...new Set([...withDelta.flatMap((c) => c.files), ...dossier])];
  const result: BuildResult = {
    installed: outcomes.filter((o) => o.status === "installed" || o.status === "verified" || o.status === "configured").length, verified: outcomes.filter((o) => o.status === "verified").length, failed: outcomes.filter((o) => o.status === "failed").length, skipped: outcomes.filter((o) => o.status === "deferred" || o.status === "reported").length,
    files, delta, eval: evalSummary, removedFiles, jointCheck: joint, costUsd,
  };
  await event(ctx, "onboarding.build.done", { ...result, eval: evalSummary ? evalSummary.totals : null }, by.userId);
  await completeStep(ctx, "build", result, by.userId);
  await advance(ctx, by);
}

/* ── 6. deliver: only what was approved, in the person's identity ─── */

/** What ships: the files of cards that were VERIFIED (or configured for the client's environment), and the run's record. Nothing "installed but not checked". */
async function deliverableFiles(ctx: Ctx): Promise<string[]> {
  const cards = await loadCards(ctx);
  const { run } = await loadRun(ctx.repoId, ctx.runId);
  const dossier = [".dcc/onboarding.json"].filter((f) => run.workspacePath && existsSync(path.join(run.workspacePath, f)));
  return [...new Set([...cards.filter(deliverable).flatMap((c) => c.files), ...dossier])];
}

/**
 * A built card taken out before delivery — the measurement proposed it (no
 * delta, or a worse one), or a person did not want it. Its own files leave the
 * copy; a shared file (AGENTS.md, settings) keeps the other cards' lines.
 */
export async function removeBuiltComponent(repoId: string, runId: string, by: Actor, input: { key: string; reason?: string | null }) {
  const { run, steps, ctx } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה הסתיימה");
  if (stepOf(steps, "build")?.status !== "Completed" || stepOf(steps, "deliver")?.status !== "WaitingForUser") throw new OnboardingError("הסרה אפשרית אחרי הבנייה, לפני המסירה");
  if (!run.workspacePath) throw new OnboardingError("אין עותק מבודד");
  const cards = await loadCards(ctx);
  const c = cards.find((x) => x.key === input.key);
  if (!c) throw new OnboardingError("הכרטיס לא נמצא");
  if (!deliverable(c) && c.status !== "installed" && c.status !== "failed") throw new OnboardingError("הרכיב הזה לא נמצא במסירה");
  const sharedWithOthers = new Set(cards.filter((x) => x.key !== c.key && deliverable(x)).flatMap((x) => x.files));
  const removed: string[] = [];
  for (const f of c.files) {
    if (sharedWithOthers.has(f)) continue;
    const abs = path.join(run.workspacePath, f);
    if (existsSync(abs)) { rmSync(abs, { force: true }); removed.push(f); }
  }
  removeEmptyDirs(run.workspacePath, removed);
  await withTenant(ctx.clientId, (tx) => tx.update(onboardingComponent).set({ status: "removed", declineReason: input.reason?.trim() || c.declineReason, decidedBy: by.userId, decidedAt: new Date(), updatedAt: new Date() }).where(eq(onboardingComponent.id, c.id)));
  await event(ctx, "onboarding.component.removed", { key: c.key, title: c.title_he, files: removed, kept: c.files.filter((f) => sharedWithOthers.has(f)), reason: input.reason ?? null }, by.userId);
  terminalLine(runId, `הוסר לפני המסירה: ${c.title_he}${removed.length ? ` (${removed.join(", ")})` : ""}`);
  await patchStep(ctx, "deliver", { result: { files: await deliverableFiles(ctx) } });
  return { key: c.key, removed };
}

export async function deliverRun(repoId: string, runId: string, by: Actor) {
  const { run, steps, ctx } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה הסתיימה");
  if (stepOf(steps, "deliver")?.status !== "WaitingForUser") throw new OnboardingError("המסירה לא ממתינה");
  if (!run.workspacePath || !run.branchName) throw new OnboardingError("אין עותק מבודד למסירה");
  await patchStep(ctx, "deliver", { status: "Running" });
  await patchRun(ctx, { status: "Running" });
  void (async () => {
    try {
      const cards = await loadCards(ctx);
      const files = await deliverableFiles(ctx);
      const view = await readinessOf(ctx, run, cards);
      const build = (stepOf(steps, "build")?.result ?? {}) as Partial<BuildResult>;
      const report = pullRequestReport({ repoName: ctx.repoName, cards, delta: build.delta ?? null, evalSummary: build.eval ?? null, readiness: view, branch: run.branchName!, baselineSha: run.baselineSha });
      const delivered = await deliverWorkspace({ dir: run.workspacePath!, branch: run.branchName!, defaultBranch: run.defaultBranch, baselineSha: run.baselineSha, userId: by.userId, title: `DCC onboarding: Claude Code setup for ${ctx.repoName}`, body: report, files, log: (l) => terminalLine(ctx.runId, l) });
      const result: DeliverResult = { ...delivered, report };
      for (const c of cards) if (c.source === "marketplace" && deliverable(c) && typeof c.params.sourceId === "string") await countSourceUse(c.params.sourceId).catch(() => undefined);
      await event(ctx, "onboarding.delivered", { commitSha: result.commitSha, prUrl: result.prUrl, compareUrl: result.compareUrl, localOnly: result.localOnly, files: files.length }, by.userId);
      if (terminalState(runId) === "live") await stopDraftSession(draftCtx(ctx), by.userId);
      if (sessionOf(run).id) await recordSessionSlice(draftCtx(ctx), by.userId);
      await completeStep(ctx, "deliver", result, by.userId);
    } catch (e) {
      await failStep(ctx, "deliver", e, by.userId);
    }
  })();
  return { delivering: true };
}

/* ── cancel, automation ───────────────────────────────────────────── */

export async function cancelOnboardingRun(repoId: string, runId: string, by: Actor) {
  const { run, steps, ctx } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה כבר הסתיימה");
  if (terminalState(runId) === "live") await stopDraftSession(draftCtx(ctx), by.userId);
  if (sessionOf(run).id) await recordSessionSlice(draftCtx(ctx), by.userId);
  for (const s of steps) if (s.status !== "Completed") await patchStep(ctx, s.stepKey as StepKey, { status: "Cancelled" });
  await patchRun(ctx, { status: "Cancelled", cancelledAt: new Date(), cancelledBy: by.userId });
  await event(ctx, "onboarding.run.cancelled", {}, by.userId);
  terminalLine(runId, "ההרצה בוטלה. העותק המבודד והענף נשארים כמו שהם.");
  return { cancelled: true };
}

export async function updateOnboardingAutomation(repoId: string, runId: string, raw: unknown, by: Actor): Promise<Automation> {
  const { run, ctx } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה הסתיימה");
  const automation = normalizeAutomation(raw);
  await patchRun(ctx, { automation });
  await event(ctx, "onboarding.automation.updated", { level: automation.level }, by.userId);
  return automation;
}

/* ── the /init draft session inside the plan step ─────────────────── */

const draftCtx = (ctx: Ctx): DraftCtx => ({ repoId: ctx.repoId, runId: ctx.runId, clientId: ctx.clientId, triggeredBy: ctx.triggeredBy });

export async function startDraftSession(repoId: string, runId: string, by: Actor, input: { resume?: boolean; model?: string; effort?: string } = {}) {
  const { run, steps, ctx } = await loadRun(repoId, runId);
  if (RUN_OVER.includes(run.status as RunStatus)) throw new OnboardingError("ההרצה הסתיימה");
  // Only while the plan waits — never beside the measurement in the same copy (it used to be allowed as soon as the interview was over).
  if (stepOf(steps, "plan")?.status !== "WaitingForUser") throw new OnboardingError("טיוטת /init נפתחת כשהתוכנית פתוחה, לפני ההחלטות על הכרטיסים");
  if (planBusy.has(runId)) throw new OnboardingError("הטיוטה הקודמת עוד נסרקת — חכו שתסתיים");
  try { await launchDraftSession(draftCtx(ctx), run, by.userId, !!input.resume, { model: input.model, effort: input.effort }); }
  catch (e) { throw e instanceof DraftError ? new OnboardingError(e.message) : e; }
  return { started: true };
}

export async function sendToOnboardingSession(repoId: string, runId: string, by: Actor, input: { text: string; messageId?: string; force?: boolean }) {
  const { run, ctx } = await loadRun(repoId, runId);
  try { return await sendToDraftSession(draftCtx(ctx), run, by.userId, input); }
  catch (e) { throw e instanceof DraftError ? new OnboardingError(e.message) : e; }
}

/* ── reads ────────────────────────────────────────────────────────── */

async function runEvents(ctx: Ctx) {
  return withTenant(ctx.clientId, (tx) => tx.select().from(repoAiEvent).where(and(eq(repoAiEvent.repoId, ctx.repoId), sql`${repoAiEvent.payload}->>'runId' = ${ctx.runId}`)).orderBy(asc(repoAiEvent.occurredAt)));
}

async function readinessOf(ctx: Ctx, run: RunRow, cards: readonly Component[]): Promise<Readiness> {
  const p = await loadProfile(ctx);
  const processes = await loadProcesses(ctx);
  const trials = await loadTrials(ctx);
  const [buildStep] = await withTenant(ctx.clientId, (tx) => tx.select().from(repositoryOnboardingStep).where(and(eq(repositoryOnboardingStep.runId, ctx.runId), eq(repositoryOnboardingStep.stepKey, "build"))).limit(1));
  const [planStep] = await withTenant(ctx.clientId, (tx) => tx.select().from(repositoryOnboardingStep).where(and(eq(repositoryOnboardingStep.runId, ctx.runId), eq(repositoryOnboardingStep.stepKey, "plan"))).limit(1));
  const plan = (planStep?.result ?? {}) as Partial<PlanResult & PlanExtras>;
  const build = (buildStep?.result ?? {}) as Partial<BuildResult>;
  const interview = ((await withTenant(ctx.clientId, (tx) => tx.select().from(repositoryOnboardingStep).where(and(eq(repositoryOnboardingStep.runId, ctx.runId), eq(repositoryOnboardingStep.stepKey, "processes"))).limit(1)))[0]?.result ?? {}) as { answers?: InterviewAnswer[] };
  return readiness({
    cards, processes, trials, delta: build.delta ?? null, reviewerOpen: cards.filter((c) => c.source === "reviewer" && c.status === "proposed").length,
    suppressed: plan.suppressed ?? [], firings: plan.firings ?? [], windowsOnly: !!p?.profile.windows_build.windows_only_build, hasRunner: interview.answers?.some((a) => a.key === "runner" && a.value === "yes") ?? false,
    alwaysLoadedTokens: build.jointCheck?.alwaysLoadedTokens ?? null,
  });
}

export async function getOnboardingRunView(repoId: string, runId: string) {
  const { repo: r, run, steps, ctx } = await loadRun(repoId, runId);
  const events = await runEvents(ctx);
  const session = sessionOf(run);
  const live = terminalState(runId);
  session.state = live === "live" ? "live" : session.state === "live" ? "disconnected" : session.state;
  const p = await loadProfile(ctx);
  const processes = await loadProcesses(ctx);
  const trials = await loadTrials(ctx);
  const cards = await loadCards(ctx);
  const processesStep = stepOf(steps, "processes");
  const interview = (processesStep?.result ?? {}) as { questions?: InterviewQuestion[]; answers?: InterviewAnswer[] };
  const trialStep = stepOf(steps, "trial");
  const buildStep = stepOf(steps, "build");
  const planStep = stepOf(steps, "plan");
  const deliverStep = stepOf(steps, "deliver");
  const build = (buildStep?.result ?? null) as BuildResult | null;
  const baseline = trials.filter((t) => t.phase === "baseline");
  const after = trials.filter((t) => t.phase === "after");
  // The measurement as it stands: the build's summary once it ran, else what the "without" arm shows so far.
  const evalNow: EvalSummary | null = build?.eval ?? (p && trials.length ? summarizeEval(evalTasksFor(p.profile, processes), trials.map(asEvalRecord), cards) : null);
  const deliver = (deliverStep?.result ?? {}) as Partial<DeliverResult>;
  let codeMap: CodeMap | null = null;
  if (run.workspacePath) codeMap = await codeMapForWorkspace(run.workspacePath, { branch: run.branchName, baselineSha: run.baselineSha, prUrl: deliver.prUrl ?? null, prNumber: deliver.prNumber ?? null }).catch(() => null);
  // Cost: the ledger rows of this run (every model call carries its step), plus what the live draft session spent since its last slice.
  const calls = await callsForEntity(ctx.clientId, { entityKind: "onboarding_run", entityId: runId });
  const runCalls = calls.filter((c) => c.trigger !== "chat" && c.trigger !== "rollover");
  const chatCalls = calls.filter((c) => c.trigger === "chat" || c.trigger === "rollover");
  const totals = sessionTotals(session);
  const cur = session.ledgerCursor ?? { costUsd: 0, inputTokens: 0, outputTokens: 0, apiDurationMs: 0 };
  const liveUsd = Math.max(0, totals.costUsd - cur.costUsd);
  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
  const byStep = new Map<string, { stepKey: string; costUsd: number; calls: number }>();
  for (const c of runCalls) { const k = String(c.meta.stepKey ?? "plan"); const e = byStep.get(k) ?? { stepKey: k, costUsd: 0, calls: 0 }; e.costUsd += c.costUsd; e.calls++; byStep.set(k, e); }
  if (liveUsd > 0) { const e = byStep.get("plan") ?? { stepKey: "plan", costUsd: 0, calls: 0 }; e.costUsd += liveUsd; byStep.set("plan", e); }
  const rec = recommend("onboarding_init");
  const readinessView = planStep?.status === "WaitingForUser" || planStep?.status === "Completed" ? await readinessOf(ctx, run, cards) : null;
  const proposals = await withTenant(ctx.clientId, (tx) => tx.select({ id: repoCoachProposal.id, status: repoCoachProposal.status }).from(repoCoachProposal).where(and(eq(repoCoachProposal.repoId, ctx.repoId), eq(repoCoachProposal.status, "proposed"))));
  return {
    repo: { id: r.id, name: r.name },
    run: { ...run, session },
    steps,
    definitions: STEPS,
    automation: normalizeAutomation(run.automation),
    levels: AUTOMATION_LEVELS,
    profile: p ? { id: p.id, facts: profileFacts(p.profile, p.corrections), corrections: p.corrections, summary: profileSummary(p.profile), tags: stackTags(p.profile), raw: p.profile } : null,
    interview: { questions: interview.questions ?? [], answers: interview.answers ?? [] },
    processes,
    trials: {
      baseline, after, delta: build?.delta ?? (evalNow ? legacyDelta(evalNow) : null), eval: evalNow,
      waiting: trialStep?.status === "WaitingForUser" ? (trialStep.result as { tasks: { key: string; title_he: string; kind: string; judge: string }[]; estimateUsd: number; capUsd: number; arms: EvalArm[]; runs: number }) : null,
    },
    components: cards,
    plan: (planStep?.result ?? null) as (PlanResult & PlanExtras) | null,
    readiness: readinessView,
    build,
    deliver: deliverStep?.status === "Completed" ? (deliverStep.result as DeliverResult) : null,
    events,
    codeMap,
    cost: {
      totalCostUsd: sum(runCalls, (c) => c.costUsd) + liveUsd, liveUsd, calls: runCalls.length,
      inputTokens: sum(runCalls, (c) => c.inputTokens), outputTokens: sum(runCalls, (c) => c.outputTokens),
      chat: chatCalls.length ? { costUsd: sum(chatCalls, (c) => c.costUsd), calls: chatCalls.length } : null,
      byStep: [...byStep.values()], rows: calls,
    },
    recommended: { draft: { model: rec.model, effort: rec.effort } },
    coach: { openProposals: proposals.length },
  };
}

export async function getOnboardingFileVersions(repoId: string, runId: string, filePath: string) {
  const { run } = await loadRun(repoId, runId);
  if (!run.workspacePath || !run.baselineSha) throw new OnboardingError("אין עותק מבודד עדיין");
  return fileVersions(run.workspacePath, run.baselineSha, filePath);
}

export async function getOnboardingChangedFiles(repoId: string, runId: string) {
  const { run } = await loadRun(repoId, runId);
  if (!run.workspacePath || !run.baselineSha) return { files: [] };
  return { files: await changedFiles(run.workspacePath, run.baselineSha) };
}

export async function listOnboardingRuns(repoId: string) {
  const r = await loadRepo(repoId);
  return withTenant(r.clientId, (tx) =>
    tx.select({ id: repositoryOnboardingRun.id, kind: repositoryOnboardingRun.kind, status: repositoryOnboardingRun.status, currentStepKey: repositoryOnboardingRun.currentStepKey, startedAt: repositoryOnboardingRun.startedAt, completedAt: repositoryOnboardingRun.completedAt, branchName: repositoryOnboardingRun.branchName })
      .from(repositoryOnboardingRun).where(eq(repositoryOnboardingRun.repoId, repoId)).orderBy(desc(repositoryOnboardingRun.startedAt)),
  );
}

export async function getLatestOnboardingRun(repoId: string) {
  const [latest] = await listOnboardingRuns(repoId);
  return latest ? { runId: latest.id, kind: latest.kind, status: latest.status as RunStatus, currentStepKey: latest.currentStepKey, completedAt: latest.completedAt } : null;
}

/** The steps, the automation levels and the draft session's model — what the pre-start page shows before a run exists. */
export function onboardingStepCatalogue() {
  const rec = recommend("onboarding_init");
  return { steps: STEPS, levels: AUTOMATION_LEVELS, recommended: { draft: { model: rec.model, effort: rec.effort } } };
}

/* ── what the one chat knows about a run ──────────────────────────── */

export async function onboardingChatFacts(runId: string, cursor: number): Promise<{ facts: Record<string, unknown>; cursor: number }> {
  const [row] = await db.select().from(repositoryOnboardingRun).where(eq(repositoryOnboardingRun.id, runId)).limit(1);
  if (!row) return { facts: {}, cursor };
  const ctx: Ctx = { repoId: row.repoId, runId, clientId: row.clientId, repoName: "", triggeredBy: row.triggeredBy };
  const p = await loadProfile(ctx);
  const cards = await loadCards(ctx);
  const s = sessionOf(row);
  const digest = s.transcriptPath ? digestTranscript(s.transcriptPath, cursor, cursor ? 10_000 : 14_000) : { text: "", cursor, entries: 0 };
  const step = row.currentStepKey ? stepDefinition(row.currentStepKey as StepKey)?.title_he ?? row.currentStepKey : "—";
  const waiting = cards.filter((c) => c.status === "proposed");
  const [planRow] = await withTenant(row.clientId, (tx) => tx.select({ result: repositoryOnboardingStep.result }).from(repositoryOnboardingStep).where(and(eq(repositoryOnboardingStep.runId, runId), eq(repositoryOnboardingStep.stepKey, "plan"))).limit(1));
  const initScan = (planRow?.result as { initScan?: InitScanState } | null)?.initScan;
  return {
    facts: {
      "צעד נוכחי": step,
      "מצב ההרצה": row.status,
      "מה האבחון מצא": p ? profileFacts(p.profile, p.corrections).map((f) => `${f.label_he}: ${f.value_he}${f.corrected ? " (סומן כלא נכון)" : ""}`).slice(0, 16) : "(עדיין לא רץ)",
      "כרטיסי הרכיבים": cards.length ? cards.map((c) => `[${c.key}] ${c.title_he} · ${KIND_HE[c.kind]} · ${c.group} · ${c.status}${c.status === "proposed" ? "" : ""} — למה: ${c.why_he} — מה: ${c.what_he} — איך נבדק: ${c.verifyHow_he}${c.validation ? ` — תוצאה: ${c.validation.passed === true ? "עבר" : c.validation.passed === false ? "נכשל" : "לא נבדק כאן"} (${c.validation.detail})` : ""}`).slice(0, 40) : "(עדיין אין)",
      "כרטיסים שמחכים להחלטה": waiting.length,
      "סשן טיוטת /init": s.state === "live" ? "פעיל" : s.state === "ended" ? "נסגר" : s.state === "disconnected" ? "נותק" : "לא נפתח",
      ...(digest.text ? { "מה סשן הטיוטה עשה מאז השאלה הקודמת": digest.text } : {}),
      ...(initScan?.state === "done" ? { "סריקת טיוטת /init": `${initScan.summary ?? ""} — ${initScan.cards?.length ?? 0} כרטיסים מהטיוטה, ${initScan.dropOurs?.length ?? 0} משלנו סומנו כמיותרים${initScan.reject?.length ? `; לא נלקח: ${initScan.reject.map((r) => `${r.what} (${r.why})`).join("; ").slice(0, 900)}` : ""}` } : {}),
    },
    cursor: digest.cursor,
  };
}

/** For the terminal socket: the run must exist and belong to the repository. */
export async function authorizeOnboardingTerminal(repoId: string, runId: string) {
  const { ctx } = await loadRun(repoId, runId);
  return { clientId: ctx.clientId };
}

/* ── restart ──────────────────────────────────────────────────────── */

/** After an API restart: a step that was mid-flight is marked failed (its button reruns it); a scan of the draft that was running says it stopped; a draft session that was live is marked disconnected. */
export async function recoverOnboardingRuns(): Promise<number> {
  const live = await db.select().from(repositoryOnboardingRun).where(inArray(repositoryOnboardingRun.status, [...LIVE_RUN_STATUSES]));
  let touched = 0;
  for (const run of live) {
    const ctx: Ctx = { repoId: run.repoId, runId: run.id, clientId: run.clientId, repoName: "", triggeredBy: run.triggeredBy };
    const steps = await db.select().from(repositoryOnboardingStep).where(eq(repositoryOnboardingStep.runId, run.id));
    for (const s of steps) {
      if (s.status === "Running") {
        await failStep(ctx, s.stepKey as StepKey, new Error("הצעד הופסק כשהשרת הופעל מחדש — הריצו אותו שוב"), null);
        touched++;
      }
    }
    const plan = steps.find((s) => s.stepKey === "plan");
    const scan = (plan?.result as { initScan?: InitScanState } | null)?.initScan;
    if (plan?.status === "WaitingForUser" && scan?.state === "running") {
      await failInitScan(ctx, null, "הסריקה הופסקה כשהשרת הופעל מחדש — אפשר לסרוק שוב", "api_restart");
      touched++;
    }
    // A plan caught between the draft and the decisions opens for decision — what was scanned is applied, what was not is on the screen's log.
    const phase = (plan?.result as PlanResult | null)?.phase;
    if (plan?.status === "WaitingForUser" && (phase === "aside" || phase === "scan")) { await mergePlanResult(ctx, { phase: "decide" }); touched++; }
    if (await recoverDraftSession(draftCtx(ctx), run)) touched++;
    // The measurement's arms are throw-away worktrees; a restart mid-measurement leaves them registered.
    const arms = armsRootFor(runtimeDir(run.id));
    if (existsSync(arms) && run.workspacePath) {
      rmSync(arms, { recursive: true, force: true });
      await git(["worktree", "prune"], run.workspacePath).catch(() => undefined);
    }
  }
  return touched;
}

export const onboardingStepKeys = STEP_ORDER;
export { sessionModelId, sessionEffort, stepsDeciding };
