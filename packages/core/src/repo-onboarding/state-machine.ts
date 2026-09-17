import { and, desc, eq } from "drizzle-orm";
import { db, withTenant } from "@dcc/db";
import {
  onboardingPromptTemplate, repo, repositoryOnboardingClaudeExecution,
  repositoryOnboardingRun, repositoryOnboardingStage, repositoryProfile,
} from "@dcc/db/schema";
import { appendRepoAiEvent } from "../repo-ai/events.ts";
import { STAGE_ORDER } from "./types.ts";
import type { StageContext, StageHandler, StageOutcome } from "./types.ts";

/**
 * The onboarding state machine (spec §6/§28/§34). Resumability is
 * structural, not special-cased: `advanceRun` always finds "the first
 * stage in STAGE_ORDER whose row isn't Completed/CompletedWithWarnings/
 * Skipped" and re-enters exactly that one — re-running after a failure
 * never repeats earlier stages, because their rows are already terminal.
 *
 * Processes exactly ONE stage per call (not "run to completion") —
 * deliberate for debuggability; a caller (route/UI) loops by calling this
 * repeatedly.
 */

/** A stage row in one of these states counts as "settled" for both the
 *  resume-point scan and as a real, reusable `priorResults` entry for
 *  later stages. Deliberately does NOT include "WaitingForUser" — a
 *  waiting stage's `result` (e.g. stage 07's questions before answers)
 *  is provisional, not a finished input for anything downstream. */
const RESULT_READY: ReadonlySet<string> = new Set(["Completed", "CompletedWithWarnings", "Skipped"]);
/** Truly finished, nothing left to do — deliberately does NOT include
 *  "Failed": a failed run must stay advanceable (that's the whole point
 *  of resumability — retrying re-enters the failed stage) and cancellable
 *  (abandoning a failed attempt is a valid action). Found live: an
 *  earlier version of this set included "Failed", which made `advanceRun`
 *  silently no-op on every retry of a failed run without even attempting
 *  the fix that was supposed to make it succeed. */
const RUN_DONE: ReadonlySet<string> = new Set(["Completed", "CompletedWithWarnings", "Cancelled"]);

const handlers = new Map<string, StageHandler>();

/** Stage handlers register themselves here at module load (see `stages/*.ts`). */
export function registerStage(key: string, handler: StageHandler): void {
  handlers.set(key, handler);
}

async function loadOnboardableRepo(repoId: string) {
  const [r] = await db.select().from(repo).where(eq(repo.id, repoId)).limit(1);
  if (!r) throw new Error("repo not found");
  if (!r.clientId) throw new Error("הטמעת AI זמינה רק ל-repository ששייך ללקוח יחיד");
  return { ...r, clientId: r.clientId };
}

export async function startOnboardingRun(repoId: string, by: { userId: string }): Promise<{ runId: string }> {
  const r = await loadOnboardableRepo(repoId);
  let runId: string;
  try {
    const [run] = await withTenant(r.clientId, (tx) =>
      tx.insert(repositoryOnboardingRun).values({
        repoId, clientId: r.clientId, triggeredBy: by.userId, defaultBranch: r.defaultBranch,
      }).returning({ id: repositoryOnboardingRun.id }),
    );
    runId = run!.id;
  } catch (e) {
    // The constraint-violation text lives on the driver error's `.cause`
    // chain, not `.message` itself (confirmed live: Postgres/PGlite wraps
    // it as `DrizzleQueryError: Failed query: ...` with the actual
    // "duplicate key value violates..." detail on `.cause.message` —
    // pino's logger enriches its OWN display with the cause, which is
    // why this looked right in the logs but never matched here, letting
    // a real concurrent-run collision surface as a raw 500 instead of
    // the friendly Hebrew message). Check the whole cause chain.
    let msg = "";
    for (let cur: unknown = e; cur instanceof Error && msg.length < 2000; cur = cur.cause) msg += cur.message;
    if (/repository_onboarding_run_live_uq/.test(msg)) {
      throw new Error("כבר יש הרצת onboarding פעילה על הריפוזיטורי הזה — יש להמתין לסיומה או לבטל אותה");
    }
    throw e;
  }
  await appendRepoAiEvent({ clientId: r.clientId, repoId, type: "onboarding.run.started", payload: { runId }, actorUserId: by.userId });
  await advanceRun(repoId, runId);
  return { runId };
}

