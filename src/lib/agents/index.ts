import { mockExecutor } from "./mockExecutor";
import { claudeExecutor } from "./claudeExecutor";
import type { AgentExecutor } from "./types";

/** Real drafting when ANTHROPIC_API_KEY is configured, otherwise the mock executor. */
export function getAgentExecutor(): AgentExecutor {
  return process.env.ANTHROPIC_API_KEY ? claudeExecutor : mockExecutor;
}

export type { AgentExecutor, StageExecutionContext, StageExecutionResult } from "./types";
