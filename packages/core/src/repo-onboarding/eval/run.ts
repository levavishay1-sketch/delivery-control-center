import path from "node:path";
import { runClaudeRaw, type LedgerContext } from "../../ai-assist.ts";
import { route } from "../../routing.ts";
import { gradeRun, type EvalEvidence } from "./graders.ts";
import { judgeWithRepo } from "./judge.ts";
import { summarizeEval, tasksWorthRerun, type ComponentLike, type EvalRunRecord, type EvalSummary } from "./report.ts";
import { EVAL_ARMS, type EvalArm, type EvalTask } from "./tasks.ts";
import { collectEvidence, copyDelivered, prepareArms, removeArms, resetArm, usableMcpConfig, type Arms } from "./workspace.ts";

/**
 * One measurement: every task, in both arms, `runsPerTask` times — arms
 * interleaved per task so a stop at the budget cap still leaves paired data —
 * then, when asked, one more run of the tasks whose arms disagreed (one
 * sample is noise). Each run: reset the arm, put the delivered set in the
 * "with" arm, run Claude Code headless with only the copy's configuration
 * loaded, collect what changed and what ran, grade by code, ask the judge
 * where the code cannot decide, hand the record to the caller to keep.
 */

export type EvalOpts = {
  ledger: Omit<LedgerContext, "capability" | "label">;
  sharedDir: string;
  baselineSha: string;
  /** The files that would be delivered, and where they are now. */
  delivered: { fromDir: string; files: readonly string[] };
  /** Where the two arms live (removed at the end). */
  armsRoot: string;
  /** Where the judge's prompt files go. */
  workDir: string;
  tasks: readonly EvalTask[];
  /** The bank's context for this repository (`evalContext`): the flags a grader's `when` reads. */
  ctx: Record<string, unknown>;
  /** The diagnosis facts the judge gets as hints. */
  hints: readonly string[];
  runsPerTask: number;
  /** After the first pass, run the tasks whose arms disagreed once more. */
  extraRunWhenDiffer: boolean;
  /** Stop before a run that would pass this spend. */
  maxUsd: number;
  /** Renders a library instruction (`onboarding.trial`, `onboarding.judge`) with variables. */
  render: (promptKey: string, vars: Record<string, string | boolean | undefined>) => Promise<string>;
  /** Which capability the executor runs under (`onboarding_trial` inside a run, `onboarding_eval` standalone). */
  capability?: "onboarding_trial" | "onboarding_eval";
  model?: string;
  effort?: string;
  maxTurns?: number;
  timeoutMs?: number;
  /** Which arms to run (a run's step 4 runs "without" only; step 6 runs "with" only). */
  arms?: readonly EvalArm[];
  /** Records from an earlier call (a step-4 "without" pass) the summary should include. */
  priorRuns?: readonly EvalRunRecord[];
  /** The components the "with" arm carries — each gets its own delta from the tasks that exercise it. */
  components?: readonly ComponentLike[];
  onRun?: (rec: EvalRunRecord) => Promise<void> | void;
  log?: (line: string) => void;
  /** Called before each run with the spend so far; return false to stop (a cancel). */
  shouldContinue?: () => boolean;
};

export type EvalResult = { runs: EvalRunRecord[]; summary: EvalSummary; stoppedAtCap: boolean; spentUsd: number };

const PER_RUN_ESTIMATE = 0.35;

