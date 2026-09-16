import { extractClaudeJson } from "../json.ts";
import { getActiveOnboardingPrompt } from "../prompts.ts";
import { createClaudeCodeRunner } from "../runner.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";

/**
 * Stage 05 — Existing Knowledge Coverage (spec §12). Read-only Claude
 * pass over the real repo (gated by stage 04's approved deny rules) —
 * checks what's already documented so later stages don't recommend
 * duplicating it. Advisory input to stage 06, not gating: a parse
 * failure here degrades gracefully (CompletedWithWarnings, empty
 * coverage) rather than blocking the pipeline — unlike classification
 * (03) or discovery (06), nothing downstream strictly requires this to
 * have succeeded.
 */
type CoverageArea = { status: "COVERED" | "PARTIAL" | "MISSING"; sourceFiles?: string[] };

registerStage("knowledge_coverage", async (ctx): Promise<StageOutcome> => {
  const security = ctx.priorResults.security_permissions as { approvedRules?: string[] } | undefined;
  if (!security?.approvedRules) return { status: "Failed", errors: ["security_permissions has not been approved"] };

  const prompt = await getActiveOnboardingPrompt("onboarding.knowledge_coverage");
  if (!prompt) return { status: "Failed", errors: ["no active prompt for onboarding.knowledge_coverage — run seed-prompts.ts"] };

  const runner = createClaudeCodeRunner();
  const result = await runner.run({
    runId: ctx.runId, stageKey: "knowledge_coverage", repoId: ctx.repoId, clientId: ctx.clientId,
    cwd: ctx.workspaceDir, promptId: prompt.id, promptVars: {},
    permissionProfile: "read_only_plan", denyRules: security.approvedRules, maxTurns: 30, timeoutMs: 240_000,
  });

  if (result.status !== "Completed" || !result.text) {
    return { status: "Failed", errors: [result.errorMessage ?? "knowledge_coverage call did not complete"], claudeExecutionId: result.executionId };
  }

  try {
    const coverage = extractClaudeJson<Record<string, CoverageArea>>(result.text);
    return { status: "Completed", claudeExecutionId: result.executionId, result: { claudeExecutionId: result.executionId, coverage } };
  } catch (e) {
    return {
      status: "CompletedWithWarnings",
      warnings: [`could not parse coverage output: ${String((e as Error).message)}`],
      claudeExecutionId: result.executionId,
      result: { claudeExecutionId: result.executionId, coverage: {} },
    };
  }
});
