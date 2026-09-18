import { and, desc, eq, inArray } from "drizzle-orm";
import { db, withTenant } from "@dcc/db";
import {
  onboardingPromptTemplate, repo, repoAiEvent, repositoryOnboardingClaudeExecution,
  repositoryOnboardingRun, repositoryOnboardingStage, repositoryProfile,
} from "@dcc/db/schema";
import { git } from "../ai-assist.ts";
import { ledgerForRun } from "./artifacts.ts";
import { appendRepoAiEvent } from "./events.ts";
import { cancelActiveExecution } from "./runner.ts";
import { ONBOARDING_VERSION, STAGE_CAPABILITY, STAGE_ORDER, STAGES, normalizeModelPolicy, normalizePolicy, presetPolicy, stageDefinition } from "./types.ts";
import { recommend, type Capability } from "../routing.ts";
import type { AutomationPolicy, ModelPolicy, StageAutoResolver, StageContext, StageHandler, StageOutcome } from "./types.ts";

/**
 * The onboarding state machine. Resumability is structural: the next
 * stage to run is always "the first stage in STAGE_ORDER whose row isn't
 * settled" — re-entering after a failure never repeats settled stages.
 *
 * The automation driver (`driveRun`) is what turns the policy into
 * behaviour: after every settled stage it looks at the next stage's
 * `run` policy, and at a waiting gate it looks at the gate policy — and
 * either continues on its own or stops and leaves the run for a person.
 * Every continuation is a persisted transition, so a crashed process
 * resumes from the DB, never from memory.
 *
 * A stage handler may do slow external I/O (git, a `claude -p` call) and
 * must NEVER run inside `withTenant` — PGlite is a single connection and
 * an open transaction blocks every other request in the app. Each step
 * is therefore three separate transactions with the handler in between.
 */

const RESULT_READY: ReadonlySet<string> = new Set(["Completed", "CompletedWithWarnings", "Skipped"]);
const RUN_DONE: ReadonlySet<string> = new Set(["Completed", "CompletedWithWarnings", "Cancelled"]);

const handlers = new Map<string, StageHandler>();
const autoResolvers = new Map<string, StageAutoResolver>();
/** Runs a driver loop is currently advancing (in this process). */
const driving = new Set<string>();

export function registerStage(key: string, handler: StageHandler, autoResolve?: StageAutoResolver): void {
  handlers.set(key, handler);
  if (autoResolve) autoResolvers.set(key, autoResolve);
}

async function loadOnboardableRepo(repoId: string) {
  const [r] = await db.select().from(repo).where(eq(repo.id, repoId)).limit(1);
  if (!r) throw new Error("repo not found");
  if (!r.clientId) throw new Error("הטמעת AI זמינה רק ל-repository ששייך ללקוח יחיד");
  return { ...r, clientId: r.clientId };
}

type RunRow = typeof repositoryOnboardingRun.$inferSelect;
type StageRow = typeof repositoryOnboardingStage.$inferSelect;

function assertV2(run: RunRow) {
  if (run.onboardingVersion !== ONBOARDING_VERSION) {
    throw new Error(`ההרצה הזו נוצרה על ידי גרסה קודמת של תהליך ה-onboarding (${run.onboardingVersion}) — ניתן לצפות בה או לבטל אותה, אך לא להמשיך; התחילו הרצה חדשה`);
  }
}

async function previousResultsFor(clientId: string, previousRunId: string | null): Promise<Record<string, unknown> | undefined> {
  if (!previousRunId) return undefined;
  const rows = await withTenant(clientId, (tx) => tx.select().from(repositoryOnboardingStage).where(eq(repositoryOnboardingStage.runId, previousRunId)));
  const out: Record<string, unknown> = {};
  for (const s of rows) if (RESULT_READY.has(s.status)) out[s.stageKey] = s.result;
  return out;
}

/* ── start ──────────────────────────────────────────────────────────── */

export async function startOnboardingRun(
  repoId: string,
  by: { userId: string },
  opts: { automation?: unknown; modelChoices?: unknown; mode?: "initial" | "refresh"; previousRunId?: string } = {},
): Promise<{ runId: string }> {
  const r = await loadOnboardableRepo(repoId);
  const automation = normalizePolicy(opts.automation ?? presetPolicy("guided"));
  const modelChoices = normalizeModelPolicy(opts.modelChoices ?? {});
  let mode: "initial" | "refresh" = opts.mode ?? "initial";
  let previousRunId = opts.previousRunId ?? null;
  if (mode === "refresh" && !previousRunId) {
    const last = await lastCompletedRun(repoId);
    if (!last) mode = "initial";
    else previousRunId = last.id;
  }
  let runId: string;
  try {
    const [run] = await withTenant(r.clientId, (tx) =>
      tx.insert(repositoryOnboardingRun).values({
        repoId, clientId: r.clientId, triggeredBy: by.userId, defaultBranch: r.defaultBranch,
        onboardingVersion: ONBOARDING_VERSION, mode, previousRunId, automation, modelChoices,
      }).returning({ id: repositoryOnboardingRun.id }),
    );
    runId = run!.id;
  } catch (e) {
    // The constraint-violation text lives on the driver error's `.cause` chain.
    let msg = "";
    for (let cur: unknown = e; cur instanceof Error && msg.length < 2000; cur = cur.cause) msg += cur.message;
    if (/repository_onboarding_run_live_uq/.test(msg)) {
      throw new Error("כבר יש הרצת onboarding פעילה על הריפוזיטורי הזה — יש להמתין לסיומה או לבטל אותה");
    }
    throw e;
  }
  await appendRepoAiEvent({ clientId: r.clientId, repoId, type: "onboarding.run.started", payload: { runId, mode, previousRunId, automation: automation.preset }, actorUserId: by.userId });
  void driveRun(repoId, runId);
  return { runId };
}

