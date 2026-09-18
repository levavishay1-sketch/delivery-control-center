import { eq } from "drizzle-orm";
import { db, withTenant } from "@dcc/db";
import { onboardingPromptTemplate, repositoryOnboardingClaudeExecution } from "@dcc/db/schema";
import { runClaudeRaw, stopFlowRun, sendRunMessage, claudeCliCaps, type RunMeta } from "../ai-assist.ts";
import { renderPrompt } from "../prompts.ts";
import { route, type Capability, type Effort, type RoutingSignals } from "../routing.ts";
import { extractClaudeJson } from "./json.ts";

/**
 * `ClaudeCodeRunner` — the ONE thing in the onboarding pipeline allowed to
 * know Claude Code CLI details. Every stage calls this interface, never
 * `runClaudeRaw` or a raw flag directly.
 *
 * v2 contract, grounded in the CLI's documented behaviour:
 *  - every call is `--restricted --tools <exact list>`: no Bash unless a
 *    stage names it (none does), file tools confined to the worktree, and
 *    the repository's own `.claude/settings.json` hooks and `.mcp.json`
 *    servers are never executed on the operator's machine;
 *  - `--permission-prompts none`: a write the mode can't auto-approve (e.g.
 *    anything under `.claude/`, a protected path) is DENIED and listed in
 *    `permission_denials`, instead of the model narrating "I couldn't get
 *    approval" in prose while the stage reports success;
 *  - `--json-schema` for structured results, with a text-parse fallback
 *    for CLIs/platforms where the flag can't be passed;
 *  - `--max-budget-usd` from the model-routing policy: a runaway
 *    exploration stops at the cap rather than at the timeout.
 *
 * Persists one `repository_onboarding_claude_execution` row per call
 * (Running before, Completed/Failed + usage after). The execution id is
 * also the `runId` handed to `runClaudeRaw`, so the existing
 * `stopFlowRun` registry can cancel a live onboarding call.
 */

export type ClaudeExecutionRequest = {
  runId: string;
  stageKey: string;
  repoId: string;
  clientId: string;
  cwd: string;
  /** The exact immutable `onboarding_prompt_template` row to render. */
  promptId: string;
  promptVars: Record<string, string>;
  /** Model routing capability — picks model + budget from `config/model-policy.json`. */
  capability: Capability;
  signals?: RoutingSignals;
  /** A person's explicit model/effort choice for this stage, if they set
   *  one on the run — wins over the policy's recommendation per field. */
  modelOverride?: { model?: string; effort?: string };
  /** Built-in tools the call may use. Default: read-only trio. `[]` = none. */
  tools?: string[];
  denyRules?: string[];
  /** JSON Schema of the expected result; the runner returns it parsed as `json`. */
  jsonSchema?: Record<string, unknown>;
  maxTurns?: number;
  timeoutMs?: number;
};

export type ClaudeExecutionResult = {
  executionId: string;
  status: "Completed" | "Failed" | "Cancelled";
  text: string | null;
  /** Parsed structured output (schema-validated by the CLI when the flag
   *  was available, otherwise extracted from the text). Null on failure. */
  json: unknown;
  meta: RunMeta;
  model: string;
  effort: string;
  errorMessage: string | null;
};

export interface ClaudeCodeRunner {
  run(req: ClaudeExecutionRequest): Promise<ClaudeExecutionResult>;
  cancel(executionId: string): boolean;
  sendMessage(executionId: string, text: string): boolean;
}

export const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"] as const;

/** Live executions by onboarding run — lets the UI stop "the AI call this
 *  run is making right now" without knowing the execution id up front. */
const activeByRun = new Map<string, string>();
export function activeExecutionForRun(runId: string): string | null { return activeByRun.get(runId) ?? null; }
export function cancelActiveExecution(runId: string): boolean {
  const id = activeByRun.get(runId);
  return id ? stopFlowRun(id) : false;
}

const SCHEMA_FALLBACK_INSTRUCTION = (schema: Record<string, unknown>) =>
  `\n\nOUTPUT CONTRACT: respond with ONE JSON object only (no prose, no markdown fence) that validates against this JSON Schema:\n${JSON.stringify(schema)}`;

