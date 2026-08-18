import type { StageType } from "@/generated/prisma/client";
import { extractOutputTemplate, getStageConfig, loadPromptTemplate } from "@/lib/config";
import { summarizeAnalysisFindings } from "./types";
import type {
  AgentExecutor,
  AnalysisFindingDraft,
  ConstitutionExecutionContext,
  RepositoryDiscoveryExecutionContext,
  RepositoryDiscoveryExecutionResult,
  RepositoryDiscoveryFindings,
  StageExecutionContext,
  StageExecutionResult,
} from "./types";

const PROMPT_COST_PER_TOKEN = 0.000003;
const COMPLETION_COST_PER_TOKEN = 0.000015;

function formatPriorStagesContent(priorStagesContent?: { type: StageType; content: string }[]): string {
  if (!priorStagesContent?.length) return "(none)";
  return priorStagesContent.map((s) => `## ${s.type}\n${s.content}`).join("\n\n");
}

function fillTemplate(template: string, context: StageExecutionContext): string {
  let filled = template
    .replaceAll("{{title}}", context.workItemTitle)
    .replaceAll("{{description}}", context.workItemDescription || "(no description provided)")
    .replaceAll("{{source}}", context.workItemSource)
    .replaceAll("{{externalId}}", context.workItemExternalId)
    .replaceAll("{{previousStageContent}}", context.previousStageContent || "(none)")
    .replaceAll("{{priorStagesContent}}", formatPriorStagesContent(context.priorStagesContent));

  if (context.clarifyAnswers?.length) {
    const answers = context.clarifyAnswers.map((qa) => `- Q: ${qa.question}\n  A: ${qa.answer}`).join("\n");
    filled = `${filled}\n\nPreviously asked clarification questions and their answers:\n${answers}`;
  }

  if (context.rejectionComment) {
    filled = `${filled}\n\nThis stage was previously rejected with this feedback — address it in this draft:\n${context.rejectionComment}`;
  }

  return filled;
}

/**
 * Deterministic mock-only trigger for ANALYZE's findings, mirroring
 * extractMockClarifyQuestions below: a work item description containing
 * `[NEEDS_ANALYSIS_FINDING: SEVERITY:STAGE:message | SEVERITY:STAGE:message]`
 * makes the mock ANALYZE draft return those findings, so tests can exercise
 * the Critical-blocks-advancement flow without a real model deciding.
 */
function extractMockAnalysisFindings(description: string): AnalysisFindingDraft[] {
  const match = description.match(/\[NEEDS_ANALYSIS_FINDING:\s*([\s\S]+?)\]/);
  if (!match) return [];
  return match[1]
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [severity, relatedStageType, ...messageParts] = entry.split(":").map((p) => p.trim());
      return {
        severity: severity as AnalysisFindingDraft["severity"],
        relatedStageType: relatedStageType as AnalysisFindingDraft["relatedStageType"],
        message: messageParts.join(":") || "(no message provided)",
      };
    });
}

/**
 * Deterministic mock-only trigger for the questions path: a work item
 * description containing `[NEEDS_CLARIFICATION: question one | question two]`
 * makes the mock CLARIFY draft return those questions instead of content, so
 * tests can exercise the pause/resume flow without a real model deciding.
 */
function extractMockClarifyQuestions(description: string): string[] | null {
  const match = description.match(/\[NEEDS_CLARIFICATION:\s*([\s\S]+?)\]/);
  if (!match) return null;
  const questions = match[1]
    .split("|")
    .map((q) => q.trim())
    .filter(Boolean);
  return questions.length > 0 ? questions : null;
}

function fillConstitutionTemplate(template: string, context: ConstitutionExecutionContext): string {
  return template.replaceAll("{{projectName}}", context.projectName).replaceAll("{{projectKey}}", context.projectKey);
}

const NOT_DETERMINABLE = "Not determinable from the root-level snapshot (no deeper repository crawl performed).";
const ROOT_LISTING_EVIDENCE = ["."];

