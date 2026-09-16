import { and, eq } from "drizzle-orm";
import { db } from "@dcc/db";
import { repositoryOnboardingStage } from "@dcc/db/schema";
import { extractClaudeJson } from "../json.ts";
import { getActiveOnboardingPrompt } from "../prompts.ts";
import { createClaudeCodeRunner } from "../runner.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";

/**
 * Stage 07 — Human Knowledge Enrichment (spec §14). Two-phase: a Claude
 * call reviews stage 06's discovery and proposes up to 10 high-value
 * questions only a person can answer (external consumers, legacy
 * restrictions, backward-compat, ...) — never questions answerable by
 * reading more code. Zero questions completes immediately (Skipped), no
 * human interaction needed. Otherwise waits for answers; resuming needs
 * no second Claude call, just persisting what was typed.
 */
type Question = { id: string; question_he: string; why_it_matters_he: string; risk_if_unknown: "LOW" | "MEDIUM" | "HIGH"; related_repository_area: string };
type Answer = { id: string; answer_he: string };
type HumanEnrichmentResult = { questions: Question[]; answers?: Answer[]; answeredAt?: string };

registerStage("human_enrichment", async (ctx): Promise<StageOutcome> => {
  if (ctx.resumeInput !== undefined) {
    const input = ctx.resumeInput as { answers?: unknown };
    if (!Array.isArray(input.answers) || !input.answers.every((a) => a && typeof (a as Answer).id === "string" && typeof (a as Answer).answer_he === "string")) {
      return { status: "Failed", errors: ["answers must be an Array<{id, answer_he}>"] };
    }
    const [ownRow] = await db.select().from(repositoryOnboardingStage)
      .where(and(eq(repositoryOnboardingStage.runId, ctx.runId), eq(repositoryOnboardingStage.stageKey, "human_enrichment"))).limit(1);
    const prior = ownRow?.result as HumanEnrichmentResult | null;
    if (!prior) return { status: "Failed", errors: ["no prior questions found to answer"] };
    const answers = input.answers as Answer[];
    const missing = prior.questions.filter((q) => !answers.some((a) => a.id === q.id));
    if (missing.length) return { status: "Failed", errors: [`missing answers for: ${missing.map((q) => q.id).join(", ")}`] };
    const result: HumanEnrichmentResult = { questions: prior.questions, answers, answeredAt: new Date().toISOString() };
    return { status: "Completed", result };
  }

  const discovery = ctx.priorResults.targeted_discovery as { discovery?: unknown } | undefined;
  if (!discovery?.discovery) return { status: "Failed", errors: ["targeted_discovery did not produce a result"] };
  const security = ctx.priorResults.security_permissions as { approvedRules?: string[] } | undefined;

  const prompt = await getActiveOnboardingPrompt("onboarding.human_enrichment_questions");
  if (!prompt) return { status: "Failed", errors: ["no active prompt for onboarding.human_enrichment_questions — run seed-prompts.ts"] };

  const runner = createClaudeCodeRunner();
  const result = await runner.run({
    runId: ctx.runId, stageKey: "human_enrichment", repoId: ctx.repoId, clientId: ctx.clientId,
    cwd: ctx.workspaceDir, promptId: prompt.id,
    promptVars: { DISCOVERY: JSON.stringify(discovery.discovery) },
    permissionProfile: "read_only_plan", denyRules: security?.approvedRules, maxTurns: 10, timeoutMs: 120_000,
  });

  if (result.status !== "Completed" || !result.text) {
    return { status: "Failed", errors: [result.errorMessage ?? "human_enrichment call did not complete"], claudeExecutionId: result.executionId };
  }

  try {
    const parsed = extractClaudeJson<{ questions: Question[] }>(result.text);
    const questions = parsed.questions ?? [];
    if (questions.length === 0) {
      return { status: "Skipped", claudeExecutionId: result.executionId, result: { questions: [] } };
    }
    return { status: "WaitingForUser", claudeExecutionId: result.executionId, result: { questions } };
  } catch (e) {
    return { status: "Failed", errors: [String((e as Error).message)], claudeExecutionId: result.executionId };
  }
});
