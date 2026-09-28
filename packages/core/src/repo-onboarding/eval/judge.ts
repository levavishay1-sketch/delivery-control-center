import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runClaudeRaw, type LedgerContext } from "../../ai-assist.ts";
import { recommend } from "../../routing.ts";
import { parseJudge } from "../trials.ts";
import type { FailureKind } from "../types.ts";
import type { EvalTask } from "./tasks.ts";
import { renderGraders, type GraderResult } from "./graders.ts";

/**
 * The judge that can look: a separate, lean call with Read/Grep/Glob on the
 * arm's copy, handed the task, the agent's answer, what the code graders
 * already found, and the diagnosis facts as HINTS. It checks every claim in
 * the answer against the code before deciding — the Haiku judge without
 * tools failed a right answer (`dotnet vstest`) because the facts it was
 * given as truth were narrower than the repository (the TRADE audit).
 */

export type JudgeVerdict = { passed: boolean | null; failureKind: FailureKind | null; detail: string; costUsd: number; callId: string | null; judgedBy: string };

export async function judgeWithRepo(o: {
  ledger: Omit<LedgerContext, "capability" | "label">;
  label: string;
  task: EvalTask;
  answer: string;
  graders: readonly GraderResult[];
  armDir: string;
  hints: readonly string[];
  /** Renders the `onboarding.judge` instruction from the library with the variables below. */
  render: (vars: Record<string, string>) => Promise<string>;
  workDir: string;
}): Promise<JudgeVerdict> {
  const body = await o.render({
    TASK: o.task.prompt,
    FACTS: o.hints.map((f) => `- ${f}`).join("\n") || "- (none)",
    ANSWER: o.answer.slice(0, 12_000),
    CLAIMS: renderGraders(o.graders),
    COPY_DIR: o.armDir,
    EXPECT: o.task.judge?.expect ?? "",
  });
  mkdirSync(o.workDir, { recursive: true });
  const sys = path.join(o.workDir, `onboarding_judge-${randomUUID().slice(0, 8)}.txt`);
  writeFileSync(sys, body, "utf8");
  const model = recommend("onboarding_judge").model;
  try {
    const res = await runClaudeRaw(o.workDir, `Check the answer against the repository at ${o.armDir} and answer now, exactly in the format the instructions require.`, {
      ledger: { ...o.ledger, capability: "onboarding_judge", label: o.label },
      maxTurns: 15, timeoutMs: 300_000,
      lean: { systemPromptFile: sys, tools: "Read,Grep,Glob", addDirs: [o.armDir] },
    });
    const v = parseJudge(res.text);
    return { ...v, costUsd: res.meta.costUsd ?? 0, callId: res.callId, judgedBy: res.meta.model ?? model };
  } catch (e) {
    return { passed: null, failureKind: null, detail: `השופט לא הכריע: ${(e as Error).message.slice(0, 160)}`, costUsd: 0, callId: null, judgedBy: model };
  }
}