async function lastCompletedRun(repoId: string): Promise<RunRow | null> {
  const rows = await db.select().from(repositoryOnboardingRun)
    .where(and(eq(repositoryOnboardingRun.repoId, repoId), eq(repositoryOnboardingRun.onboardingVersion, ONBOARDING_VERSION)))
    .orderBy(desc(repositoryOnboardingRun.startedAt)).limit(10);
  return rows.find((x) => x.status === "Completed" || x.status === "CompletedWithWarnings") ?? null;
}

/* ── one step ───────────────────────────────────────────────────────── */

async function persistStageOutcome(
  clientId: string, repoId: string, runId: string,
  stageKey: string, stageRowId: string, nextIdx: number, triggeredBy: string,
  outcome: StageOutcome,
): Promise<{ runStatus: string; stageKey: string | null }> {
  return withTenant(clientId, async (tx) => {
    await tx.update(repositoryOnboardingStage).set({
      status: outcome.status,
      result: outcome.result ?? null,
      warnings: outcome.warnings ?? [],
      errors: outcome.errors ?? [],
      claudeExecutionId: outcome.claudeExecutionId ?? null,
      sourceCommitSha: outcome.sourceCommitSha ?? null,
      completedAt: outcome.status === "WaitingForUser" || outcome.status === "AwaitingExternal" ? null : new Date(),
      updatedAt: new Date(),
    }).where(eq(repositoryOnboardingStage.id, stageRowId));

    // scan's result carries the fields the run row itself needs.
    if (stageKey === "scan" && RESULT_READY.has(outcome.status)) {
      const ws = outcome.result as { workspacePath?: string; baselineSha?: string; branchName?: string; workspaceKind?: string } | undefined;
      if (ws) {
        await tx.update(repositoryOnboardingRun).set({
          workspacePath: ws.workspacePath ?? null, baselineSha: ws.baselineSha ?? null,
          branchName: ws.branchName ?? null, workspaceKind: ws.workspaceKind ?? null,
        }).where(eq(repositoryOnboardingRun.id, runId));
      }
    }

    if (outcome.resetTo) {
      // Send the run back: every stage from the target on becomes Pending
      // again (its previous attempt kept in `history`, its result kept so
      // a re-entered stage can count its own attempts).
      const targetIdx = STAGE_ORDER.indexOf(outcome.resetTo.stageKey);
      if (targetIdx < 0) throw new Error(`unknown reset target ${outcome.resetTo.stageKey}`);
      const rows = await tx.select().from(repositoryOnboardingStage).where(eq(repositoryOnboardingStage.runId, runId));
      for (const s of rows) {
        if (s.stageOrder < targetIdx) continue;
        const history = [...((s.history as unknown[]) ?? []), { attempt: s.attempt, startedAt: s.startedAt, completedAt: s.completedAt, status: s.id === stageRowId ? outcome.status : s.status, errors: s.errors, resetBy: stageKey }];
        await tx.update(repositoryOnboardingStage).set({ status: "Pending", completedAt: null, history, updatedAt: new Date() }).where(eq(repositoryOnboardingStage.id, s.id));
      }
      await tx.update(repositoryOnboardingRun).set({ status: "Running", currentStageKey: outcome.resetTo.stageKey, reviewNote: outcome.resetTo.note ?? null }).where(eq(repositoryOnboardingRun.id, runId));
      await appendRepoAiEvent({ clientId, repoId, type: "onboarding.run.reset", payload: { runId, from: stageKey, to: outcome.resetTo.stageKey, note: outcome.resetTo.note ?? null }, actorUserId: triggeredBy });
      return { runStatus: "Running", stageKey: outcome.resetTo.stageKey };
    }

    if (outcome.status === "WaitingForUser") {
      await tx.update(repositoryOnboardingRun).set({ status: "WaitingForUser" }).where(eq(repositoryOnboardingRun.id, runId));
      await appendRepoAiEvent({ clientId, repoId, type: "onboarding.stage.waiting_for_user", payload: { runId, stageKey }, actorUserId: triggeredBy });
      return { runStatus: "WaitingForUser", stageKey };
    }
    if (outcome.status === "AwaitingExternal") {
      await tx.update(repositoryOnboardingRun).set({ status: "AwaitingExternal" }).where(eq(repositoryOnboardingRun.id, runId));
      await appendRepoAiEvent({ clientId, repoId, type: "onboarding.stage.awaiting_external", payload: { runId, stageKey }, actorUserId: triggeredBy });
      return { runStatus: "AwaitingExternal", stageKey };
    }
    if (outcome.status === "Failed") {
      await tx.update(repositoryOnboardingRun).set({ status: "Failed" }).where(eq(repositoryOnboardingRun.id, runId));
      await appendRepoAiEvent({ clientId, repoId, type: "onboarding.stage.failed", payload: { runId, stageKey, errors: outcome.errors }, actorUserId: triggeredBy });
      return { runStatus: "Failed", stageKey };
    }

    await appendRepoAiEvent({ clientId, repoId, type: "onboarding.stage.completed", payload: { runId, stageKey, status: outcome.status, warnings: outcome.warnings ?? [] }, actorUserId: triggeredBy });

    if (nextIdx === STAGE_ORDER.length - 1) {
      const rows = await tx.select({ status: repositoryOnboardingStage.status }).from(repositoryOnboardingStage).where(eq(repositoryOnboardingStage.runId, runId));
      const withWarnings = rows.some((s) => s.status === "CompletedWithWarnings");
      const final = withWarnings ? "CompletedWithWarnings" : "Completed";
      await tx.update(repositoryOnboardingRun).set({ status: final, currentStageKey: null, completedAt: new Date() }).where(eq(repositoryOnboardingRun.id, runId));
      await appendRepoAiEvent({ clientId, repoId, type: "onboarding.run.completed", payload: { runId, status: final }, actorUserId: triggeredBy });
      return { runStatus: final, stageKey: null };
    }
    const nextStageKey = STAGE_ORDER[nextIdx + 1]!;
    await tx.update(repositoryOnboardingRun).set({ status: "Running", currentStageKey: nextStageKey }).where(eq(repositoryOnboardingRun.id, runId));
    return { runStatus: "Running", stageKey: nextStageKey };
  });
}

