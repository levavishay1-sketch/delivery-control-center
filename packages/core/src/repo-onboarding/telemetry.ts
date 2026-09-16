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
export type OnboardingRunCostSummary = {
  totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number;
  totalDurationMs: number; executionCount: number;
};

export async function onboardingRunCostSummary(runId: string): Promise<OnboardingRunCostSummary> {
  const rows = await db.select({
    costUsd: repositoryOnboardingClaudeExecution.costUsd,
    inputTokens: repositoryOnboardingClaudeExecution.inputTokens,
    outputTokens: repositoryOnboardingClaudeExecution.outputTokens,
    durationMs: repositoryOnboardingClaudeExecution.durationMs,
  }).from(repositoryOnboardingClaudeExecution).where(eq(repositoryOnboardingClaudeExecution.runId, runId));

  return rows.reduce<OnboardingRunCostSummary>((acc, r) => ({
    totalCostUsd: acc.totalCostUsd + (r.costUsd ? Number(r.costUsd) : 0),
    totalInputTokens: acc.totalInputTokens + (r.inputTokens ?? 0),
    totalOutputTokens: acc.totalOutputTokens + (r.outputTokens ?? 0),
    totalDurationMs: acc.totalDurationMs + (r.durationMs ?? 0),
    executionCount: acc.executionCount + 1,
  }), { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, totalDurationMs: 0, executionCount: 0 });
}
