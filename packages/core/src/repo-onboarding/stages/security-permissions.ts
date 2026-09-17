import { and, eq } from "drizzle-orm";
import { db } from "@dcc/db";
import { repositoryOnboardingStage, repositoryProfile } from "@dcc/db/schema";
import { extractClaudeJson } from "../json.ts";
import { getActiveOnboardingPrompt } from "../prompts.ts";
import { createClaudeCodeRunner } from "../runner.ts";
import { resolveEffectivePolicy, type EffectivePolicy } from "../security-profiles.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";

/** The org no longer offers a per-repo profile choice (2026-09-17,
 *  confirmed with the user: the picker was unwanted complexity — every
 *  repo gets the same profile in practice). `config/security-profiles.json`
 *  and `resolveEffectivePolicy` stay: stage 11 (`guardrails`) still needs
 *  one resolved profile to build `.claude/settings.json` from. */
const FIXED_SECURITY_PROFILE_ID = "STANDARD_DEVELOPMENT";

/**
 * Stage 04 — Security & Permissions (spec §11). Two sources for the
 * suggested `Read` deny rules, both free-form human-editable before
 * approval:
 *   1. stage 02's own `ignoredPaths` — a deterministic scan against a
 *      fixed, always-correct junk-dir/extension list. Free, no Claude
 *      call, but only catches what that fixed list already knows about.
 *   2. one Claude call (2026-09-17 addition) against the real workspace
 *      checkout, asked to find repo-specific additions the fixed list
 *      can't — e.g. vendored dependencies under a non-standard folder
 *      name (the real gap that made #1 miss Altshuler Trade's `packages/`
 *      DLLs until someone found it live and hardcoded the fix). Seeded
 *      with #1's own rules as its `denyRules`, so the exploration itself
 *      never falls into the trap it exists to find more of.
 * The approved rules become every later Claude-calling stage's
 * `denyRules` — this is the gate that kept an earlier real run from
 * burning cost reading `bin`/`obj`/vendored DLLs.
 */
type SecurityPermissionsResult = {
  suggestedRules: string[]; ignoredPathCount: number;
  approvedRules?: string[]; approvedProfileId?: string; approvedAt?: string;
};

registerStage("security_permissions", async (ctx): Promise<StageOutcome> => {
  if (ctx.resumeInput !== undefined) {
    const input = ctx.resumeInput as { approvedRules?: unknown };
    if (!Array.isArray(input.approvedRules) || !input.approvedRules.every((r) => typeof r === "string")) {
      return { status: "Failed", errors: ["approvedRules must be a string[]"] };
    }
    const [ownRow] = await db.select().from(repositoryOnboardingStage)
      .where(and(eq(repositoryOnboardingStage.runId, ctx.runId), eq(repositoryOnboardingStage.stageKey, "security_permissions"))).limit(1);
    const prior = (ownRow?.result as SecurityPermissionsResult | null) ?? { suggestedRules: [], ignoredPathCount: 0 };
    const approvedRules = input.approvedRules as string[];
    const effectivePolicy: EffectivePolicy = resolveEffectivePolicy(FIXED_SECURITY_PROFILE_ID, approvedRules);
    const result: SecurityPermissionsResult & { effectivePolicy: EffectivePolicy } = {
      suggestedRules: prior.suggestedRules, ignoredPathCount: prior.ignoredPathCount,
      approvedRules, approvedProfileId: FIXED_SECURITY_PROFILE_ID, approvedAt: new Date().toISOString(), effectivePolicy,
    };
    return { status: "Completed", result };
  }

  const scanResult = ctx.priorResults.repository_scan as { profileId?: string } | undefined;
  if (!scanResult?.profileId) return { status: "Failed", errors: ["repository_scan did not produce a profile"] };
  const [profile] = await db.select().from(repositoryProfile).where(eq(repositoryProfile.id, scanResult.profileId)).limit(1);
  if (!profile) return { status: "Failed", errors: [`repository_profile ${scanResult.profileId} not found`] };
  const classification = ctx.priorResults.classification as { classification?: unknown } | undefined;

  const ignoredPaths = profile.ignoredPaths as { pattern: string; reason: string }[];
  const baselineRules = ignoredPaths.map((p) => p.pattern);

  const prompt = await getActiveOnboardingPrompt("onboarding.security_deny_rules_suggest");
  if (!prompt) return { status: "Failed", errors: ["no active prompt for onboarding.security_deny_rules_suggest — run seed-prompts.ts"] };

  const scanForPrompt = {
    languages: profile.languages, buildSystems: profile.buildSystems, testSignals: profile.testSignals,
    ciSignals: profile.ciSignals, frameworkSignals: profile.frameworkSignals, docsSignals: profile.docsSignals,
    stats: profile.stats,
  };

  const runner = createClaudeCodeRunner();
  const result = await runner.run({
    runId: ctx.runId, stageKey: "security_permissions", repoId: ctx.repoId, clientId: ctx.clientId,
    cwd: ctx.workspaceDir, promptId: prompt.id,
    promptVars: {
      BASELINE_RULES: JSON.stringify(baselineRules),
      REPOSITORY_SCAN: JSON.stringify(scanForPrompt),
      CLASSIFICATION: JSON.stringify(classification?.classification ?? {}),
    },
    // Light exploratory call — seeded with the baseline rules as its own
    // denyRules so it never wastes turns re-reading what #1 already found.
    permissionProfile: "read_only_plan", denyRules: baselineRules, maxTurns: 20, timeoutMs: 180_000,
  });

  let additionalRules: string[] = [];
  if (result.status === "Completed" && result.text) {
    try {
      const parsed = extractClaudeJson<{ additional_rules: { pattern: string; reason: string }[] }>(result.text);
      additionalRules = (parsed.additional_rules ?? []).map((r) => r.pattern);
    } catch {
      // Adaptive discovery is a bonus on top of the always-correct
      // deterministic baseline — a parse failure here degrades to
      // "no additional suggestions found", never blocks the stage.
      additionalRules = [];
    }
  }

  const suggestedRules = Array.from(new Set([...baselineRules, ...additionalRules]));
  const resultOut: SecurityPermissionsResult = { suggestedRules, ignoredPathCount: ignoredPaths.length };
  return { status: "WaitingForUser", claudeExecutionId: result.executionId, result: resultOut };
});