/** Runs exactly one stage — the first unsettled one — and persists the
 *  outcome. Does not consult the automation policy; `driveRun` does. */
async function advanceOnce(repoId: string, runId: string): Promise<{ runStatus: string; stageKey: string | null; advanced: boolean }> {
  const r = await loadOnboardableRepo(repoId);
  const clientId = r.clientId;

  const prep = await withTenant(clientId, async (tx) => {
    const [run] = await tx.select().from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.id, runId), eq(repositoryOnboardingRun.repoId, repoId))).limit(1);
    if (!run) throw new Error("run not found");
    assertV2(run);
    if (RUN_DONE.has(run.status)) return { done: true as const, runStatus: run.status, stageKey: run.currentStageKey };
    if (run.status === "WaitingForUser") return { done: true as const, runStatus: "WaitingForUser", stageKey: run.currentStageKey };

    const stageRows = await tx.select().from(repositoryOnboardingStage).where(eq(repositoryOnboardingStage.runId, runId));
    const byKey = new Map(stageRows.map((s) => [s.stageKey, s]));
    const nextIdx = STAGE_ORDER.findIndex((k) => !RESULT_READY.has(byKey.get(k)?.status ?? "Pending"));
    if (nextIdx === -1) {
      await tx.update(repositoryOnboardingRun).set({ status: "Completed", currentStageKey: null, completedAt: new Date() }).where(eq(repositoryOnboardingRun.id, runId));
      return { done: true as const, runStatus: "Completed", stageKey: null };
    }

    const stageKey = STAGE_ORDER[nextIdx]!;
    const existing = byKey.get(stageKey);
    const now = new Date();
    let stageRowId: string;
    let attempt = 1;
    if (existing) {
      const history = [...((existing.history as unknown[]) ?? []), { attempt: existing.attempt, startedAt: existing.startedAt, completedAt: existing.completedAt, status: existing.status, errors: existing.errors }];
      attempt = existing.attempt + 1;
      const [updated] = await tx.update(repositoryOnboardingStage).set({
        status: "Running", attempt, startedAt: now, completedAt: null, errors: [], history, updatedAt: now,
      }).where(eq(repositoryOnboardingStage.id, existing.id)).returning({ id: repositoryOnboardingStage.id });
      stageRowId = updated!.id;
    } else {
      const [inserted] = await tx.insert(repositoryOnboardingStage).values({
        runId, clientId, stageKey, stageOrder: nextIdx, status: "Running", attempt: 1, startedAt: now,
      }).returning({ id: repositoryOnboardingStage.id });
      stageRowId = inserted!.id;
    }
    await tx.update(repositoryOnboardingRun).set({ status: "Running", currentStageKey: stageKey }).where(eq(repositoryOnboardingRun.id, runId));

    const handler = handlers.get(stageKey);
    if (!handler) throw new Error(`no handler registered for stage "${stageKey}"`);
    const priorResults: Record<string, unknown> = {};
    for (const s of stageRows) if (RESULT_READY.has(s.status)) priorResults[s.stageKey] = s.result;
    const scan = priorResults.scan as { workspacePath?: string } | undefined;
    return {
      done: false as const, stageKey, stageRowId, nextIdx, handler, run, attempt,
      ctxBase: {
        runId, repoId, clientId, triggeredBy: run.triggeredBy,
        workspaceDir: run.workspacePath ?? scan?.workspacePath ?? "",
        baselineSha: run.baselineSha ?? "",
        mode: run.mode === "refresh" ? "refresh" as const : "initial" as const,
        priorResults, ownResult: existing?.result ?? undefined, reviewNote: run.reviewNote,
        automation: normalizePolicy(run.automation),
        modelChoices: normalizeModelPolicy(run.modelChoices),
      },
    };
  });

  if (prep.done) return { runStatus: prep.runStatus, stageKey: prep.stageKey, advanced: false };
  const { stageKey, stageRowId, nextIdx, handler, run } = prep;
  const ctx: StageContext = { ...prep.ctxBase, previousResults: await previousResultsFor(clientId, run.previousRunId) };

  // No transaction open here — this is the whole point of the split.
  let outcome: StageOutcome;
  try {
    outcome = await handler(ctx);
  } catch (e) {
    outcome = { status: "Failed", errors: [String((e as Error).message ?? e)] };
  }
  const res = await persistStageOutcome(clientId, repoId, runId, stageKey, stageRowId, nextIdx, run.triggeredBy, outcome);
  return { ...res, advanced: true };
}