/** Persists a stage handler's outcome and advances (or doesn't) the run —
 *  shared by `advanceRun` and `submitStageInput` so there's exactly one
 *  place that knows what each `StageOutcome.status` means for the run row.
 *  Takes no transaction from its caller; opens its own `withTenant`. */
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
      completedAt: outcome.status === "WaitingForUser" ? null : new Date(),
      updatedAt: new Date(),
    }).where(eq(repositoryOnboardingStage.id, stageRowId));

    // workspace_setup's result carries the fields the run row itself
    // needs (every later stage reads workspaceDir/baselineSha off the
    // run, not by re-parsing another stage's jsonb result).
    if (stageKey === "workspace_setup" && outcome.status === "Completed") {
      const ws = outcome.result as { workspacePath?: string; baselineSha?: string; branchName?: string; workspaceKind?: string } | undefined;
      if (ws) {
        await tx.update(repositoryOnboardingRun).set({
          workspacePath: ws.workspacePath ?? null, baselineSha: ws.baselineSha ?? null,
          branchName: ws.branchName ?? null, workspaceKind: ws.workspaceKind ?? null,
        }).where(eq(repositoryOnboardingRun.id, runId));
      }
    }

    // A stage that's still waiting on a human must NOT be treated as
    // "done, advance to the next one" — found live: an earlier version
    // fell through to the generic completed-branch below, silently
    // advancing `currentStageKey` past a stage nobody had answered yet,
    // and a second `advanceRun` call would then re-enter and WIPE that
    // stage's questions/suggestions via the retry path. `currentStageKey`
    // is deliberately left untouched here — it already points at this
    // stage (set when it was first marked Running).
    if (outcome.status === "WaitingForUser") {
      await tx.update(repositoryOnboardingRun).set({ status: "WaitingForUser" }).where(eq(repositoryOnboardingRun.id, runId));
      await appendRepoAiEvent({ clientId, repoId, type: "onboarding.stage.waiting_for_user", payload: { runId, stageKey }, actorUserId: triggeredBy });
      return { runStatus: "WaitingForUser", stageKey };
    }

    if (outcome.status === "Failed") {
      await tx.update(repositoryOnboardingRun).set({ status: "Failed" }).where(eq(repositoryOnboardingRun.id, runId));
      await appendRepoAiEvent({ clientId, repoId, type: "onboarding.stage.failed", payload: { runId, stageKey, errors: outcome.errors }, actorUserId: triggeredBy });
      return { runStatus: "Failed", stageKey };
    }

    await appendRepoAiEvent({ clientId, repoId, type: "onboarding.stage.completed", payload: { runId, stageKey, status: outcome.status }, actorUserId: triggeredBy });

    const isLast = nextIdx === STAGE_ORDER.length - 1;
    if (isLast) {
      await tx.update(repositoryOnboardingRun).set({ status: "Completed", currentStageKey: null, completedAt: new Date() }).where(eq(repositoryOnboardingRun.id, runId));
      await appendRepoAiEvent({ clientId, repoId, type: "onboarding.run.completed", payload: { runId }, actorUserId: triggeredBy });
      return { runStatus: "Completed", stageKey: null };
    }
    const nextStageKey = STAGE_ORDER[nextIdx + 1]!;
    // `status` must be reset to "Running" explicitly here, not assumed
    // already-Running — found live: when this stage was just RESUMED via
    // `submitStageInput` (not a normal `advanceRun` call), the run's
    // status was still "WaitingForUser" from its first entry and nothing
    // else ever flips it back, so `getOnboardingRunView` kept reporting
    // "WaitingForUser" forever after a real approval/answer went through.
    await tx.update(repositoryOnboardingRun).set({ status: "Running", currentStageKey: nextStageKey }).where(eq(repositoryOnboardingRun.id, runId));
    return { runStatus: "Running", stageKey: nextStageKey };
  });
}

/** A stage handler can do slow external I/O (git clone/worktree, a
 *  `claude -p` call) that must NEVER run inside a `withTenant` — that
 *  wraps a real DB transaction, and this codebase's own `withTenant` doc
 *  comment says outright that PGlite is a single connection: holding a
 *  transaction open across a multi-second/multi-minute external call
 *  blocks every other request the whole app makes for that entire time.
 *  Confirmed live: an earlier version of this function that ran the
 *  handler inside the transaction hung the ENTIRE API (even unrelated
 *  routes like `/repos`) for as long as the git workspace setup took.
 *  `advanceRun` is therefore three separate `withTenant` calls — load
 *  the next stage's context and mark it Running (1), run the handler
 *  with NO transaction open (2), persist the outcome (3) — never one
 *  call wrapping the handler invocation. */