export function createClaudeCodeRunner(): ClaudeCodeRunner {
  return {
    async run(req) {
      const [tpl] = await db.select({ body: onboardingPromptTemplate.body }).from(onboardingPromptTemplate).where(eq(onboardingPromptTemplate.id, req.promptId)).limit(1);
      if (!tpl) throw new Error(`prompt template ${req.promptId} not found`);
      const decision = route(req.capability, req.signals ?? {}, undefined, req.modelOverride as { model?: string; effort?: Effort } | undefined);
      const caps = claudeCliCaps();
      // The schema goes through the flag when the CLI can take it; otherwise
      // the same contract is stated in the prompt and parsed from the text.
      const schemaViaFlag = !!req.jsonSchema && caps.jsonSchema && process.platform !== "win32";
      let renderedPrompt = renderPrompt(tpl.body, req.promptVars);
      if (req.jsonSchema && !schemaViaFlag) renderedPrompt += SCHEMA_FALLBACK_INSTRUCTION(req.jsonSchema);

      const [inserted] = await withTenant(req.clientId, (tx) =>
        tx.insert(repositoryOnboardingClaudeExecution).values({
          runId: req.runId,
          stageKey: req.stageKey,
          repoId: req.repoId,
          clientId: req.clientId,
          promptTemplateId: req.promptId,
          model: decision.model,
          effort: decision.effort,
          permissionProfile: (req.tools ?? [...READ_ONLY_TOOLS]).includes("Write") ? "restricted_write" : "restricted_read",
          denyRulesSnapshot: req.denyRules ?? [],
          status: "Running",
        }).returning({ id: repositoryOnboardingClaudeExecution.id }),
      );
      const executionId = inserted!.id;
      activeByRun.set(req.runId, executionId);

      try {
        const { text, meta } = await runClaudeRaw(req.cwd, renderedPrompt, {
          runId: executionId,
          model: decision.model,
          effort: decision.effort,
          maxTurns: req.maxTurns,
          timeoutMs: req.timeoutMs,
          denyRules: req.denyRules,
          restrictedTools: [...(req.tools ?? READ_ONLY_TOOLS)],
          jsonSchema: schemaViaFlag ? req.jsonSchema : undefined,
          budgetUsd: decision.budgetUsd,
          denyUnattendedPrompts: true,
          noSessionPersistence: true,
        });
        let json: unknown = null;
        let parseError: string | null = null;
        if (req.jsonSchema) {
          if (meta.structuredOutput !== undefined && meta.structuredOutput !== null) json = meta.structuredOutput;
          else {
            try { json = extractClaudeJson(text); } catch (e) { parseError = (e as Error).message; }
          }
        }
        await withTenant(req.clientId, (tx) =>
          tx.update(repositoryOnboardingClaudeExecution).set({
            status: parseError ? "Failed" : "Completed",
            resultText: text,
            resultJson: (json ?? { toolCalls: meta.toolCalls ?? {}, permissionDenials: meta.permissionDenials ?? [] }) as object,
            errorMessage: parseError,
            costUsd: meta.costUsd !== null ? String(meta.costUsd) : null,
            inputTokens: meta.inputTokens,
            outputTokens: meta.outputTokens,
            durationMs: meta.durationMs,
            numTurns: meta.numTurns,
            completedAt: new Date(),
          }).where(eq(repositoryOnboardingClaudeExecution.id, executionId)),
        );
        if (parseError) return { executionId, status: "Failed", text, json: null, meta, model: decision.model, effort: decision.effort, errorMessage: `structured output missing: ${parseError}` };
        return { executionId, status: "Completed", text, json, meta, model: decision.model, effort: decision.effort, errorMessage: null };
      } catch (e) {
        const message = String((e as Error).message ?? e);
        const status = message === "STOPPED_BY_USER" ? "Cancelled" : "Failed";
        await withTenant(req.clientId, (tx) =>
          tx.update(repositoryOnboardingClaudeExecution).set({
            status, errorMessage: message, completedAt: new Date(),
          }).where(eq(repositoryOnboardingClaudeExecution.id, executionId)),
        );
        const meta: RunMeta = { model: decision.model, effort: decision.effort, costUsd: null, inputTokens: null, outputTokens: null, durationMs: null, numTurns: null };
        return { executionId, status, text: null, json: null, meta, model: decision.model, effort: decision.effort, errorMessage: message };
      } finally {
        if (activeByRun.get(req.runId) === executionId) activeByRun.delete(req.runId);
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
