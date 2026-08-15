import type { StageType } from "@/generated/prisma/client";
import { extractOutputTemplate, getStageConfig, loadPromptTemplate } from "@/lib/config";
import type { AgentExecutor, ConstitutionExecutionContext, StageExecutionContext, StageExecutionResult } from "./types";

const PROMPT_COST_PER_TOKEN = 0.000003;
const COMPLETION_COST_PER_TOKEN = 0.000015;

function fillTemplate(template: string, context: StageExecutionContext): string {
  const filled = template
    .replaceAll("{{title}}", context.workItemTitle)
    .replaceAll("{{description}}", context.workItemDescription || "(no description provided)")
    .replaceAll("{{source}}", context.workItemSource)
    .replaceAll("{{externalId}}", context.workItemExternalId)
    .replaceAll("{{previousStageContent}}", context.previousStageContent || "(none)");

  if (!context.clarifyAnswers?.length) return filled;
  const answers = context.clarifyAnswers.map((qa) => `- Q: ${qa.question}\n  A: ${qa.answer}`).join("\n");
  return `${filled}\n\nPreviously asked clarification questions and their answers:\n${answers}`;
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
    if (stageType === "CLARIFY") {
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
};