export async function runEval(o: EvalOpts): Promise<EvalResult> {
  const capability = o.capability ?? "onboarding_trial";
  const arms = o.arms ?? EVAL_ARMS;
  const log = o.log ?? (() => {});
  const records: EvalRunRecord[] = [];
  let spent = 0;
  let stoppedAtCap = false;
  const perRunCap = route(capability).budgetUsd;

  const armDirs: Arms = await prepareArms(o.sharedDir, o.baselineSha, o.armsRoot);
  try {
    const runOne = async (task: EvalTask, arm: EvalArm, runIndex: number): Promise<boolean> => {
      if (o.shouldContinue && !o.shouldContinue()) return false;
      if (spent + PER_RUN_ESTIMATE > o.maxUsd) { stoppedAtCap = true; log(`⛔ המדידה נעצרה בתקרה ($${o.maxUsd}) אחרי $${spent.toFixed(2)}`); return false; }
      const dir = armDirs[arm];
      await resetArm(dir, o.baselineSha);
      if (arm === "with") copyDelivered(o.delivered.fromDir, dir, o.delivered.files);
      const label = `מדידה ${arm === "with" ? "עם" : "בלי"} #${runIndex + 1}: ${task.title_he}`;
      log(`▶ ${label}`);
      const prompt = await o.render("onboarding.trial", { TASK: task.prompt, EDITS: task.allowsEdits });
      let answer = "";
      let events: unknown[] = [];
      let costUsd = 0;
      let numTurns: number | null = null;
      let callId: string | null = null;
      let crashed: string | null = null;
      try {
        const res = await runClaudeRaw(dir, prompt, {
          ledger: { ...o.ledger, capability, label },
          write: task.allowsEdits, commands: true, maxTurns: o.maxTurns ?? 40, timeoutMs: o.timeoutMs ?? 900_000,
          model: o.model, effort: o.effort, keepEvents: true,
          maxBudgetUsd: Math.min(perRunCap, Math.max(0.1, o.maxUsd - spent)),
          isolate: { settingSources: "project", mcpConfig: arm === "with" ? usableMcpConfig(dir) : null },
        });
        answer = res.text; events = res.events; costUsd = res.meta.costUsd ?? 0; numTurns = res.meta.numTurns; callId = res.callId;
      } catch (e) {
        crashed = (e as Error).message.slice(0, 200);
      }
      spent += costUsd;
      const evidence: EvalEvidence = { arm, answer, events, ...(await collectEvidence(dir, o.baselineSha)), ctx: o.ctx };
      let rec: EvalRunRecord;
      if (crashed) {
        rec = { taskKey: task.key, title_he: task.title_he, arm, runIndex, passed: false, failureKind: "cannot_verify", detail: `ההרצה לא הסתיימה: ${crashed}`, costUsd, numTurns, graders: [], judgedBy: "code", callId, answer: "" };
      } else {
        const g = gradeRun(task, evidence);
        let passed: boolean | null = g.passed;
        let failureKind = g.failureKind;
        let detail = g.results.filter((r) => !r.skipped).map((r) => `${r.passed ? "✓" : "✗"} ${r.detail}`).join("; ");
        let judgedBy = "code";
        if (task.judge && g.passed) {
          const j = await judgeWithRepo({ ledger: o.ledger, label: `שופט ${arm === "with" ? "עם" : "בלי"} #${runIndex + 1}: ${task.title_he}`, task, answer, graders: g.results, armDir: dir, hints: o.hints, render: (vars) => o.render("onboarding.judge", vars), workDir: o.workDir });
          spent += j.costUsd; costUsd += j.costUsd;
          passed = j.passed; failureKind = j.failureKind; judgedBy = j.judgedBy;
          detail = [j.detail, detail].filter(Boolean).join(" · ");
        }
        rec = { taskKey: task.key, title_he: task.title_he, arm, runIndex, passed, failureKind, detail: detail.slice(0, 600), costUsd, numTurns, graders: g.results, judgedBy, callId, answer: answer.slice(0, 20_000) };
      }
      records.push(rec);
      log(`  ${rec.passed === true ? "✓ עבר" : rec.passed === false ? "✗ נכשל" : "? לא הוכרע"} · $${rec.costUsd.toFixed(2)} · ${rec.numTurns ?? "?"} תורות — ${rec.detail.slice(0, 160)}`);
      await o.onRun?.(rec);
      return true;
    };

    outer: for (let i = 0; i < o.runsPerTask; i++) {
      for (const task of o.tasks) for (const arm of arms) if (!(await runOne(task, arm, i))) break outer;
    }
    // The second pass runs BOTH arms of every task whose arms disagreed, whatever the main pass ran: one sample per arm is noise.
    if (!stoppedAtCap && o.extraRunWhenDiffer) {
      const again = tasksWorthRerun(summarizeEval(o.tasks, [...(o.priorRuns ?? []), ...records]));
      const nextIndex = (task: EvalTask, arm: EvalArm) => [...(o.priorRuns ?? []), ...records].filter((r) => r.taskKey === task.key && r.arm === arm).length;
      outer2: for (const task of o.tasks) {
        if (!again.includes(task.key)) continue;
        for (const arm of EVAL_ARMS) if (!(await runOne(task, arm, nextIndex(task, arm)))) break outer2;
      }
    }
  } finally {
    await removeArms(o.sharedDir, armDirs).catch(() => {});
  }
  const all = [...(o.priorRuns ?? []), ...records];
  return { runs: records, summary: summarizeEval(o.tasks, all, o.components ?? []), stoppedAtCap, spentUsd: Math.round(spent * 100) / 100 };
}

export const armsRootFor = (runtimeDir: string) => path.join(runtimeDir, "eval");
