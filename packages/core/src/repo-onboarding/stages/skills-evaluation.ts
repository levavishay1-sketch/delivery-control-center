import { extractClaudeJson, extractFencedBlock } from "../json.ts";
import { getActiveOnboardingPrompt } from "../prompts.ts";
import { createClaudeCodeRunner } from "../runner.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";

/**
 * Stage — Skills Evaluation (spec §18 Stage 11), Phase 6. Architecturally
 * a near-exact mirror of `scoped-rules.ts` (Phase 3): an evaluation call
 * proposes candidates, a generation call drafts each approved one as
 * data (never written to disk — this stage runs AFTER `ai_ready`, so the
 * onboarding branch for this run is already reviewed/pushed/merged;
 * materializing a Skill here would need its own separate commit+push+PR
 * cycle, disproportionate for the spec's own most-optional artifact).
 * Uses `extractFencedBlock`, not JSON, for the drafted `SKILL.md` body
 * from the start — Phase 3 found live that hand-escaping long-form prose
 * into a JSON string field breaks on an ordinary quoted phrase; no
 * reason to rediscover that here.
 */
type Candidate = {
  skill_name: string; trigger: string; purpose: string;
  workflow_steps: string[]; expected_reuse_value: string;
  recommendation: "CREATE" | "DO_NOT_CREATE";
};
type DraftedSkill = { skillName: string; suggestedPath: string; content: string; claudeExecutionId: string };

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "skill";

registerStage("skills_evaluation", async (ctx): Promise<StageOutcome> => {
  const security = ctx.priorResults.security_permissions as { approvedRules?: string[] } | undefined;
  if (!security?.approvedRules) return { status: "Failed", errors: ["security_permissions has not been approved"] };
  const classification = ctx.priorResults.classification as { classification?: unknown } | undefined;
  const discovery = ctx.priorResults.targeted_discovery as { discovery?: unknown } | undefined;
  if (!discovery?.discovery) return { status: "Failed", errors: ["targeted_discovery did not produce a result"] };

  const evalPrompt = await getActiveOnboardingPrompt("onboarding.skills_evaluate");
  if (!evalPrompt) return { status: "Failed", errors: ["no active prompt for onboarding.skills_evaluate — run seed-prompts.ts"] };

  const runner = createClaudeCodeRunner();
  const evalResult = await runner.run({
    runId: ctx.runId, stageKey: "skills_evaluation", repoId: ctx.repoId, clientId: ctx.clientId,
    cwd: ctx.workspaceDir, promptId: evalPrompt.id,
    promptVars: { CLASSIFICATION: JSON.stringify(classification?.classification ?? {}), DISCOVERY: JSON.stringify(discovery.discovery) },
    permissionProfile: "read_only_plan", maxTurns: 15, timeoutMs: 180_000,
  });
  if (evalResult.status !== "Completed" || !evalResult.text) {
    return { status: "Failed", errors: [evalResult.errorMessage ?? "skills_evaluation evaluation call did not complete"], claudeExecutionId: evalResult.executionId };
  }

  let candidates: Candidate[];
  try {
    candidates = extractClaudeJson<{ candidates: Candidate[] }>(evalResult.text).candidates ?? [];
  } catch (e) {
    return { status: "Failed", errors: [String((e as Error).message)], claudeExecutionId: evalResult.executionId };
  }

  const approved = candidates.filter((c) => c.recommendation === "CREATE");
  if (approved.length === 0) {
    return { status: "Skipped", claudeExecutionId: evalResult.executionId, result: { candidates, draftedSkills: [] } };
  }

  const genPrompt = await getActiveOnboardingPrompt("onboarding.skills_generate");
  if (!genPrompt) return { status: "Failed", errors: ["no active prompt for onboarding.skills_generate — run seed-prompts.ts"] };

  const draftedSkills: DraftedSkill[] = [];
  const warnings: string[] = [];
  for (const c of approved) {
    const suggestedPath = `.claude/skills/${slugify(c.skill_name)}/SKILL.md`;
    // read_only_plan — inspects representative files but never attempts
    // a Write; returns the SKILL.md body as a fenced Markdown block.
    const genResult = await runner.run({
      runId: ctx.runId, stageKey: "skills_evaluation", repoId: ctx.repoId, clientId: ctx.clientId,
      cwd: ctx.workspaceDir, promptId: genPrompt.id,
      promptVars: {
        SKILL_NAME: c.skill_name, TRIGGER: c.trigger, PURPOSE: c.purpose,
        WORKFLOW_STEPS: c.workflow_steps.join(" → "), OUTPUT_SKILL_PATH: suggestedPath,
      },
      permissionProfile: "read_only_plan", denyRules: security.approvedRules,
      maxTurns: 20, timeoutMs: 180_000,
    });
    if (genResult.status !== "Completed" || !genResult.text) {
      warnings.push(`skill "${c.skill_name}" failed: ${genResult.errorMessage ?? "unknown error"}`);
      continue;
    }
    try {
      const content = extractFencedBlock(genResult.text);
      draftedSkills.push({ skillName: c.skill_name, suggestedPath, content, claudeExecutionId: genResult.executionId });
    } catch (e) {
      warnings.push(`skill "${c.skill_name}" could not be parsed: ${String((e as Error).message)}`);
    }
  }

  return {
    status: warnings.length ? "CompletedWithWarnings" : "Completed",
    warnings, claudeExecutionId: evalResult.executionId,
    result: { claudeExecutionId: evalResult.executionId, candidates, draftedSkills },
  };
});