export async function advanceRun(repoId: string, runId: string): Promise<{ runStatus: string; stageKey: string | null }> {
  const r = await loadOnboardableRepo(repoId);
  const clientId = r.clientId;

  const prep = await withTenant(clientId, async (tx) => {
    const [run] = await tx.select().from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.id, runId), eq(repositoryOnboardingRun.repoId, repoId))).limit(1);
    if (!run) throw new Error("run not found");
    if (RUN_DONE.has(run.status)) return { done: true as const, runStatus: run.status, stageKey: run.currentStageKey };
    // A run waiting on a human is never re-scanned into STAGE_ORDER — its
    // waiting stage must only ever be resumed via `submitStageInput`,
    // never re-entered here (see `persistStageOutcome`'s comment for the
    // real bug this guards against).
    if (run.status === "WaitingForUser") return { done: true as const, runStatus: "WaitingForUser", stageKey: run.currentStageKey };

    const stageRows = await tx.select().from(repositoryOnboardingStage).where(eq(repositoryOnboardingStage.runId, runId));
    const byKey = new Map(stageRows.map((s) => [s.stageKey, s]));
    const nextIdx = STAGE_ORDER.findIndex((k) => !RESULT_READY.has(byKey.get(k)?.status ?? "Pending"));

    if (nextIdx === -1) {
      await tx.update(repositoryOnboardingRun).set({ status: "Completed", currentStageKey: null, completedAt: new Date() }).where(eq(repositoryOnboardingRun.id, runId));
      await appendRepoAiEvent({ clientId, repoId, type: "onboarding.run.completed", payload: { runId }, actorUserId: run.triggeredBy });
      return { done: true as const, runStatus: "Completed", stageKey: null };
    }

    const stageKey = STAGE_ORDER[nextIdx]!;
    const existing = byKey.get(stageKey);
    const now = new Date();
    const history = existing
      ? [...((existing.history as unknown[]) ?? []), { attempt: existing.attempt, startedAt: existing.startedAt, completedAt: existing.completedAt, status: existing.status, errors: existing.errors }]
      : [];

    let stageRowId: string;
    if (existing) {
      const [updated] = await tx.update(repositoryOnboardingStage).set({
        status: "Running", attempt: existing.attempt + 1, startedAt: now, completedAt: null, errors: [], history, updatedAt: now,
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
    const workspaceResult = priorResults.workspace_setup as { workspacePath?: string } | undefined;

    const ctx: StageContext = {
      runId, repoId, clientId, triggeredBy: run.triggeredBy,
      workspaceDir: workspaceResult?.workspacePath ?? "",
      baselineSha: run.baselineSha ?? "",
      priorResults,
    };
    return { done: false as const, stageKey, stageRowId, nextIdx, handler, ctx, triggeredBy: run.triggeredBy };
  });

  if (prep.done) return { runStatus: prep.runStatus, stageKey: prep.stageKey };
  const { stageKey, stageRowId, nextIdx, handler, ctx, triggeredBy } = prep;

  // No transaction open here — this is the whole point of the split.
  let outcome: StageOutcome;
  try {
    outcome = await handler(ctx);
  } catch (e) {
    outcome = { status: "Failed", errors: [String((e as Error).message ?? e)] };
  }

  return persistStageOutcome(clientId, repoId, runId, stageKey, stageRowId, nextIdx, triggeredBy, outcome);
}

/** The only way to resume a stage that returned `WaitingForUser` (stage
 *  04's deny-rule approval, stage 07's answered questions, and any future
 *  human-input stage). Unlike `advanceRun`'s retry path, this does NOT
 *  bump `attempt` or push a `history` entry — it's a resume, not a retry;
 *  the stage's own `result` from its first entry is exactly what a
 *  human-input handler needs to read back (e.g. "what did we suggest") to
 *  produce its final, approved result. */
export async function submitStageInput(repoId: string, runId: string, stageKey: string, input: unknown, by: { userId: string }): Promise<{ runStatus: string; stageKey: string | null }> {
  const r = await loadOnboardableRepo(repoId);
  const clientId = r.clientId;

  const prep = await withTenant(clientId, async (tx) => {
    const [run] = await tx.select().from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.id, runId), eq(repositoryOnboardingRun.repoId, repoId))).limit(1);
    if (!run) throw new Error("run not found");
    if (run.status !== "WaitingForUser" || run.currentStageKey !== stageKey) {
      throw new Error(`השלב "${stageKey}" לא ממתין כרגע לקלט`);
    }

    const stageRows = await tx.select().from(repositoryOnboardingStage).where(eq(repositoryOnboardingStage.runId, runId));
    const stageRow = stageRows.find((s) => s.stageKey === stageKey);
    if (!stageRow || stageRow.status !== "WaitingForUser") throw new Error(`השלב "${stageKey}" לא ממתין כרגע לקלט`);

    const handler = handlers.get(stageKey);
    if (!handler) throw new Error(`no handler registered for stage "${stageKey}"`);

    const priorResults: Record<string, unknown> = {};
    for (const s of stageRows) if (RESULT_READY.has(s.status)) priorResults[s.stageKey] = s.result;
    const workspaceResult = priorResults.workspace_setup as { workspacePath?: string } | undefined;

    const ctx: StageContext = {
      runId, repoId, clientId, triggeredBy: run.triggeredBy,
      workspaceDir: workspaceResult?.workspacePath ?? "",
      baselineSha: run.baselineSha ?? "",
      priorResults,
      resumeInput: input,
    };
    const nextIdx = STAGE_ORDER.indexOf(stageKey);
    return { stageRowId: stageRow.id, nextIdx, handler, ctx, triggeredBy: run.triggeredBy };
  });

  await appendRepoAiEvent({ clientId, repoId, type: "onboarding.stage.input_submitted", payload: { runId, stageKey }, actorUserId: by.userId });

  let outcome: StageOutcome;
  try {
    outcome = await prep.handler(prep.ctx);
  } catch (e) {
    outcome = { status: "Failed", errors: [String((e as Error).message ?? e)] };
  }

  return persistStageOutcome(clientId, repoId, runId, stageKey, prep.stageRowId, prep.nextIdx, prep.triggeredBy, outcome);
}

