import { commitWorkspaceChanges } from "../commit.ts";
import { getActiveOnboardingPrompt } from "../prompts.ts";
import { createClaudeCodeRunner } from "../runner.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";

/**
 * Stage 09 — CLAUDE.md Generation (spec §16). The official CLAUDE.md
 * generator — explicitly NOT `/init` (spec §33/decision carried over
 * from the user, reversing this session's earlier `/init`-as-source
 * decision). Real Read access to `docs/ai/*.md` (stage 08's output,
 * already on disk in this same workspace) — the prompt tells Claude to
 * read it directly rather than being handed its content as a variable,
 * so it can genuinely choose to reference rather than duplicate it.
 */
registerStage("claude_md_generation", async (ctx): Promise<StageOutcome> => {
  const security = ctx.priorResults.security_permissions as { approvedRules?: string[] } | undefined;
  if (!security?.approvedRules) return { status: "Failed", errors: ["security_permissions has not been approved"] };
  const classification = ctx.priorResults.classification as { classification?: unknown } | undefined;
  if (!classification?.classification) return { status: "Failed", errors: ["classification did not produce a result"] };

  const prompt = await getActiveOnboardingPrompt("onboarding.claude_md_generation");
  if (!prompt) return { status: "Failed", errors: ["no active prompt for onboarding.claude_md_generation — run seed-prompts.ts"] };

  const runner = createClaudeCodeRunner();
  const result = await runner.run({
    runId: ctx.runId, stageKey: "claude_md_generation", repoId: ctx.repoId, clientId: ctx.clientId,
    cwd: ctx.workspaceDir, promptId: prompt.id,
    promptVars: { CLASSIFICATION: JSON.stringify(classification.classification) },
    permissionProfile: "accept_edits", denyRules: [...security.approvedRules, "Bash"],
    maxTurns: 30, timeoutMs: 240_000,
  });

  if (result.status !== "Completed") {
    return { status: "Failed", errors: [result.errorMessage ?? "claude_md_generation call did not complete"], claudeExecutionId: result.executionId };
  }

  const { commitSha, filesChanged } = await commitWorkspaceChanges(ctx.workspaceDir, ctx.triggeredBy, "DCC: CLAUDE.md");
  // Defense in depth, not the primary fix: a write-mode call can report
  // "Completed" with real text (no thrown error) while having written
  // NO file at all — confirmed live, Claude's own permission layer can
  // silently decline a write and just explain why in its text response
  // instead of erroring. The root cause (a Windows short-name temp path
  // Claude's write-check distrusts) is fixed at the workspace-path
  // level, but this stage's one job IS writing CLAUDE.md — zero files
  // changed is never a legitimate outcome here, unlike knowledge
  // generation (§08) where "nothing justified" is a real, valid case.
  if (filesChanged.length === 0) {
    return {
      status: "Failed",
      errors: [`claude_md_generation reported Completed but wrote no file — Claude's own response: ${(result.text ?? "").slice(0, 300)}`],
      claudeExecutionId: result.executionId,
    };
  }
  return {
    status: "Completed", claudeExecutionId: result.executionId,
    result: { claudeExecutionId: result.executionId, filesWritten: filesChanged, commitSha },
  };
});
