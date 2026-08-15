import { z } from "zod";
import type { FindingSeverity, StageType } from "@/generated/prisma/client";

/** Validates a CLARIFY draft's structured questions output before it's ever treated as authoritative. */
export const clarifyQuestionsSchema = z.array(z.string().min(1)).min(1);

const findingSeveritySchema = z.enum(["INFO", "WARNING", "MEDIUM", "HIGH", "CRITICAL"]);
const relatedStageTypeSchema = z.enum(["CONSTITUTION", "SPEC", "PLAN", "TASKS", "DEPLOY", "CLARIFY", "ANALYZE", "IMPLEMENT"]);

/**
 * Validates an ANALYZE draft's structured findings output before it's ever treated as
 * authoritative — same "AI output -> schema -> domain command" discipline as Clarify (see
 * design.md Decision 8). An empty array is valid: it means the AI checked and found nothing,
 * not that it failed to answer.
 */
export const analysisFindingsSchema = z.array(
  z.object({
    severity: findingSeveritySchema,
    message: z.string().min(1),
    relatedStageType: relatedStageTypeSchema,
  })
);

export type AnalysisFindingDraft = z.infer<typeof analysisFindingsSchema>[number];

/** Human-readable summary shared by both executors so ANALYZE's stored `content` reads the same regardless of which one drafted it. */
export function summarizeAnalysisFindings(findings: AnalysisFindingDraft[]): string {
  if (findings.length === 0) return "No consistency issues found across prior stages.";
  return findings.map((f) => `- **${f.severity}** (${f.relatedStageType}): ${f.message}`).join("\n");
}

export interface StageExecutionContext {
  workItemTitle: string;
  workItemDescription: string;
  workItemSource: string;
  workItemExternalId: string;
  /** Content of the previous stage in the pipeline, if any (e.g. the Spec, when drafting the Plan). */
  previousStageContent?: string;
  /** Prior clarification round's questions and answers, present only when redrafting a CLARIFY stage after they were answered — see Task Group 6. */
  clarifyAnswers?: { question: string; answer: string }[];
  /** Every prior DONE/APPROVED stage's content, present only when drafting ANALYZE — its cross-artifact consistency check needs more than just the immediately preceding stage. See Task Group 7. */
  priorStagesContent?: { type: StageType; content: string }[];
  /** The comment from the most recent human rejection of this exact stage, present only when redrafting after a REJECTED gate decision — see Task Group 9. */
  rejectionComment?: string;
}

export interface StageExecutionResult {
  content: string;
  aiModel: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  /**
   * Present only for a CLARIFY stage that decided to ask questions instead of
   * drafting content — Zod-validated structured output, never JSON.parse'd ad
   * hoc (see design.md/proposal.md's "AI never writes authoritative state
   * directly"). When set, `content` is a placeholder and the worker routes to
   * AWAITING_CLARIFICATION instead of PENDING_APPROVAL/DONE (Task Group 6).
   */
  clarifyQuestions?: string[];
  /**
   * Present only for an ANALYZE draft — always set (possibly empty), never omitted, since
   * ANALYZE's whole job is to produce findings (design.md Decision 8). Zod-validated
   * structured output, same discipline as clarifyQuestions above. The worker replaces this
   * stage's prior AnalysisFinding rows with these on every draft: only the latest run counts.
   */
  analysisFindings?: { severity: FindingSeverity; message: string; relatedStageType: StageType }[];
}

/** Constitution is project-scoped, not work-item-scoped — see design.md Decision 4a. */
export interface ConstitutionExecutionContext {
  projectName: string;
  projectKey: string;
}

/**
 * What drafts stage content. `mockExecutor` fills prompt templates directly;
 * a real implementation would call out to an LLM using the same prompt
 * templates from config/prompts/*.md and this same interface.
 */
export interface AgentExecutor {
  executeStage(stageType: StageType, context: StageExecutionContext): Promise<StageExecutionResult>;
  executeConstitution(context: ConstitutionExecutionContext): Promise<StageExecutionResult>;
}
