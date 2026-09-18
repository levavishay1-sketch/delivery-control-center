import { loadProfileCatalog, resolveEffectivePolicy, type EffectivePolicy } from "../security-profiles.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";
import type { ExistingConfigPolicy, ScanResult } from "./scan.ts";

/**
 * Stage 2 — Boundaries. The first human gate: what the AI may read, which
 * security profile the generated settings follow, what happens to AI
 * configuration the repo already has, and any correction to the
 * classification. Writes nothing; its approved output gates every AI
 * call from here on and feeds the generated `.claude/settings.json`.
 */
export type BoundariesApproved = {
  rules: string[];
  profileId: string;
  existingConfig: Record<string, ExistingConfigPolicy>;
  classificationOverride?: string;
  notes?: string;
};
export type BoundariesResult = {
  suggestedRules: { pattern: string; reason: string }[];
  suggestedProfileId: string;
  profiles: { id: string; label: string; description: string }[];
  existing: ScanResult["suggestions"]["existingConfig"];
  classification: ScanResult["classification"];
  /** Pre-filled from the previous run on a refresh. */
  carriedOver?: boolean;
  approved?: BoundariesApproved;
  effectivePolicy?: EffectivePolicy;
  approvedAt?: string;
};

const VALID_POLICY = new Set<ExistingConfigPolicy>(["keep", "merge", "replace"]);

registerStage("boundaries", async (ctx): Promise<StageOutcome> => {
  const scan = ctx.priorResults.scan as ScanResult | undefined;
  if (!scan) return { status: "Failed", errors: ["scan did not complete"] };

  if (ctx.resumeInput !== undefined) {
    const input = ctx.resumeInput as Partial<BoundariesApproved> & { rules?: unknown; profileId?: unknown; existingConfig?: unknown };
    if (!Array.isArray(input.rules) || !input.rules.every((r) => typeof r === "string")) return { status: "Failed", errors: ["rules must be a string[]"] };
    const catalog = loadProfileCatalog();
    if (typeof input.profileId !== "string" || !catalog.profiles[input.profileId]) return { status: "Failed", errors: [`profileId must be one of: ${Object.keys(catalog.profiles).join(", ")}`] };
    const existingConfig: Record<string, ExistingConfigPolicy> = {};
    for (const e of scan.suggestions.existingConfig) {
      const v = (input.existingConfig as Record<string, unknown> | undefined)?.[e.path];
      existingConfig[e.path] = typeof v === "string" && VALID_POLICY.has(v as ExistingConfigPolicy) ? (v as ExistingConfigPolicy) : e.suggested;
    }
    const prior = (ctx.ownResult as BoundariesResult | undefined) ?? waitingResult(scan, ctx.previousResults?.boundaries as BoundariesResult | undefined);
    const approved: BoundariesApproved = {
      rules: Array.from(new Set(input.rules as string[])), profileId: input.profileId, existingConfig,
      classificationOverride: typeof input.classificationOverride === "string" && input.classificationOverride.trim() ? input.classificationOverride.trim() : undefined,
      notes: typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : undefined,
    };
    const result: BoundariesResult = { ...prior, approved, effectivePolicy: resolveEffectivePolicy(approved.profileId, approved.rules), approvedAt: new Date().toISOString() };
    return { status: "Completed", result };
  }

  return { status: "WaitingForUser", result: waitingResult(scan, ctx.previousResults?.boundaries as BoundariesResult | undefined) };
}, (waiting) => {
  // Auto-resolve: the suggestions as shown (or the previous run's approval on a refresh).
  const w = waiting as BoundariesResult;
  const prev = w.approved;
  const existingConfig: Record<string, ExistingConfigPolicy> = {};
  for (const e of w.existing) existingConfig[e.path] = prev?.existingConfig?.[e.path] ?? e.suggested;
  return { rules: prev?.rules ?? w.suggestedRules.map((r) => r.pattern), profileId: prev?.profileId ?? w.suggestedProfileId, existingConfig, notes: prev?.notes, classificationOverride: prev?.classificationOverride };
});

function waitingResult(scan: ScanResult, previous: BoundariesResult | undefined): BoundariesResult {
  const profiles = Object.entries(loadProfileCatalog().profiles).map(([id, p]) => ({ id, label: p.label, description: p.description }));
  const base: BoundariesResult = {
    suggestedRules: scan.suggestions.denyRules, suggestedProfileId: scan.suggestions.profileId, profiles,
    existing: scan.suggestions.existingConfig, classification: scan.classification,
  };
  if (previous?.approved) {
    // A refresh pre-fills what was approved last time (still shown for confirmation).
    const prevRules = new Set(previous.approved.rules);
    return { ...base, carriedOver: true, suggestedRules: [...base.suggestedRules.filter((r) => !prevRules.has(r.pattern)), ...previous.approved.rules.map((p) => ({ pattern: p, reason: "approved previously" }))], suggestedProfileId: previous.approved.profileId, approved: previous.approved };
  }
  return base;
}