/* ── the automation driver ─────────────────────────────────────────── */

/** Keeps advancing while the policy says the next thing is automatic.
 *  Safe to call at any time; a second concurrent call for the same run
 *  is a no-op. Never throws — a failure lands on the run row as Failed. */
export async function driveRun(repoId: string, runId: string): Promise<void> {
  if (driving.has(runId)) return;
  driving.add(runId);
  try {
    for (let guard = 0; guard < 40; guard++) {
      const [run] = await db.select().from(repositoryOnboardingRun).where(eq(repositoryOnboardingRun.id, runId)).limit(1);
      if (!run || run.onboardingVersion !== ONBOARDING_VERSION) return;
      if (RUN_DONE.has(run.status) || run.status === "Failed" || run.status === "AwaitingExternal") return;
      const policy = normalizePolicy(run.automation);

      if (run.status === "WaitingForUser") {
        const key = run.currentStageKey ?? "";
        const resolver = autoResolvers.get(key);
        if (policy.stages[key]?.gate !== "auto" || !resolver) return;
        const [row] = await withTenant(run.clientId, (tx) => tx.select().from(repositoryOnboardingStage).where(and(eq(repositoryOnboardingStage.runId, runId), eq(repositoryOnboardingStage.stageKey, key))).limit(1));
        if (!row || row.status !== "WaitingForUser") return;
        await appendRepoAiEvent({ clientId: run.clientId, repoId, type: "onboarding.gate.auto_resolved", payload: { runId, stageKey: key, preset: policy.preset }, actorUserId: run.triggeredBy });
        await submitStageInputInternal(repoId, runId, key, resolver(row.result, { runId, repoId, clientId: run.clientId } as StageContext), { userId: run.triggeredBy }, "automation");
        continue;
      }

      // Pending / Running: is the next stage automatic?
      const rows = await withTenant(run.clientId, (tx) => tx.select({ stageKey: repositoryOnboardingStage.stageKey, status: repositoryOnboardingStage.status }).from(repositoryOnboardingStage).where(eq(repositoryOnboardingStage.runId, runId)));
      const byKey = new Map(rows.map((s) => [s.stageKey, s.status]));
      const next = STAGE_ORDER.find((k) => !RESULT_READY.has(byKey.get(k) ?? "Pending"));
      if (!next) { await advanceOnce(repoId, runId); return; }
      if (byKey.get(next) === "Running") return; // another process/step is on it
      if (policy.stages[next]?.run !== "auto") return;
      const res = await advanceOnce(repoId, runId);
      if (!res.advanced) return;
    }
  } catch (e) {
    try {
      const [run] = await db.select().from(repositoryOnboardingRun).where(eq(repositoryOnboardingRun.id, runId)).limit(1);
      if (run) {
        await withTenant(run.clientId, (tx) => tx.update(repositoryOnboardingRun).set({ status: "Failed" }).where(eq(repositoryOnboardingRun.id, runId)));
        await appendRepoAiEvent({ clientId: run.clientId, repoId, type: "onboarding.driver.failed", payload: { runId, error: String((e as Error).message ?? e) }, actorUserId: run.triggeredBy });
      }
    } catch { /* nothing more to do */ }
  } finally {
    driving.delete(runId);
  }
}

export function isRunDriving(runId: string): boolean { return driving.has(runId); }

/** The person's "run the next stage" — one step now, then whatever the
 *  policy lets run on its own. Also the retry after a failure and the
 *  "check again" on a stage awaiting an external event. */
export async function advanceRun(repoId: string, runId: string): Promise<{ runStatus: string; stageKey: string | null }> {
  if (driving.has(runId)) throw new Error("ההרצה מתקדמת כרגע באופן אוטומטי — המתינו לסיום השלב הנוכחי");
  const res = await advanceOnce(repoId, runId);
  void driveRun(repoId, runId);
  return { runStatus: res.runStatus, stageKey: res.stageKey };
}