/**
 * Deterministic mock stand-in for a real model's Discovery analysis: builds findings directly
 * from the fetched snapshot rather than guessing, so the "evidence-grounded, not fabricated"
 * property holds even without a real LLM (design.md's mockExecutor decision).
 */
function buildMockDiscoveryFindings(context: RepositoryDiscoveryExecutionContext): RepositoryDiscoveryFindings {
  const { readme, manifests, rootListing } = context;
  const manifestPaths = manifests.map((m) => m.path);
  const unknowns: string[] = [];

  const purpose = readme
    ? { summary: `Described by its README (${readme.path}).`, evidence: [readme.path] }
    : { summary: NOT_DETERMINABLE, evidence: [] };
  if (!readme) unknowns.push("purpose (no README present at the root)");

  const stack =
    manifestPaths.length > 0
      ? { summary: `Dependency manifest(s) present: ${manifestPaths.join(", ")}.`, evidence: manifestPaths }
      : { summary: NOT_DETERMINABLE, evidence: [] };
  if (manifestPaths.length === 0) unknowns.push("stack (no known dependency manifest present at the root)");

  const structure = { summary: `Root directory contains: ${rootListing.join(", ") || "(empty)"}.`, evidence: ROOT_LISTING_EVIDENCE };

  const empty = { summary: NOT_DETERMINABLE, evidence: [] as string[] };
  unknowns.push("modules/domains (requires a deeper repository crawl, out of scope for this slice)");
  unknowns.push("APIs (requires a deeper repository crawl, out of scope for this slice)");
  unknowns.push("data stores (requires a deeper repository crawl, out of scope for this slice)");
  unknowns.push("testing approach (requires a deeper repository crawl, out of scope for this slice)");
  unknowns.push("conventions (requires a deeper repository crawl, out of scope for this slice)");

  return {
    purpose,
    stack,
    structure,
    modules: empty,
    apis: empty,
    dataStores: empty,
    testing: empty,
    conventions: empty,
    unknowns,
  };
}

