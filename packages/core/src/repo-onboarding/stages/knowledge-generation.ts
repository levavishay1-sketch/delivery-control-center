import { commitWorkspaceChanges } from "../commit.ts";
import { getActiveOnboardingPrompt } from "../prompts.ts";
import { createClaudeCodeRunner } from "../runner.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";

/**
 * Stage 08 — Repository Knowledge Generation (spec §15). The pipeline's
 * first file-writing stage — real repo access, `accept_edits`, but
 * `Bash` explicitly denied alongside the approved read-deny rules: this
 * stage only ever needs to write `docs/ai/*.md`, never run a shell
 * command. Adaptive by design (the spec's own anti-goal: "do not
 * implement a fixed template") — Claude decides which of the 4 possible
 * files are actually justified, not this code.
 */
registerStage("knowledge_generation", async (ctx): Promise<StageOutcome> => {
  const security = ctx.priorResults.security_permissions as { approvedRules?: string[] } | undefined;
  if (!security?.approvedRules) return { status: "Failed", errors: ["security_permissions has not been approved"] };
  const discovery = ctx.priorResults.targeted_discovery as { discovery?: unknown } | undefined;
  if (!discovery?.discovery) return { status: "Failed", errors: ["targeted_discovery did not produce a result"] };
  const coverage = ctx.priorResults.knowledge_coverage as { coverage?: unknown } | undefined;
  const enrichment = ctx.priorResults.human_enrichment as { questions?: unknown; answers?: unknown } | undefined;

  const prompt = await getActiveOnboardingPrompt("onboarding.knowledge_generation");
  if (!prompt) return { status: "Failed", errors: ["no active prompt for onboarding.knowledge_generation — run seed-prompts.ts"] };

  const runner = createClaudeCodeRunner();
  const result = await runner.run({
    runId: ctx.runId, stageKey: "knowledge_generation", repoId: ctx.repoId, clientId: ctx.clientId,
    cwd: ctx.workspaceDir, promptId: prompt.id,
    promptVars: {
      DISCOVERY: JSON.stringify(discovery.discovery),
      KNOWLEDGE_COVERAGE: JSON.stringify(coverage?.coverage ?? {}),
      HUMAN_KNOWLEDGE: JSON.stringify({ questions: enrichment?.questions ?? [], answers: enrichment?.answers ?? [] }),
    },
    permissionProfile: "accept_edits", denyRules: [...security.approvedRules, "Bash"],
    maxTurns: 60, timeoutMs: 480_000,
  });

  if (result.status !== "Completed") {
    return { status: "Failed", errors: [result.errorMessage ?? "knowledge_generation call did not complete"], claudeExecutionId: result.executionId };
  }

  const { commitSha, filesChanged } = await commitWorkspaceChanges(ctx.workspaceDir, ctx.triggeredBy, "DCC: repository knowledge (docs/ai)");
  // Unlike claude_md_generation, zero files is a legitimate adaptive
  // outcome here in principle ("create only the artifacts that are
  // justified" — spec §15) — but it's also exactly what a silently-
  // declined write looks like (see claude_md_generation.ts's comment),
  // so flag it as a warning rather than trust it silently.
  const warnings = filesChanged.length === 0 ? ["knowledge_generation wrote no files — verify this repo genuinely had nothing durable to record, not a silently-declined write"] : [];
  return {
    status: warnings.length ? "CompletedWithWarnings" : "Completed", warnings, claudeExecutionId: result.executionId,
    result: { claudeExecutionId: result.executionId, filesWritten: filesChanged, commitSha },
  };
});