/* ── gates ──────────────────────────────────────────────────────────── */

async function submitStageInputInternal(repoId: string, runId: string, stageKey: string, input: unknown, by: { userId: string }, source: "person" | "automation"): Promise<{ runStatus: string; stageKey: string | null }> {
  const r = await loadOnboardableRepo(repoId);
  const clientId = r.clientId;
  const prep = await withTenant(clientId, async (tx) => {
    const [run] = await tx.select().from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.id, runId), eq(repositoryOnboardingRun.repoId, repoId))).limit(1);
    if (!run) throw new Error("run not found");
    assertV2(run);
    if (run.status !== "WaitingForUser" || run.currentStageKey !== stageKey) throw new Error(`השלב "${stageKey}" לא ממתין כרגע לקלט`);
    const stageRows = await tx.select().from(repositoryOnboardingStage).where(eq(repositoryOnboardingStage.runId, runId));
    const stageRow = stageRows.find((s) => s.stageKey === stageKey);
    if (!stageRow || stageRow.status !== "WaitingForUser") throw new Error(`השלב "${stageKey}" לא ממתין כרגע לקלט`);
    const handler = handlers.get(stageKey);
    if (!handler) throw new Error(`no handler registered for stage "${stageKey}"`);
    const priorResults: Record<string, unknown> = {};
    for (const s of stageRows) if (RESULT_READY.has(s.status)) priorResults[s.stageKey] = s.result;
    // The person answering is the actor of record for this step.
    await tx.update(repositoryOnboardingStage).set({ status: "Running", updatedAt: new Date() }).where(eq(repositoryOnboardingStage.id, stageRow.id));
    await tx.update(repositoryOnboardingRun).set({ status: "Running" }).where(eq(repositoryOnboardingRun.id, runId));
    return {
      run, stageRowId: stageRow.id, nextIdx: STAGE_ORDER.indexOf(stageKey), handler,
      ctxBase: {
        runId, repoId, clientId, triggeredBy: by.userId,
        workspaceDir: run.workspacePath ?? "", baselineSha: run.baselineSha ?? "",
        mode: run.mode === "refresh" ? "refresh" as const : "initial" as const,
        priorResults, ownResult: stageRow.result ?? undefined, resumeInput: input, reviewNote: run.reviewNote,
        automation: normalizePolicy(run.automation),
        modelChoices: normalizeModelPolicy(run.modelChoices),
      },
    };
  });
  await appendRepoAiEvent({ clientId, repoId, type: "onboarding.stage.input_submitted", payload: { runId, stageKey, source, input: summarizeInput(stageKey, input) }, actorUserId: by.userId });
  const ctx: StageContext = { ...prep.ctxBase, previousResults: await previousResultsFor(clientId, prep.run.previousRunId) };
  let outcome: StageOutcome;
  try {
    outcome = await prep.handler(ctx);
  } catch (e) {
    outcome = { status: "Failed", errors: [String((e as Error).message ?? e)] };
  }
  // A rejected input leaves the gate open, not the run Failed.
  if (outcome.status === "Failed" && !outcome.result) {
    await withTenant(clientId, async (tx) => {
      await tx.update(repositoryOnboardingStage).set({ status: "WaitingForUser", errors: outcome.errors ?? [], updatedAt: new Date() }).where(eq(repositoryOnboardingStage.id, prep.stageRowId));
      await tx.update(repositoryOnboardingRun).set({ status: "WaitingForUser" }).where(eq(repositoryOnboardingRun.id, runId));
    });
    throw new Error((outcome.errors ?? ["invalid input"]).join("; "));
  }
  return persistStageOutcome(clientId, repoId, runId, stageKey, prep.stageRowId, prep.nextIdx, by.userId, outcome);
}

/** What the decision log shows for an input — never the raw payload. */
function summarizeInput(stageKey: string, input: unknown): unknown {
  const i = (input ?? {}) as Record<string, unknown>;
  if (stageKey === "boundaries") return { rules: Array.isArray(i.rules) ? i.rules.length : 0, profileId: i.profileId, existingConfig: i.existingConfig, classificationOverride: i.classificationOverride ?? null, notes: i.notes ?? null };
  if (stageKey === "confirm") return { answered: Array.isArray(i.answers) ? (i.answers as { answer_he?: string }[]).filter((a) => a.answer_he?.trim()).length : 0, total: Array.isArray(i.answers) ? i.answers.length : 0, corrections: i.corrections ?? null };
  if (stageKey === "plan") return { approvedKeys: i.approvedKeys };
  if (stageKey === "review") return { decision: i.decision, note: i.note ?? null, dropPaths: i.dropPaths ?? [] };
  return i;
}

export async function submitStageInput(repoId: string, runId: string, stageKey: string, input: unknown, by: { userId: string }): Promise<{ runStatus: string; stageKey: string | null }> {
  if (driving.has(runId)) throw new Error("ההרצה מתקדמת כרגע באופן אוטומטי — המתינו לסיום השלב הנוכחי");
  const res = await submitStageInputInternal(repoId, runId, stageKey, input, by, "person");
  void driveRun(repoId, runId);
  return res;
}

