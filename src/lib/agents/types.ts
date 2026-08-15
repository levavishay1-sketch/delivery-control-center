import type { StageType } from "@/generated/prisma/client";

export interface StageExecutionContext {
  workItemTitle: string;
  workItemDescription: string;
  workItemSource: string;
  workItemExternalId: string;
  /** Content of the previous stage in the pipeline, if any (e.g. the Spec, when drafting the Plan). */
  previousStageContent?: string;
}

export interface StageExecutionResult {
  content: string;
  aiModel: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
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
