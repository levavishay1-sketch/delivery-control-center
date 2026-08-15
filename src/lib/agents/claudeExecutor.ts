import Anthropic from "@anthropic-ai/sdk";
import type { StageType } from "@/generated/prisma/client";
import { getStageConfig, loadPromptTemplate } from "@/lib/config";
import type { AgentExecutor, ConstitutionExecutionContext, StageExecutionContext, StageExecutionResult } from "./types";

const MODEL = process.env.AI_MODEL || "claude-sonnet-5";

// List price per token for claude-sonnet-5, in USD. Approximate: doesn't
// account for prompt-caching discounts or introductory pricing.
const INPUT_COST_PER_TOKEN = 3 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 15 / 1_000_000;

const SYSTEM_PROMPT =
  "You draft one stage of a software delivery pipeline document. Follow the " +
  "instructions exactly. Output only the requested Markdown content — no " +
  "preamble, no code fences wrapping the whole document, no commentary " +
  "before or after.";

function fillInstructions(template: string, context: StageExecutionContext): string {
  const instructions = template.slice(0, template.indexOf("<!-- OUTPUT TEMPLATE"));
  return instructions
    .replaceAll("{{title}}", context.workItemTitle)
    .replaceAll("{{description}}", context.workItemDescription || "(no description provided)")
    .replaceAll("{{source}}", context.workItemSource)
    .replaceAll("{{externalId}}", context.workItemExternalId)
    .replaceAll("{{previousStageContent}}", context.previousStageContent || "(none)");
}

function fillConstitutionInstructions(template: string, context: ConstitutionExecutionContext): string {
  const instructions = template.slice(0, template.indexOf("<!-- OUTPUT TEMPLATE"));
  return instructions.replaceAll("{{projectName}}", context.projectName).replaceAll("{{projectKey}}", context.projectKey);
}

let client: Anthropic | undefined;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

async function callClaude(prompt: string, labelForError: string): Promise<StageExecutionResult> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`Claude response for ${labelForError} contained no text content.`);
  }

  const promptTokens = response.usage.input_tokens;
  const completionTokens = response.usage.output_tokens;
  const costUsd =
    Math.round((promptTokens * INPUT_COST_PER_TOKEN + completionTokens * OUTPUT_COST_PER_TOKEN) * 10000) / 10000;

  return {
    content: textBlock.text.trim(),
    aiModel: MODEL,
    promptTokens,
    completionTokens,
    costUsd,
  };
}

export const claudeExecutor: AgentExecutor = {
  async executeStage(stageType: StageType, context: StageExecutionContext): Promise<StageExecutionResult> {
    const stageConfig = getStageConfig(stageType);
    const rawTemplate = loadPromptTemplate(stageConfig.promptTemplate);
    const prompt = fillInstructions(rawTemplate, context);
    return callClaude(prompt, stageType);
  },

  async executeConstitution(context: ConstitutionExecutionContext): Promise<StageExecutionResult> {
    // Loaded by filename, not getStageConfig("CONSTITUTION") — Task Group 4 drops
    // CONSTITUTION from config/workflow.yaml's stage list, which would 404 that lookup.
    const rawTemplate = loadPromptTemplate("constitution.md");
    const prompt = fillConstitutionInstructions(rawTemplate, context);
    return callClaude(prompt, "CONSTITUTION");
  },
};