/* ── control ────────────────────────────────────────────────────────── */

export async function updateRunAutomation(repoId: string, runId: string, policy: unknown, by: { userId: string }): Promise<AutomationPolicy> {
  const r = await loadOnboardableRepo(repoId);
  const normalized = normalizePolicy(policy);
  await withTenant(r.clientId, async (tx) => {
    const [run] = await tx.select().from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.id, runId), eq(repositoryOnboardingRun.repoId, repoId))).limit(1);
    if (!run) throw new Error("run not found");
    assertV2(run);
    await tx.update(repositoryOnboardingRun).set({ automation: normalized }).where(eq(repositoryOnboardingRun.id, runId));
  });
  await appendRepoAiEvent({ clientId: r.clientId, repoId, type: "onboarding.automation.changed", payload: { runId, preset: normalized.preset, stages: normalized.stages }, actorUserId: by.userId });
  void driveRun(repoId, runId);
  return normalized;
}

/** A person's per-stage model/effort override — editable any time the run
 *  is live, same pattern as `updateRunAutomation`. Takes effect on the
 *  NEXT call for that stage; a call already running keeps whatever it
 *  already routed to. */
export async function updateRunModelChoices(repoId: string, runId: string, choices: unknown, by: { userId: string }): Promise<ModelPolicy> {
  const r = await loadOnboardableRepo(repoId);
  const normalized = normalizeModelPolicy(choices);
  await withTenant(r.clientId, async (tx) => {
    const [run] = await tx.select().from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.id, runId), eq(repositoryOnboardingRun.repoId, repoId))).limit(1);
    if (!run) throw new Error("run not found");
    assertV2(run);
    await tx.update(repositoryOnboardingRun).set({ modelChoices: normalized }).where(eq(repositoryOnboardingRun.id, runId));
  });
  await appendRepoAiEvent({ clientId: r.clientId, repoId, type: "onboarding.model_choices.changed", payload: { runId, choices: normalized }, actorUserId: by.userId });
  return normalized;
}

/** A person's "go back to stage X" (with an optional note the generate
 *  stage reads). Refused while a stage is executing. */
export async function resetRunToStage(repoId: string, runId: string, stageKey: string, by: { userId: string }, note?: string): Promise<void> {
  if (driving.has(runId)) throw new Error("ההרצה מתקדמת כרגע — המתינו לסיום השלב הנוכחי לפני חזרה אחורה");
  const r = await loadOnboardableRepo(repoId);
  const targetIdx = STAGE_ORDER.indexOf(stageKey);
  if (targetIdx < 0) throw new Error(`unknown stage ${stageKey}`);
  await withTenant(r.clientId, async (tx) => {
    const [run] = await tx.select().from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.id, runId), eq(repositoryOnboardingRun.repoId, repoId))).limit(1);
    if (!run) throw new Error("run not found");
    assertV2(run);
    if (run.status === "Cancelled") throw new Error("ההרצה בוטלה");
    const rows = await tx.select().from(repositoryOnboardingStage).where(eq(repositoryOnboardingStage.runId, runId));
    for (const s of rows) {
      if (s.stageOrder < targetIdx) continue;
      if (s.status === "Running") throw new Error(`השלב ${s.stageKey} רץ כרגע`);
      const history = [...((s.history as unknown[]) ?? []), { attempt: s.attempt, startedAt: s.startedAt, completedAt: s.completedAt, status: s.status, errors: s.errors, resetBy: "person" }];
      await tx.update(repositoryOnboardingStage).set({ status: "Pending", completedAt: null, history, updatedAt: new Date() }).where(eq(repositoryOnboardingStage.id, s.id));
    }
    await tx.update(repositoryOnboardingRun).set({ status: "Running", currentStageKey: stageKey, reviewNote: note ?? null, completedAt: null }).where(eq(repositoryOnboardingRun.id, runId));
  });
  await appendRepoAiEvent({ clientId: r.clientId, repoId, type: "onboarding.run.reset", payload: { runId, from: "person", to: stageKey, note: note ?? null }, actorUserId: by.userId });
  void driveRun(repoId, runId);
}

/** Stops the Claude call the run is making right now (the stage lands as
 *  Failed and can be retried). */
export async function stopRunExecution(repoId: string, runId: string, by: { userId: string }): Promise<{ stopped: boolean }> {
  const r = await loadOnboardableRepo(repoId);
  const stopped = cancelActiveExecution(runId);
  await appendRepoAiEvent({ clientId: r.clientId, repoId, type: "onboarding.execution.stopped", payload: { runId, stopped }, actorUserId: by.userId });
  return { stopped };
}

export async function cancelRun(repoId: string, runId: string, by: { userId: string }): Promise<void> {
  const r = await loadOnboardableRepo(repoId);
  cancelActiveExecution(runId);
  await withTenant(r.clientId, async (tx) => {
    const [run] = await tx.select().from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.id, runId), eq(repositoryOnboardingRun.repoId, repoId))).limit(1);
    if (!run) throw new Error("run not found");
    if (RUN_DONE.has(run.status)) return;
    await tx.update(repositoryOnboardingRun).set({ status: "Cancelled", cancelledAt: new Date(), cancelledBy: by.userId }).where(eq(repositoryOnboardingRun.id, runId));
  });
  await appendRepoAiEvent({ clientId: r.clientId, repoId, type: "onboarding.run.cancelled", payload: { runId }, actorUserId: by.userId });
}

