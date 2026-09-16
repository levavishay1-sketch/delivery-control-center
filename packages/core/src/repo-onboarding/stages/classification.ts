import { eq } from "drizzle-orm";
import { db } from "@dcc/db";
import { repositoryProfile } from "@dcc/db/schema";
import { extractClaudeJson } from "../json.ts";
import { getActiveOnboardingPrompt } from "../prompts.ts";
import { createClaudeCodeRunner } from "../runner.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";

/**
 * Stage 03 — Repository Classification (spec §10). A cheap Claude call
 * fed only the deterministic scan's structured signals — explicitly NOT
 * full source-code discovery, no file access expected. Determines what
 * later stages (05/06) actually need to look at.
 */
type Classification = {
  repository_type: string; architecture_shape: string; legacy_indicator: boolean;
  detected_technology_stack: string[]; detected_domains: string[]; complexity: string;
  documentation_maturity: string; testing_maturity: string;
  discovery_areas_required: string[]; discovery_areas_not_required: string[];
  uncertainties: string[]; confidence: string;
};

registerStage("classification", async (ctx): Promise<StageOutcome> => {
  const scanResult = ctx.priorResults.repository_scan as { profileId?: string } | undefined;
  if (!scanResult?.profileId) return { status: "Failed", errors: ["repository_scan did not produce a profile"] };

  const [profile] = await db.select().from(repositoryProfile).where(eq(repositoryProfile.id, scanResult.profileId)).limit(1);
  if (!profile) return { status: "Failed", errors: [`repository_profile ${scanResult.profileId} not found`] };

  // Full signal set (minus ignoredPaths — irrelevant to classification,
  // would just bloat the prompt), richer than stage 02's compact
  // stage-row summary which was sized for the row, not for this.
  const scanForPrompt = {
    languages: profile.languages, buildSystems: profile.buildSystems, testSignals: profile.testSignals,
    ciSignals: profile.ciSignals, frameworkSignals: profile.frameworkSignals, docsSignals: profile.docsSignals,
    stats: profile.stats,
  };

  const prompt = await getActiveOnboardingPrompt("onboarding.classification");
  if (!prompt) return { status: "Failed", errors: ["no active prompt for onboarding.classification — run seed-prompts.ts"] };

  const runner = createClaudeCodeRunner();
  const result = await runner.run({
    runId: ctx.runId, stageKey: "classification", repoId: ctx.repoId, clientId: ctx.clientId,
    cwd: ctx.workspaceDir, promptId: prompt.id,
    promptVars: { REPOSITORY_SCAN: JSON.stringify(scanForPrompt) },
    permissionProfile: "read_only_plan", maxTurns: 10, timeoutMs: 120_000,
  });

  if (result.status !== "Completed" || !result.text) {
    return { status: "Failed", errors: [result.errorMessage ?? "classification call did not complete"], claudeExecutionId: result.executionId };
  }

  try {
    const classification = extractClaudeJson<Classification>(result.text);
    return { status: "Completed", claudeExecutionId: result.executionId, result: { claudeExecutionId: result.executionId, classification } };
  } catch (e) {
    // Foundational — later stages (04/05/06) read this directly, so a
    // parse failure must be visible and retryable, not silently downgraded.
    return { status: "Failed", errors: [String((e as Error).message)], claudeExecutionId: result.executionId };
  }
});
