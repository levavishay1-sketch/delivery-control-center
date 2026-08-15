import Anthropic from "@anthropic-ai/sdk";
import type { StageType } from "@/generated/prisma/client";
import { getStageConfig, loadPromptTemplate } from "@/lib/config";
import { clarifyQuestionsSchema } from "./types";
import type { AgentExecutor, ConstitutionExecutionContext, StageExecutionContext, StageExecutionResult } from "./types";

const CLARIFY_QUESTIONS_MARKER = "<!-- CLARIFY_QUESTIONS -->";

/**
 * Parses the structured-questions block a CLARIFY draft can return instead of
 * content — Zod-validated, never trusted as authoritative on parse failure
 * alone. Returns null when the marker isn't present at all (ordinary content,
 * no ambiguity); throws when the marker is present but what follows isn't
 * valid JSON matching the schema, since the model explicitly signaled it
 * wants to ask questions and malformed output there should surface as an
 * error (forcing a job retry), not be silently misread as content.
 */
function parseClarifyQuestions(text: string): string[] | null {
  const markerIdx = text.indexOf(CLARIFY_QUESTIONS_MARKER);
  if (markerIdx === -1) return null;

  const rest = text
    .slice(markerIdx + CLARIFY_QUESTIONS_MARKER.length)
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(rest);
  } catch {
    throw new Error("CLARIFY response included the questions marker but the JSON that followed could not be parsed.");
  }

  const result = clarifyQuestionsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`CLARIFY response's questions failed validation: ${result.error.message}`);
  }
  return result.data;
}

const MODEL = process.env.AI_MODEL || "claude-sonnet-5";

// List price per token for claude-sonnet-5, in USD. Approximate: doesn't
// account for prompt-caching discounts or introductory pricing.
const INPUT_COST_PER_TOKEN = 3 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 15 / 1_000_000;

const SYSTEM_PROMPT =
  "You draft one stage of a software delivery pipeline document. Follow the " +
  "instructions exactly. Output only the requested Markdown content — no " +
  "preamble, no code fences wrapping the whole document, no commentary " +
  "before or after — unless the stage's own instructions specify a different " +
  "output format (e.g. a structured-questions marker), in which case follow " +
  "that format exactly instead.";

function fillInstructions(template: string, context: StageExecutionContext): string {
  const instructions = template.slice(0, template.indexOf("<!-- OUTPUT TEMPLATE"));
  const filled = instructions
    .replaceAll("{{title}}", context.workItemTitle)
    .replaceAll("{{description}}", context.workItemDescription || "(no description provided)")
    .replaceAll("{{source}}", context.workItemSource)
    .replaceAll("{{externalId}}", context.workItemExternalId)
    .replaceAll("{{previousStageContent}}", context.previousStageContent || "(none)");

  if (!context.clarifyAnswers?.length) return filled;
  const answers = context.clarifyAnswers.map((qa) => `- Q: ${qa.question}\n  A: ${qa.answer}`).join("\n");
  return `${filled}\n\nPreviously asked clarification questions and their answers:\n${answers}`;
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

async function getClaudeResponse(prompt: string, labelForError: string) {
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

  return { text: textBlock.text.trim(), promptTokens, completionTokens, costUsd };
}

async function callClaude(prompt: string, labelForError: string): Promise<StageExecutionResult> {
  const { text, promptTokens, completionTokens, costUsd } = await getClaudeResponse(prompt, labelForError);
  return { content: text, aiModel: MODEL, promptTokens, completionTokens, costUsd };
}

export const claudeExecutor: AgentExecutor = {
  async executeStage(stageType: StageType, context: StageExecutionContext): Promise<StageExecutionResult> {
    const stageConfig = getStageConfig(stageType);
    const rawTemplate = loadPromptTemplate(stageConfig.promptTemplate);
    const prompt = fillInstructions(rawTemplate, context);

    if (stageType === "CLARIFY") {
      const { text, promptTokens, completionTokens, costUsd } = await getClaudeResponse(prompt, stageType);
      const questions = parseClarifyQuestions(text);
      if (questions) {
        return { content: "", aiModel: MODEL, promptTokens, completionTokens, costUsd, clarifyQuestions: questions };
      }
      return { content: text, aiModel: MODEL, promptTokens, completionTokens, costUsd };
    }

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