/** Called once when the API process starts. A stage that was `Running`
 *  when the previous process died can never finish — its handler lived
 *  in that process — so without this the screen shows a spinner forever.
 *  It lands as Failed with a clear reason and the person retries it;
 *  never re-run automatically (that could double-spend an AI call nobody
 *  asked for twice). */
export async function recoverInterruptedRuns(): Promise<number> {
  const runs = await db.select().from(repositoryOnboardingRun)
    .where(and(eq(repositoryOnboardingRun.onboardingVersion, ONBOARDING_VERSION), inArray(repositoryOnboardingRun.status, ["Running", "Pending"])));
  const reason = "תהליך ה-DCC הופסק בזמן שהשלב רץ (הפעלה מחדש של השרת) — הריצו את השלב שוב";
  let recovered = 0;
  for (const run of runs) {
    const rows = await withTenant(run.clientId, (tx) => tx.select().from(repositoryOnboardingStage).where(and(eq(repositoryOnboardingStage.runId, run.id), eq(repositoryOnboardingStage.status, "Running"))));
    if (rows.length === 0) continue;
    await withTenant(run.clientId, async (tx) => {
      for (const s of rows) await tx.update(repositoryOnboardingStage).set({ status: "Failed", errors: [reason], completedAt: new Date(), updatedAt: new Date() }).where(eq(repositoryOnboardingStage.id, s.id));
      await tx.update(repositoryOnboardingClaudeExecution).set({ status: "Failed", errorMessage: "interrupted by a DCC restart", completedAt: new Date() })
        .where(and(eq(repositoryOnboardingClaudeExecution.runId, run.id), eq(repositoryOnboardingClaudeExecution.status, "Running")));
      await tx.update(repositoryOnboardingRun).set({ status: "Failed" }).where(eq(repositoryOnboardingRun.id, run.id));
    });
    await appendRepoAiEvent({ clientId: run.clientId, repoId: run.repoId, type: "onboarding.stage.failed", payload: { runId: run.id, stageKey: rows[0]!.stageKey, errors: [reason], interrupted: true }, actorUserId: run.triggeredBy });
    recovered++;
  }
  return recovered;
}

/* ── reads ──────────────────────────────────────────────────────────── */

export async function getLatestOnboardingRun(repoId: string): Promise<{ runId: string; status: string; currentStageKey: string | null; onboardingVersion: string; mode: string; completedAt: string | null } | null> {
  const [run] = await db.select({ id: repositoryOnboardingRun.id, status: repositoryOnboardingRun.status, currentStageKey: repositoryOnboardingRun.currentStageKey, onboardingVersion: repositoryOnboardingRun.onboardingVersion, mode: repositoryOnboardingRun.mode, completedAt: repositoryOnboardingRun.completedAt })
    .from(repositoryOnboardingRun).where(eq(repositoryOnboardingRun.repoId, repoId)).orderBy(desc(repositoryOnboardingRun.startedAt)).limit(1);
  return run ? { runId: run.id, status: run.status, currentStageKey: run.currentStageKey, onboardingVersion: run.onboardingVersion, mode: run.mode, completedAt: run.completedAt ? new Date(run.completedAt).toISOString() : null } : null;
}

export async function listOnboardingRuns(repoId: string) {
  return db.select({ id: repositoryOnboardingRun.id, status: repositoryOnboardingRun.status, mode: repositoryOnboardingRun.mode, onboardingVersion: repositoryOnboardingRun.onboardingVersion, startedAt: repositoryOnboardingRun.startedAt, completedAt: repositoryOnboardingRun.completedAt, baselineSha: repositoryOnboardingRun.baselineSha })
    .from(repositoryOnboardingRun).where(eq(repositoryOnboardingRun.repoId, repoId)).orderBy(desc(repositoryOnboardingRun.startedAt)).limit(20);
}

export async function getOnboardingRunView(repoId: string, runId: string) {
  const r = await loadOnboardableRepo(repoId);
  const view = await withTenant(r.clientId, async (tx) => {
    const [run] = await tx.select().from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.id, runId), eq(repositoryOnboardingRun.repoId, repoId))).limit(1);
    if (!run) throw new Error("run not found");
    const stages = await tx.select().from(repositoryOnboardingStage).where(eq(repositoryOnboardingStage.runId, runId)).orderBy(repositoryOnboardingStage.stageOrder);
    const [profile] = await tx.select().from(repositoryProfile).where(eq(repositoryProfile.runId, runId)).limit(1);
    const events = (await tx.select().from(repoAiEvent).where(eq(repoAiEvent.repoId, repoId)).orderBy(desc(repoAiEvent.occurredAt)).limit(300))
      .filter((e) => (e.payload as { runId?: string } | null)?.runId === runId)
      .reverse();
    return { run, stages, profile: profile ?? null, events };
  });
  const artifacts = await ledgerForRun(r.clientId, runId);
  return { ...view, artifacts, automation: normalizePolicy(view.run.automation), modelChoices: normalizeModelPolicy(view.run.modelChoices), driving: driving.has(runId), stageDefinitions: STAGES, repo: { id: r.id, name: r.name, adoRepoRef: r.adoRepoRef, localPath: r.localPath, defaultBranch: r.defaultBranch } };
}

