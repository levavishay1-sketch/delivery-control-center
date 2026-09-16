import { eq } from "drizzle-orm";
import { db, withTenant } from "@dcc/db";
import { onboardingPromptTemplate, repositoryOnboardingClaudeExecution } from "@dcc/db/schema";
import { runClaudeRaw, stopFlowRun, sendRunMessage, type RunMeta } from "../ai-assist.ts";
import { renderPrompt } from "../prompts.ts";

/**
 * `ClaudeCodeRunner` — the ONE thing in the onboarding pipeline allowed to
 * know Claude Code CLI flag details (spec §2 "Critical Technical
 * Constraint"). Everything else calls this interface, never `runClaudeRaw`
 * or a raw CLI flag directly, so CLI-flag churn never ripples through
 * stage-handler code.
 *
 * Wraps `runClaudeRaw` 1:1 for the actual spawn, but owns strictly more:
 * it persists the `repository_onboarding_claude_execution` row itself
 * (Running before the call, Completed/Failed + meta after) — today that
 * bookkeeping is scattered inline across every `ai-assist.ts` caller;
 * centralizing it here is the point of the abstraction. Because it passes
 * its own `executionId` straight through as `runClaudeRaw`'s `opts.runId`,
 * the EXISTING exported `stopFlowRun`/`sendRunMessage` cancellation
 * machinery already works against it — no second registry needed.
 */

export type PermissionProfile = "read_only_plan" | "accept_edits";

export type ClaudeExecutionRequest = {
  runId: string;
  stageKey: string;
  repoId: string;
  clientId: string;
  cwd: string;
  /** The exact immutable `onboarding_prompt_template` row id to use —
   *  resolution of "which version is active" is the caller's job
   *  (`getActiveOnboardingPrompt`), not the runner's. */
  promptId: string;
  promptVars: Record<string, string>;
  permissionProfile: PermissionProfile;
  denyRules?: string[];
  model?: string;
  maxTurns?: number;
  timeoutMs?: number;
};

export type ClaudeExecutionResult = {
  executionId: string;
  status: "Completed" | "Failed" | "Cancelled";
  text: string | null;
  meta: RunMeta;
  errorMessage: string | null;
};

export interface ClaudeCodeRunner {
  run(req: ClaudeExecutionRequest): Promise<ClaudeExecutionResult>;
  cancel(executionId: string): boolean;
  sendMessage(executionId: string, text: string): boolean;
}

function toRunClaudeOpts(req: ClaudeExecutionRequest, executionId: string) {
  return {
    runId: executionId,
    write: req.permissionProfile === "accept_edits",
    model: req.model,
    maxTurns: req.maxTurns,
    timeoutMs: req.timeoutMs,
    denyRules: req.denyRules,
  };
}

export function createClaudeCodeRunner(): ClaudeCodeRunner {
  return {
    async run(req) {
      const [tpl] = await db.select({ body: onboardingPromptTemplate.body }).from(onboardingPromptTemplate).where(eq(onboardingPromptTemplate.id, req.promptId)).limit(1);
      if (!tpl) throw new Error(`prompt template ${req.promptId} not found`);
      const renderedPrompt = renderPrompt(tpl.body, req.promptVars);

      const [inserted] = await withTenant(req.clientId, (tx) =>
        tx.insert(repositoryOnboardingClaudeExecution).values({
          runId: req.runId,
          stageKey: req.stageKey,
          repoId: req.repoId,
          clientId: req.clientId,
          promptTemplateId: req.promptId,
          model: req.model ?? null,
          permissionProfile: req.permissionProfile,
          denyRulesSnapshot: req.denyRules ?? [],
          status: "Running",
        }).returning({ id: repositoryOnboardingClaudeExecution.id }),
      );
      const executionId = inserted!.id;

      try {
        const { text, meta } = await runClaudeRaw(req.cwd, renderedPrompt, toRunClaudeOpts(req, executionId));
        await withTenant(req.clientId, (tx) =>
          tx.update(repositoryOnboardingClaudeExecution).set({
            status: "Completed",
            resultText: text,
            costUsd: meta.costUsd !== null ? String(meta.costUsd) : null,
            inputTokens: meta.inputTokens,
            outputTokens: meta.outputTokens,
            durationMs: meta.durationMs,
            numTurns: meta.numTurns,
            completedAt: new Date(),
          }).where(eq(repositoryOnboardingClaudeExecution.id, executionId)),
        );
        return { executionId, status: "Completed", text, meta, errorMessage: null };
      } catch (e) {
        const message = String((e as Error).message ?? e);
        const status = message === "STOPPED_BY_USER" ? "Cancelled" : "Failed";
        await withTenant(req.clientId, (tx) =>
          tx.update(repositoryOnboardingClaudeExecution).set({
            status, errorMessage: message, completedAt: new Date(),
          }).where(eq(repositoryOnboardingClaudeExecution.id, executionId)),
        );
        const meta: RunMeta = { model: req.model ?? null, costUsd: null, inputTokens: null, outputTokens: null, durationMs: null, numTurns: null };
        return { executionId, status, text: null, meta, errorMessage: message };
      }
    },
    cancel(executionId) {
      return stopFlowRun(executionId);
    },
    sendMessage(executionId, text) {
      return sendRunMessage(executionId, text);
    },
  };
}
