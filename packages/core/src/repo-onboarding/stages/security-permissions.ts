import { and, eq } from "drizzle-orm";
import { db } from "@dcc/db";
import { repositoryOnboardingStage, repositoryProfile } from "@dcc/db/schema";
import { loadProfileCatalog, resolveEffectivePolicy, suggestSecurityProfile, type EffectivePolicy } from "../security-profiles.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";

/**
 * Stage 04 — Security & Permissions (spec §11). Deterministic, no Claude
 * call — reuses stage 02's own `ignoredPaths` (same dir-name/extension
 * deny-rule detection the old flow's step 2 used) as the starting
 * suggestion, human reviews/edits/approves. The approved rules become
 * every later Claude-calling stage's `denyRules` — this is the gate that
 * kept an earlier real run from burning cost reading `bin`/`obj`/vendored
 * DLLs (the exact failure this whole mechanism exists to prevent).
 *
 * Phase 4 addition: also suggests/approves a named security profile from
 * `config/security-profiles.json` (spec's "Organization Policy" layer) —
 * the resolved `EffectivePolicy` (profile + approved deny rules as the
 * "repository-specific Delta") is stage 11 (`guardrails`)'s input for the
 * one real `.claude/settings.json` write; this stage itself still never
 * touches the filesystem.
 */
type SecurityPermissionsResult = {
  suggestedRules: string[]; ignoredPathCount: number; suggestedProfileId: string;
  /** Full catalog, embedded so the UI can render all 5 options with
   *  their Hebrew label/description without a second round-trip. */
  profiles: { id: string; label: string; description: string }[];
  approvedRules?: string[]; approvedProfileId?: string; approvedAt?: string;
};

registerStage("security_permissions", async (ctx): Promise<StageOutcome> => {
  if (ctx.resumeInput !== undefined) {
    const input = ctx.resumeInput as { approvedRules?: unknown; approvedProfileId?: unknown };
    if (!Array.isArray(input.approvedRules) || !input.approvedRules.every((r) => typeof r === "string")) {
      return { status: "Failed", errors: ["approvedRules must be a string[]"] };
    }
    if (typeof input.approvedProfileId !== "string" || !loadProfileCatalog().profiles[input.approvedProfileId]) {
      return { status: "Failed", errors: [`approvedProfileId must be one of: ${Object.keys(loadProfileCatalog().profiles).join(", ")}`] };
    }
    const [ownRow] = await db.select().from(repositoryOnboardingStage)
      .where(and(eq(repositoryOnboardingStage.runId, ctx.runId), eq(repositoryOnboardingStage.stageKey, "security_permissions"))).limit(1);
    const prior = (ownRow?.result as SecurityPermissionsResult | null) ?? { suggestedRules: [], ignoredPathCount: 0, suggestedProfileId: "STANDARD_DEVELOPMENT", profiles: [] };
    const approvedRules = input.approvedRules as string[];
    const approvedProfileId = input.approvedProfileId;
    const effectivePolicy: EffectivePolicy = resolveEffectivePolicy(approvedProfileId, approvedRules);
    const result: SecurityPermissionsResult & { effectivePolicy: EffectivePolicy } = {
      suggestedRules: prior.suggestedRules, ignoredPathCount: prior.ignoredPathCount, suggestedProfileId: prior.suggestedProfileId, profiles: prior.profiles,
      approvedRules, approvedProfileId, approvedAt: new Date().toISOString(), effectivePolicy,
    };
    return { status: "Completed", result };
  }

  const scanResult = ctx.priorResults.repository_scan as { profileId?: string } | undefined;
  if (!scanResult?.profileId) return { status: "Failed", errors: ["repository_scan did not produce a profile"] };
  const [profile] = await db.select().from(repositoryProfile).where(eq(repositoryProfile.id, scanResult.profileId)).limit(1);
  if (!profile) return { status: "Failed", errors: [`repository_profile ${scanResult.profileId} not found`] };
  const classification = ctx.priorResults.classification as { classification?: Parameters<typeof suggestSecurityProfile>[0] } | undefined;

  const ignoredPaths = profile.ignoredPaths as { pattern: string; reason: string }[];
  const suggestedRules = ignoredPaths.map((p) => p.pattern);
  const suggestedProfileId = suggestSecurityProfile(classification?.classification);
  const profiles = Object.entries(loadProfileCatalog().profiles).map(([id, p]) => ({ id, label: p.label, description: p.description }));
  const result: SecurityPermissionsResult = { suggestedRules, ignoredPathCount: ignoredPaths.length, suggestedProfileId, profiles };
  return { status: "WaitingForUser", result };
});