/** The stage catalogue plus, for the five stages with an AI call, the
 *  policy's model+effort recommendation — what a "before you run this"
 *  screen shows before any run-specific override applies. */
export function onboardingStageCatalogue() {
  return STAGES.map((s) => {
    const capability = STAGE_CAPABILITY[s.key];
    return { ...s, capability: capability ?? null, recommended: capability ? recommend(capability as Capability) : null };
  });
}

/** The diff of one file between the run's baseline and the onboarding
 *  branch head — what the review gate shows. Read from the worktree,
 *  never from a copy. */
export async function getRunFileDiff(repoId: string, runId: string, filePath: string): Promise<{ path: string; diff: string; binary: boolean }> {
  const r = await loadOnboardableRepo(repoId);
  const [run] = await withTenant(r.clientId, (tx) => tx.select().from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.id, runId), eq(repositoryOnboardingRun.repoId, repoId))).limit(1));
  if (!run?.workspacePath || !run.baselineSha) throw new Error("run has no workspace yet");
  if (filePath.includes("..") || filePath.startsWith("/")) throw new Error("invalid path");
  const d = await git(["diff", "--no-color", run.baselineSha, "HEAD", "--", filePath], run.workspacePath, { timeoutMs: 30_000 });
  const binary = /^Binary files/m.test(d.out);
  return { path: filePath, diff: d.out, binary };
}

export async function getOnboardingExecution(repoId: string, executionId: string) {
  const r = await loadOnboardableRepo(repoId);
  return withTenant(r.clientId, async (tx) => {
    const [row] = await tx
      .select({
        id: repositoryOnboardingClaudeExecution.id,
        stageKey: repositoryOnboardingClaudeExecution.stageKey,
        model: repositoryOnboardingClaudeExecution.model,
        effort: repositoryOnboardingClaudeExecution.effort,
        permissionProfile: repositoryOnboardingClaudeExecution.permissionProfile,
        status: repositoryOnboardingClaudeExecution.status,
        resultText: repositoryOnboardingClaudeExecution.resultText,
        resultJson: repositoryOnboardingClaudeExecution.resultJson,
        costUsd: repositoryOnboardingClaudeExecution.costUsd,
        inputTokens: repositoryOnboardingClaudeExecution.inputTokens,
        outputTokens: repositoryOnboardingClaudeExecution.outputTokens,
        durationMs: repositoryOnboardingClaudeExecution.durationMs,
        numTurns: repositoryOnboardingClaudeExecution.numTurns,
        errorMessage: repositoryOnboardingClaudeExecution.errorMessage,
        denyRulesSnapshot: repositoryOnboardingClaudeExecution.denyRulesSnapshot,
        promptKey: onboardingPromptTemplate.promptKey,
        promptVersion: onboardingPromptTemplate.version,
        promptTitle: onboardingPromptTemplate.title,
        promptBody: onboardingPromptTemplate.body,
      })
      .from(repositoryOnboardingClaudeExecution)
      .innerJoin(onboardingPromptTemplate, eq(onboardingPromptTemplate.id, repositoryOnboardingClaudeExecution.promptTemplateId))
      .where(and(eq(repositoryOnboardingClaudeExecution.id, executionId), eq(repositoryOnboardingClaudeExecution.repoId, repoId)))
      .limit(1);
    if (!row) throw new Error("execution not found");
    return row;
  });
}

export async function listRunExecutions(repoId: string, runId: string) {
  const r = await loadOnboardableRepo(repoId);
  return withTenant(r.clientId, (tx) => tx.select({
    id: repositoryOnboardingClaudeExecution.id, stageKey: repositoryOnboardingClaudeExecution.stageKey, model: repositoryOnboardingClaudeExecution.model,
    effort: repositoryOnboardingClaudeExecution.effort,
    status: repositoryOnboardingClaudeExecution.status, costUsd: repositoryOnboardingClaudeExecution.costUsd, inputTokens: repositoryOnboardingClaudeExecution.inputTokens,
    outputTokens: repositoryOnboardingClaudeExecution.outputTokens, durationMs: repositoryOnboardingClaudeExecution.durationMs, numTurns: repositoryOnboardingClaudeExecution.numTurns,
    startedAt: repositoryOnboardingClaudeExecution.startedAt, completedAt: repositoryOnboardingClaudeExecution.completedAt, errorMessage: repositoryOnboardingClaudeExecution.errorMessage,
  }).from(repositoryOnboardingClaudeExecution).where(eq(repositoryOnboardingClaudeExecution.runId, runId)).orderBy(repositoryOnboardingClaudeExecution.startedAt));
}

export { stageDefinition };
