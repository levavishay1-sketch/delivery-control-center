import { extractClaudeJson } from "../json.ts";
import { getActiveOnboardingPrompt } from "../prompts.ts";
import { createClaudeCodeRunner } from "../runner.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";

/**
 * Stage 06 — Targeted Repository Discovery (spec §13). The main
 * understanding stage — explicitly NOT full-codebase comprehension.
 * Real repo access (gated by stage 04's approved deny rules), fed stage
 * 03's classification and stage 05's coverage assessment. This is the
 * pipeline's core deliverable — stage 07 (human enrichment) reads its
 * output directly, so a parse failure here is `Failed`, not downgraded.
 */
type Discovery = {
  components: unknown[]; boundaries: unknown[]; entry_points: unknown[]; key_flows: unknown[];
  integrations: unknown[]; important_paths: unknown[]; generated_or_protected_areas: unknown[];
  discovered_constraints: unknown[]; unresolved_questions: unknown[]; evidence_paths: unknown[];
};

registerStage("targeted_discovery", async (ctx): Promise<StageOutcome> => {
  const security = ctx.priorResults.security_permissions as { approvedRules?: string[] } | undefined;
  if (!security?.approvedRules) return { status: "Failed", errors: ["security_permissions has not been approved"] };
  const classification = ctx.priorResults.classification as { classification?: unknown } | undefined;
  if (!classification?.classification) return { status: "Failed", errors: ["classification did not produce a result"] };
  const coverage = ctx.priorResults.knowledge_coverage as { coverage?: unknown } | undefined;

  const prompt = await getActiveOnboardingPrompt("onboarding.targeted_discovery");
  if (!prompt) return { status: "Failed", errors: ["no active prompt for onboarding.targeted_discovery — run seed-prompts.ts"] };

  const runner = createClaudeCodeRunner();
  const result = await runner.run({
    runId: ctx.runId, stageKey: "targeted_discovery", repoId: ctx.repoId, clientId: ctx.clientId,
    cwd: ctx.workspaceDir, promptId: prompt.id,
    promptVars: {
      CLASSIFICATION: JSON.stringify(classification.classification),
      KNOWLEDGE_COVERAGE: JSON.stringify(coverage?.coverage ?? {}),
    },
    // The main understanding stage — more turns/time than the lighter
    // classification/coverage calls.
    permissionProfile: "read_only_plan", denyRules: security.approvedRules, maxTurns: 60, timeoutMs: 480_000,
  });

  if (result.status !== "Completed" || !result.text) {
    return { status: "Failed", errors: [result.errorMessage ?? "targeted_discovery call did not complete"], claudeExecutionId: result.executionId };
  }

  try {
    const discovery = extractClaudeJson<Discovery>(result.text);
    return { status: "Completed", claudeExecutionId: result.executionId, result: { claudeExecutionId: result.executionId, discovery } };
  } catch (e) {
    return { status: "Failed", errors: [String((e as Error).message)], claudeExecutionId: result.executionId };
  }
});
