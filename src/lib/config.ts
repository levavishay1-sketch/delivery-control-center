import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import type { StageType } from "@/generated/prisma/client";

export interface WorkflowStageConfig {
  type: StageType;
  label: string;
  description: string;
  promptTemplate: string;
  requiresApproval: boolean;
}

interface WorkflowFile {
  stages: WorkflowStageConfig[];
}

const CONFIG_DIR = path.join(process.cwd(), "config");

let cachedWorkflow: WorkflowStageConfig[] | null = null;
const promptTemplateCache = new Map<string, string>();

/** Loads config/workflow.yaml. Re-reads from disk on every call in dev so edits show up without a restart. */
export function loadWorkflow(): WorkflowStageConfig[] {
  if (cachedWorkflow && process.env.NODE_ENV === "production") {
    return cachedWorkflow;
  }
  const raw = fs.readFileSync(path.join(CONFIG_DIR, "workflow.yaml"), "utf-8");
  const parsed = yaml.load(raw) as WorkflowFile;
  if (!parsed?.stages?.length) {
    throw new Error("config/workflow.yaml must define at least one stage");
  }
  cachedWorkflow = parsed.stages;
  return cachedWorkflow;
}

export function getStageConfig(type: StageType): WorkflowStageConfig {
  const stage = loadWorkflow().find((s) => s.type === type);
  if (!stage) throw new Error(`No workflow config found for stage type ${type}`);
  return stage;
}

/**
 * Returns the stage type that follows `current` within a pipeline's own
 * snapshotted `stageSequence`, or null if `current` is the last stage.
 * Deliberately takes the sequence as a parameter rather than reading
 * `loadWorkflow()` — a pipeline's stage sequence is fixed at creation
 * (see design.md Decision 3), so this must never fall back to the live
 * config file for an existing pipeline.
 */
export function getNextStageTypeInSequence(stageSequence: StageType[], current: StageType): StageType | null {
  const idx = stageSequence.indexOf(current);
  if (idx === -1 || idx === stageSequence.length - 1) return null;
  return stageSequence[idx + 1];
}

export function loadPromptTemplate(fileName: string): string {
  if (process.env.NODE_ENV === "production") {
    const cached = promptTemplateCache.get(fileName);
    if (cached) return cached;
  }
  const content = fs.readFileSync(path.join(CONFIG_DIR, "prompts", fileName), "utf-8");
  promptTemplateCache.set(fileName, content);
  return content;
}

/** Extracts the section after the `<!-- OUTPUT TEMPLATE ... -->` marker, which is what the mock AI executor fills in. */
export function extractOutputTemplate(promptFileContent: string): string {
  const marker = "<!-- OUTPUT TEMPLATE";
  const idx = promptFileContent.indexOf(marker);
  if (idx === -1) return promptFileContent;
  const afterMarker = promptFileContent.indexOf("-->", idx);
  return promptFileContent.slice(afterMarker + 3).trim();
}
