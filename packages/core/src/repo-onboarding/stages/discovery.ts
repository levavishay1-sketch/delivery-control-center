import { renderInventoryForPrompt } from "../inventory.ts";
import { getActiveOnboardingPrompt } from "../prompts.ts";
import { createClaudeCodeRunner, READ_ONLY_TOOLS } from "../runner.ts";
import { DISCOVERY_SCHEMA } from "../schemas.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";
import type { BoundariesResult } from "./boundaries.ts";
import type { ScanResult } from "./scan.ts";

/**
 * Stage 3 — Discovery. One read-only, budgeted AI call over the real
 * repository: existing-documentation coverage first (so nothing already
 * written gets re-written), then a targeted operating model grounded in
 * inspected files, then the questions only a person can answer. The v1
 * pipeline spent three calls (coverage, discovery, question generation)
 * re-reading the same files; the same context now does all three.
 */
export type DiscoveryQuestion = { id: string; question_he: string; why_it_matters_he: string; risk_if_unknown: "LOW" | "MEDIUM" | "HIGH"; related_area?: string };
export type Discovery = {
  purpose: string;
  coverage: { area: string; status: "COVERED" | "PARTIAL" | "MISSING"; sources?: string[]; note?: string }[];
  components: { name: string; purpose?: string; paths: string[]; evidence?: string[] }[];
  entry_points?: { name?: string; path: string; how_to_run?: string }[];
  boundaries?: { description: string; paths?: string[] }[];
  key_flows?: { name: string; steps?: string[]; paths?: string[] }[];
  integrations?: { system: string; direction?: string; paths?: string[]; constraints?: string[] }[];
  generated_or_protected_areas?: { path: string; reason: string; kind?: string }[];
  build_test?: { name: string; command: string; cwd?: string; evidence?: string; confidence: "low" | "medium" | "high" }[];
  constraints?: { statement: string; evidence?: string; severity?: string }[];
  where_to_look?: { task_type: string; paths: string[]; note?: string }[];
  existing_instructions_assessment?: {
    path: string;
    verdict: "keep" | "merge" | "outdated" | "conflicting";
    reason?: string;
    /** Whether the file is still the right SHAPE, independent of whether
     *  its content is still true — judged on the same read. */
    reshape?: "none" | "supersede_with_skill" | "consolidate" | "redundant";
    reshape_note_he?: string;
    reshape_target?: string;
  }[];
  /** The existing AI setup as a whole, in one paragraph. */
  existing_setup_summary_he?: string;
  unknowns: string[];
  questions: DiscoveryQuestion[];
  evidence_paths?: string[];
};
export type DiscoveryResult = { discovery: Discovery; claudeExecutionId: string; stats: { toolCalls: Record<string, number>; costUsd: number | null; numTurns: number | null } };

registerStage("discovery", async (ctx): Promise<StageOutcome> => {
  const scan = ctx.priorResults.scan as ScanResult | undefined;
  const boundaries = ctx.priorResults.boundaries as BoundariesResult | undefined;
  if (!scan) return { status: "Failed", errors: ["scan did not complete"] };
  if (!boundaries?.approved) return { status: "Failed", errors: ["boundaries have not been approved"] };

  const prompt = await getActiveOnboardingPrompt("onboarding.v2.discover");
  if (!prompt) return { status: "Failed", errors: ["no active prompt for onboarding.v2.discover — run seed-prompts.ts"] };

  const previous = ctx.previousResults?.discovery as DiscoveryResult | undefined;
  const previousConfirm = ctx.previousResults?.confirm as { questions?: DiscoveryQuestion[]; answers?: { id: string; answer_he: string; status: string }[] } | undefined;
  const humanNotes = [
    boundaries.approved.classificationOverride ? `Classification correction from the team: ${boundaries.approved.classificationOverride}` : "",
    boundaries.approved.notes ? `Notes from the team: ${boundaries.approved.notes}` : "",
    previousConfirm?.answers?.length
      ? `Answers the team already gave in a previous onboarding (do not ask again):\n${previousConfirm.answers.filter((a) => a.status === "answered").map((a) => `- Q: ${previousConfirm.questions?.find((q) => q.id === a.id)?.question_he ?? a.id}\n  A: ${a.answer_he}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n\n") || "(none)";

  const classificationText = JSON.stringify(scan.classification ?? { note: "automatic classification failed — infer from the scan" });
  const runner = createClaudeCodeRunner();
  const exec = await runner.run({
    runId: ctx.runId, stageKey: "discovery", repoId: ctx.repoId, clientId: ctx.clientId, cwd: ctx.workspaceDir,
    promptId: prompt.id, capability: "onboarding_discover", signals: { complexity: scan.classification?.complexity }, modelOverride: ctx.modelChoices.discovery,
    tools: [...READ_ONLY_TOOLS], denyRules: boundaries.approved.rules, jsonSchema: DISCOVERY_SCHEMA as unknown as Record<string, unknown>,
    promptVars: {
      CLASSIFICATION: classificationText,
      REPOSITORY_SCAN: JSON.stringify(scan.profile),
      INVENTORY: renderInventoryForPrompt(scan.inventory),
      HUMAN_NOTES: humanNotes,
      MODE: ctx.mode,
      CHANGED_PATHS: ctx.mode === "refresh" ? JSON.stringify(scan.changedSincePrevious ?? []) : "(initial onboarding — not applicable)",
      PREVIOUS_MODEL: ctx.mode === "refresh" && previous ? JSON.stringify(previous.discovery) : "(initial onboarding — none)",
    },
    maxTurns: 90, timeoutMs: 1_200_000,
  });

  if (exec.status !== "Completed" || !exec.json) {
    return { status: "Failed", errors: [exec.errorMessage ?? "discovery call did not complete"], claudeExecutionId: exec.executionId };
  }
  const discovery = exec.json as Discovery;
  discovery.questions = (discovery.questions ?? []).slice(0, 10).map((q, i) => ({ ...q, id: q.id || `q${i + 1}` }));
  discovery.unknowns = discovery.unknowns ?? [];
  const warnings: string[] = [];
  if ((exec.meta.permissionDenials?.length ?? 0) > 0) warnings.push(`${exec.meta.permissionDenials!.length} פעולות נחסמו במהלך ה-Discovery (ראו פרטי הקריאה)`);
  const result: DiscoveryResult = {
    discovery, claudeExecutionId: exec.executionId,
    stats: { toolCalls: exec.meta.toolCalls ?? {}, costUsd: exec.meta.costUsd, numTurns: exec.meta.numTurns },
  };
  return { status: warnings.length ? "CompletedWithWarnings" : "Completed", warnings, claudeExecutionId: exec.executionId, result };
});