export async function cancelRun(repoId: string, runId: string, by: { userId: string }): Promise<void> {
  const r = await loadOnboardableRepo(repoId);
  await withTenant(r.clientId, async (tx) => {
    const [run] = await tx.select().from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.id, runId), eq(repositoryOnboardingRun.repoId, repoId))).limit(1);
    if (!run) throw new Error("run not found");
    if (RUN_DONE.has(run.status)) return;
    await tx.update(repositoryOnboardingRun).set({ status: "Cancelled", cancelledAt: new Date(), cancelledBy: by.userId }).where(eq(repositoryOnboardingRun.id, runId));
  });
  await appendRepoAiEvent({ clientId: r.clientId, repoId, type: "onboarding.run.cancelled", payload: { runId }, actorUserId: by.userId });
}

/** The repo's most recent onboarding run, or null if none exists yet —
 *  a lightweight lookup for list-style screens (e.g. the Repositories
 *  list's status column) that need "is this repo onboarded, and to what
 *  stage" without a specific runId on hand. Replaces the old
 *  `repo_ai_profile`-based status the pre-replacement UI showed there. */
export async function getLatestOnboardingRun(repoId: string): Promise<{ runId: string; status: string; currentStageKey: string | null } | null> {
  const [run] = await db.select({ id: repositoryOnboardingRun.id, status: repositoryOnboardingRun.status, currentStageKey: repositoryOnboardingRun.currentStageKey })
    .from(repositoryOnboardingRun).where(eq(repositoryOnboardingRun.repoId, repoId)).orderBy(desc(repositoryOnboardingRun.startedAt)).limit(1);
  return run ? { runId: run.id, status: run.status, currentStageKey: run.currentStageKey } : null;
}

export async function getOnboardingRunView(repoId: string, runId: string) {
  const r = await loadOnboardableRepo(repoId);
  return withTenant(r.clientId, async (tx) => {
    const [run] = await tx.select().from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.id, runId), eq(repositoryOnboardingRun.repoId, repoId))).limit(1);
    if (!run) throw new Error("run not found");
    const stages = await tx.select().from(repositoryOnboardingStage).where(eq(repositoryOnboardingStage.runId, runId)).orderBy(repositoryOnboardingStage.stageOrder);
    const [profile] = await tx.select().from(repositoryProfile).where(eq(repositoryProfile.runId, runId)).limit(1);
    return { run, stages, profile: profile ?? null };
  });
}

/** A stage's Claude call, joined with the exact immutable prompt version
 *  it actually sent — lets the UI show "what was asked" next to "what
 *  came back" (the stage row's own `result`), not just the output alone.
 *  `{{PLACEHOLDER}}` tokens in `promptBody` are shown unresolved (the
 *  template, not the rendered call) — `promptVars` themselves are never
 *  persisted (see `runner.ts`), only the template body is. */
export async function getOnboardingExecution(repoId: string, executionId: string) {
  const r = await loadOnboardableRepo(repoId);
  return withTenant(r.clientId, async (tx) => {
    const [row] = await tx
      .select({
        id: repositoryOnboardingClaudeExecution.id,
        stageKey: repositoryOnboardingClaudeExecution.stageKey,
        model: repositoryOnboardingClaudeExecution.model,
        permissionProfile: repositoryOnboardingClaudeExecution.permissionProfile,
        status: repositoryOnboardingClaudeExecution.status,
        resultText: repositoryOnboardingClaudeExecution.resultText,
        costUsd: repositoryOnboardingClaudeExecution.costUsd,
        inputTokens: repositoryOnboardingClaudeExecution.inputTokens,
        outputTokens: repositoryOnboardingClaudeExecution.outputTokens,
        durationMs: repositoryOnboardingClaudeExecution.durationMs,
        numTurns: repositoryOnboardingClaudeExecution.numTurns,
        errorMessage: repositoryOnboardingClaudeExecution.errorMessage,
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
