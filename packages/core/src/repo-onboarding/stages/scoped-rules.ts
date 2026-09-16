import { extractClaudeJson, extractFencedBlock } from "../json.ts";
import { getActiveOnboardingPrompt } from "../prompts.ts";
import { createClaudeCodeRunner } from "../runner.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";

/**
 * Stage 10 — Scoped Rules Evaluation (spec §17). Two Claude calls per
 * candidate domain. Deliberately does NOT write `.claude/rules/*.md`
 * itself — found live: `.claude/` is one of Claude Code's own
 * "protected paths" (its docs: "never auto-approved, except in
 * `bypassPermissions` mode", which carries an explicit "only use in
 * isolated environments... where Claude Code cannot damage your host
 * system" warning this pipeline has no business adopting for a routine
 * onboarding stage). `acceptEdits` genuinely cannot push this write
 * through headless — reproduced live: the generation call reported
 * `status: "Completed"` with real drafted content in its text response,
 * but the file was never created (confirmed via `git diff`). Rather
 * than fight a deliberate Claude Code safety boundary, this stage
 * returns the drafted rule CONTENT as structured data for a human to
 * review and apply — which is a better fit for the spec's own later
 * "User Review" stage anyway, not a workaround.
 */
type Candidate = { domain: string; paths: string[]; rule_needed: boolean; reason: string; high_value_constraints?: string[] };
type DraftedRule = { domain: string; suggestedPath: string; content: string; claudeExecutionId: string };

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "rule";

registerStage("scoped_rules", async (ctx): Promise<StageOutcome> => {
  const security = ctx.priorResults.security_permissions as { approvedRules?: string[] } | undefined;
  if (!security?.approvedRules) return { status: "Failed", errors: ["security_permissions has not been approved"] };
  const classification = ctx.priorResults.classification as { classification?: unknown } | undefined;
  const discovery = ctx.priorResults.targeted_discovery as { discovery?: unknown } | undefined;
  if (!discovery?.discovery) return { status: "Failed", errors: ["targeted_discovery did not produce a result"] };

  const evalPrompt = await getActiveOnboardingPrompt("onboarding.scoped_rules_evaluate");
  if (!evalPrompt) return { status: "Failed", errors: ["no active prompt for onboarding.scoped_rules_evaluate — run seed-prompts.ts"] };

  const runner = createClaudeCodeRunner();
  const evalResult = await runner.run({
    runId: ctx.runId, stageKey: "scoped_rules", repoId: ctx.repoId, clientId: ctx.clientId,
    cwd: ctx.workspaceDir, promptId: evalPrompt.id,
    promptVars: { CLASSIFICATION: JSON.stringify(classification?.classification ?? {}), DISCOVERY: JSON.stringify(discovery.discovery) },
    permissionProfile: "read_only_plan", maxTurns: 15, timeoutMs: 180_000,
  });
  if (evalResult.status !== "Completed" || !evalResult.text) {
    return { status: "Failed", errors: [evalResult.errorMessage ?? "scoped_rules evaluation call did not complete"], claudeExecutionId: evalResult.executionId };
  }

  let candidates: Candidate[];
  try {
    candidates = extractClaudeJson<{ candidates: Candidate[] }>(evalResult.text).candidates ?? [];
  } catch (e) {
    return { status: "Failed", errors: [String((e as Error).message)], claudeExecutionId: evalResult.executionId };
  }

  const approved = candidates.filter((c) => c.rule_needed);
  if (approved.length === 0) {
    return { status: "Skipped", claudeExecutionId: evalResult.executionId, result: { candidates, draftedRules: [] } };
  }

  const genPrompt = await getActiveOnboardingPrompt("onboarding.scoped_rules_generate");
  if (!genPrompt) return { status: "Failed", errors: ["no active prompt for onboarding.scoped_rules_generate — run seed-prompts.ts"] };

  const draftedRules: DraftedRule[] = [];
  const warnings: string[] = [];
  for (const c of approved) {
    const suggestedPath = `.claude/rules/${slugify(c.domain)}.md`;
    // read_only_plan, not accept_edits — this call inspects representative
    // files (per spec: "before generating the rule, inspect...") but never
    // attempts a Write; it returns the rule body as a fenced Markdown
    // block instead of JSON — found live: asking Claude to hand-escape a
    // multi-paragraph doc into a JSON string field broke on an ordinary
    // quoted phrase in the prose (see json.ts's extractFencedBlock).
    const genResult = await runner.run({
      runId: ctx.runId, stageKey: "scoped_rules", repoId: ctx.repoId, clientId: ctx.clientId,
      cwd: ctx.workspaceDir, promptId: genPrompt.id,
      promptVars: { DOMAIN: c.domain, PATHS: c.paths.join(", "), OUTPUT_RULE_PATH: suggestedPath },
      permissionProfile: "read_only_plan", denyRules: security.approvedRules,
      maxTurns: 20, timeoutMs: 180_000,
    });
    if (genResult.status !== "Completed" || !genResult.text) {
      warnings.push(`rule for "${c.domain}" failed: ${genResult.errorMessage ?? "unknown error"}`);
      continue;
    }
    try {
      const content = extractFencedBlock(genResult.text);
      draftedRules.push({ domain: c.domain, suggestedPath, content, claudeExecutionId: genResult.executionId });
    } catch (e) {
      warnings.push(`rule for "${c.domain}" could not be parsed: ${String((e as Error).message)}`);
    }
  }

  return {
    status: warnings.length ? "CompletedWithWarnings" : "Completed",
    warnings, claudeExecutionId: evalResult.executionId,
    result: { claudeExecutionId: evalResult.executionId, candidates, draftedRules },
  };
});