function summarizeDiscoveryFindings(findings: RepositoryDiscoveryFindings): string {
  const lines = [
    `- **Purpose**: ${findings.purpose.summary}`,
    `- **Stack**: ${findings.stack.summary}`,
    `- **Structure**: ${findings.structure.summary}`,
  ];
  if (findings.unknowns.length > 0) {
    lines.push(`- **Unknowns**: ${findings.unknowns.join("; ")}`);
  }
  return lines.join("\n");
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Stands in for a real LLM call: fills the stage's prompt template with
 * work-item context and fakes plausible token/cost numbers, so the pipeline,
 * approval gates, and cost tracking can all be exercised end-to-end before a
 * real model is wired in behind this same AgentExecutor interface.
 */
export const mockExecutor: AgentExecutor = {
  async executeStage(stageType: StageType, context: StageExecutionContext): Promise<StageExecutionResult> {
    if (stageType === "CLARIFY" && !context.clarifyAnswers?.length) {
      // Only check the marker on a fresh draft — once clarifyAnswers is populated, this is the
      // redraft that resumed after answering, and must not re-ask the same questions again from
      // the still-present marker (the work item's description isn't consumed/cleared by
      // answering it — a real model would treat already-answered questions as resolved, not
      // re-raise them; the mock needs the same guard or a real answer/redraft cycle never
      // actually completes). See Task Group 11's E2E scenario, which caught this.
      const questions = extractMockClarifyQuestions(context.workItemDescription);
      if (questions) {
        const promptTokens = estimateTokens(context.workItemDescription);
        const completionTokens = estimateTokens(questions.join(" "));
        return {
          content: "",
          aiModel: "mock-agent-v1",
          promptTokens,
          completionTokens,
          costUsd:
            Math.round((promptTokens * PROMPT_COST_PER_TOKEN + completionTokens * COMPLETION_COST_PER_TOKEN) * 10000) /
            10000,
          clarifyQuestions: questions,
        };
      }
    }

    if (stageType === "ANALYZE") {
      const findings = extractMockAnalysisFindings(context.workItemDescription);
      const stageConfig = getStageConfig(stageType);
      const rawTemplate = loadPromptTemplate(stageConfig.promptTemplate);
      const instructions = rawTemplate.slice(0, rawTemplate.indexOf("<!-- OUTPUT TEMPLATE"));
      const outputTemplate = extractOutputTemplate(rawTemplate);

      const content = fillTemplate(outputTemplate, context).replaceAll(
        "{{findingsSummary}}",
        summarizeAnalysisFindings(findings)
      );
      const promptTokens = estimateTokens(fillTemplate(instructions, context));
      const completionTokens = estimateTokens(content);
      const costUsd =
        Math.round((promptTokens * PROMPT_COST_PER_TOKEN + completionTokens * COMPLETION_COST_PER_TOKEN) * 10000) /
        10000;

      return { content, aiModel: "mock-agent-v1", promptTokens, completionTokens, costUsd, analysisFindings: findings };
    }

    const stageConfig = getStageConfig(stageType);
    const rawTemplate = loadPromptTemplate(stageConfig.promptTemplate);
    const instructions = rawTemplate.slice(0, rawTemplate.indexOf("<!-- OUTPUT TEMPLATE"));
    const outputTemplate = extractOutputTemplate(rawTemplate);

    const content = fillTemplate(outputTemplate, context);
    const promptTokens = estimateTokens(fillTemplate(instructions, context));
    const completionTokens = estimateTokens(content);
    const costUsd =
      Math.round((promptTokens * PROMPT_COST_PER_TOKEN + completionTokens * COMPLETION_COST_PER_TOKEN) * 10000) /
      10000;

    return {
      content,
      aiModel: "mock-agent-v1",
      promptTokens,
      completionTokens,
      costUsd,
    };
  },

  async executeConstitution(context: ConstitutionExecutionContext): Promise<StageExecutionResult> {
    // Loaded by filename, not getStageConfig("CONSTITUTION") — Task Group 4 drops
    // CONSTITUTION from config/workflow.yaml's stage list, which would 404 that lookup.
    const rawTemplate = loadPromptTemplate("constitution.md");
    const instructions = rawTemplate.slice(0, rawTemplate.indexOf("<!-- OUTPUT TEMPLATE"));
    const outputTemplate = extractOutputTemplate(rawTemplate);

    const content = fillConstitutionTemplate(outputTemplate, context);
    const promptTokens = estimateTokens(fillConstitutionTemplate(instructions, context));
    const completionTokens = estimateTokens(content);
    const costUsd =
      Math.round((promptTokens * PROMPT_COST_PER_TOKEN + completionTokens * COMPLETION_COST_PER_TOKEN) * 10000) /
      10000;

    return {
      content,
      aiModel: "mock-agent-v1",
      promptTokens,
      completionTokens,
      costUsd,
    };
  },

  async executeRepositoryDiscovery(context: RepositoryDiscoveryExecutionContext): Promise<RepositoryDiscoveryExecutionResult> {
    const findings = buildMockDiscoveryFindings(context);
    const promptSize = context.rootListing.join(" ").length + (context.readme?.content.length ?? 0) +
      context.manifests.reduce((sum, m) => sum + m.content.length, 0);
    const promptTokens = estimateTokens(`${context.owner}/${context.repo} ${" ".repeat(promptSize)}`);
    const completionTokens = estimateTokens(summarizeDiscoveryFindings(findings));
    const costUsd =
      Math.round((promptTokens * PROMPT_COST_PER_TOKEN + completionTokens * COMPLETION_COST_PER_TOKEN) * 10000) /
      10000;

    return { findings, aiModel: "mock-agent-v1", promptTokens, completionTokens, costUsd };
  },
};
