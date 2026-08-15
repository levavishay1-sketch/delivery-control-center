import { z } from "zod";
import type { StageType } from "@/generated/prisma/client";

/** Validates a CLARIFY draft's structured questions output before it's ever treated as authoritative. */
export const clarifyQuestionsSchema = z.array(z.string().min(1)).min(1);

export interface StageExecutionContext {
  workItemTitle: string;
  workItemDescription: string;
  workItemSource: string;
  workItemExternalId: string;
  /** Content of the previous stage in the pipeline, if any (e.g. the Spec, when drafting the Plan). */
  previousStageContent?: string;
  /** Prior clarification round's questions and answers, present only when redrafting a CLARIFY stage after they were answered — see Task Group 6. */
  clarifyAnswers?: { question: string; answer: string }[];
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
