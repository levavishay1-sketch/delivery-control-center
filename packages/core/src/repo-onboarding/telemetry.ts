import { eq } from "drizzle-orm";
import { db } from "@dcc/db";
import { repositoryOnboardingClaudeExecution } from "@dcc/db/schema";

/**
 * Token/cost telemetry (spec §34 Phase 6) — the data already exists,
 * per-execution, on `repository_onboarding_claude_execution` (every
 * `ClaudeCodeRunner.run()` call persists `costUsd`/`inputTokens`/
 * `outputTokens`/`durationMs`/`numTurns`, see `runner.ts`). This is
 * aggregation + display, not new capture.
 */
export type OnboardingCostByStage = {
  stageKey: string; model: string | null; effort: string | null;
  costUsd: number; inputTokens: number; outputTokens: number; durationMs: number;
};
export type OnboardingRunCostSummary = {
  totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number;
  totalDurationMs: number; executionCount: number;
  /** One row per execution (in call order) — the model + effort actually
   *  used, so the run's real spend can be read stage by stage, not just
   *  as one total. */
  byStage: OnboardingCostByStage[];
};

export async function onboardingRunCostSummary(runId: string): Promise<OnboardingRunCostSummary> {
  const rows = await db.select({
    stageKey: repositoryOnboardingClaudeExecution.stageKey,
    model: repositoryOnboardingClaudeExecution.model,
    effort: repositoryOnboardingClaudeExecution.effort,
    costUsd: repositoryOnboardingClaudeExecution.costUsd,
    inputTokens: repositoryOnboardingClaudeExecution.inputTokens,
    outputTokens: repositoryOnboardingClaudeExecution.outputTokens,
    durationMs: repositoryOnboardingClaudeExecution.durationMs,
    startedAt: repositoryOnboardingClaudeExecution.startedAt,
  }).from(repositoryOnboardingClaudeExecution).where(eq(repositoryOnboardingClaudeExecution.runId, runId)).orderBy(repositoryOnboardingClaudeExecution.startedAt);

  const byStage: OnboardingCostByStage[] = rows.map((r) => ({
    stageKey: r.stageKey, model: r.model, effort: r.effort,
    costUsd: r.costUsd ? Number(r.costUsd) : 0, inputTokens: r.inputTokens ?? 0, outputTokens: r.outputTokens ?? 0, durationMs: r.durationMs ?? 0,
  }));

  const totals = rows.reduce((acc, r) => ({
    totalCostUsd: acc.totalCostUsd + (r.costUsd ? Number(r.costUsd) : 0),
    totalInputTokens: acc.totalInputTokens + (r.inputTokens ?? 0),
    totalOutputTokens: acc.totalOutputTokens + (r.outputTokens ?? 0),
    totalDurationMs: acc.totalDurationMs + (r.durationMs ?? 0),
    executionCount: acc.executionCount + 1,
  }), { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, totalDurationMs: 0, executionCount: 0 });

  return { ...totals, byStage };
}
