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

/**
 * Validates a TASKS draft's structured task-candidate output before it's ever treated as
 * authoritative — same "AI output -> schema -> domain command" discipline as
 * analysisFindingsSchema above (see task-decomposition-materialization/design.md). Always
 * required, never omitted, mirroring ANALYZE's own findings requirement.
 */
export const taskDraftsSchema = z.array(
  z.object({
    title: z.string().min(1),
    description: z.string().optional(),
  })
);

export type TaskDraftItem = z.infer<typeof taskDraftsSchema>[number];

/** Human-readable summary shared by both executors so TASKS's stored `content` reads the same regardless of which one drafted it. */
export function summarizeTaskDrafts(drafts: TaskDraftItem[]): string {
  if (drafts.length === 0) return "No tasks drafted.";
  return drafts.map((d) => `- [ ] ${d.title}${d.description ? ` — ${d.description}` : ""}`).join("\n");
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
  /**
   * Present only for a TASKS draft — always set (possibly empty), never omitted, since TASKS's
   * whole job is to produce task candidates. Zod-validated structured output, same discipline as
   * analysisFindings above. The worker replaces this stage's prior TaskDraft rows with these on
   * every draft: only the latest run's drafts count.
   */
  taskDrafts?: { title: string; description?: string }[];
}

/** Constitution is project-scoped, not work-item-scoped — see design.md Decision 4a. */
export interface ConstitutionExecutionContext {
  projectName: string;
  projectKey: string;
}

const discoveryFindingSchema = z.object({
  summary: z.string().min(1),
  evidence: z.array(z.string()),
});

/**
 * Validates a Repository Discovery draft's structured findings before it's ever treated as
 * authoritative — same "AI output -> schema -> domain command" discipline as
 * analysisFindingsSchema above (see repository-discovery-context/design.md's "Findings schema"
 * decision). Always required, never omitted, mirroring ANALYZE's own findings requirement.
 */
export const repositoryDiscoveryFindingsSchema = z.object({
  purpose: discoveryFindingSchema,
  stack: discoveryFindingSchema,
  structure: discoveryFindingSchema,
  modules: discoveryFindingSchema,
  apis: discoveryFindingSchema,
  dataStores: discoveryFindingSchema,
  testing: discoveryFindingSchema,
  conventions: discoveryFindingSchema,
  unknowns: z.array(z.string()),
});

export type RepositoryDiscoveryFindings = z.infer<typeof repositoryDiscoveryFindingsSchema>;

/** Repository Discovery is Repository-scoped, independent of any Project/WorkItem — see design.md's Context. */
export interface RepositoryDiscoveryExecutionContext {
  owner: string;
  repo: string;
  rootListing: string[];
  readme?: { path: string; content: string };
  manifests: { path: string; content: string }[];
}

export interface RepositoryDiscoveryExecutionResult {
  findings: RepositoryDiscoveryFindings;
  aiModel: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

/**
 * What drafts stage content. `mockExecutor` fills prompt templates directly;
 * a real implementation would call out to an LLM using the same prompt
 * templates from config/prompts/*.md and this same interface.
 */
export interface AgentExecutor {
  executeStage(stageType: StageType, context: StageExecutionContext): Promise<StageExecutionResult>;
  executeConstitution(context: ConstitutionExecutionContext): Promise<StageExecutionResult>;
  executeRepositoryDiscovery(context: RepositoryDiscoveryExecutionContext): Promise<RepositoryDiscoveryExecutionResult>;
}
