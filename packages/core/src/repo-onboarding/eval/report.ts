import type { ComponentDelta, ComponentFamily, ComponentKind, FailureKind } from "../types.ts";
import { exercised, type EvalArm, type EvalTask } from "./tasks.ts";
import type { GraderResult } from "./graders.ts";

/**
 * From the runs of every task in both arms to the numbers the screen, the
 * readiness gate and the pull request show: pass^k per task and arm (every
 * run passed — what a developer will get, not what the agent can do on a
 * good day), cost and turns per arm, and a delta per component from the
 * tasks that exercise it. Pure.
 */

export type EvalRunRecord = {
  taskKey: string;
  title_he: string;
  arm: EvalArm;
  runIndex: number;
  passed: boolean | null;
  failureKind: FailureKind | null;
  detail: string;
  costUsd: number;
  numTurns: number | null;
  graders: GraderResult[];
  judgedBy: string;
  callId: string | null;
  /** The agent's final answer, truncated — what the screen and the chat show. */
  answer?: string;
};

export type ArmSummary = { runs: number; passed: number; passK: boolean | null; passRate: number | null; meanCostUsd: number | null; meanTurns: number | null; blocked: boolean };
export type TaskVerdict = "improved" | "same" | "worse" | "unmeasured";
export type TaskSummary = { key: string; title_he: string; kind: EvalTask["kind"]; with: ArmSummary; without: ArmSummary; verdict: TaskVerdict; failureKinds: Partial<Record<FailureKind, number>> };

export type ComponentLike = { key: string; kind: ComponentKind; family: ComponentFamily; files: readonly string[] };
export type ComponentSummary = { key: string; kind: ComponentKind; family: ComponentFamily; tasks: string[]; delta: ComponentDelta; removalProposed: boolean; why_he: string };

export type EvalSummary = {
  tasks: TaskSummary[];
  components: ComponentSummary[];
  totals: {
    tasks: number; measured: number; improved: number; same: number; worse: number; unmeasured: number;
    with: { passK: number; meanCostUsd: number | null; meanTurns: number | null };
    without: { passK: number; meanCostUsd: number | null; meanTurns: number | null };
    /** Cost per run, "with" against "without", as a fraction (0.2 = 20% dearer); null without both. */
    costChange: number | null;
    spentUsd: number;
  };
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function armSummary(runs: readonly EvalRunRecord[]): ArmSummary {
  if (!runs.length) return { runs: 0, passed: 0, passK: null, passRate: null, meanCostUsd: null, meanTurns: null, blocked: false };
  const passed = runs.filter((r) => r.passed === true).length;
  return {
    runs: runs.length, passed, passK: passed === runs.length, passRate: passed / runs.length,
    meanCostUsd: mean(runs.map((r) => r.costUsd)), meanTurns: mean(runs.map((r) => r.numTurns).filter((n): n is number => typeof n === "number")),
    blocked: runs.some((r) => r.graders.some((g) => g.type === "tool_blocked" && !g.skipped && g.passed)),
  };
}

const verdictOf = (w: ArmSummary, wo: ArmSummary): TaskVerdict => {
  if (w.passK === null || wo.passK === null) return "unmeasured";
  if (w.passK && !wo.passK) return "improved";
  if (!w.passK && wo.passK) return "worse";
  return "same";
};

/** Kinds whose only purpose is to make the agent do better — a delta of "same" means they did not. */
const KNOWLEDGE_KINDS = new Set<ComponentKind>(["rule", "doc", "scaffold", "skill", "agent", "review", "pr_template", "devcontainer"]);
/** Kinds that exist to stop something — measured by a block seen in the "with" arm, not only by pass counts. */
const SAFETY_KINDS = new Set<ComponentKind>(["hook", "permission", "gitignore", "gitattributes", "settings"]);

export function summarizeEval(tasks: readonly EvalTask[], runs: readonly EvalRunRecord[], components: readonly ComponentLike[] = []): EvalSummary {
  const byTask = new Map<string, EvalRunRecord[]>();
  for (const r of runs) byTask.set(r.taskKey, [...(byTask.get(r.taskKey) ?? []), r]);
  const taskSummaries: TaskSummary[] = tasks.map((t) => {
    const rs = byTask.get(t.key) ?? [];
    const w = armSummary(rs.filter((r) => r.arm === "with"));
    const wo = armSummary(rs.filter((r) => r.arm === "without"));
    const kinds: Partial<Record<FailureKind, number>> = {};
    for (const r of rs) if (r.failureKind) kinds[r.failureKind] = (kinds[r.failureKind] ?? 0) + 1;
    return { key: t.key, title_he: t.title_he, kind: t.kind, with: w, without: wo, verdict: verdictOf(w, wo), failureKinds: kinds };
  });
  const byKey = new Map(taskSummaries.map((t) => [t.key, t]));

  const componentSummaries: ComponentSummary[] = components.map((c) => {
    const mine = tasks.filter((t) => exercised(t, c)).map((t) => byKey.get(t.key)!).filter((t) => t.verdict !== "unmeasured");
    const before = mine.filter((t) => t.without.passK).length;
    const after = mine.filter((t) => t.with.passK).length;
    const blocked = SAFETY_KINDS.has(c.kind) && mine.some((t) => t.with.blocked);
    const costB = mean(mine.map((t) => t.without.meanCostUsd).filter((x): x is number => x !== null));
    const costA = mean(mine.map((t) => t.with.meanCostUsd).filter((x): x is number => x !== null));
    const verdict: ComponentDelta["verdict"] = mine.length === 0 ? "unmeasured" : after > before ? "improved" : after < before ? "worse" : blocked ? "improved" : "same";
    const delta: ComponentDelta = { before, after, total: mine.length, costPerTaskChange: costA !== null && costB ? Math.round(((costA - costB) / costB) * 100) / 100 : null, verdict };
    const removalProposed = (KNOWLEDGE_KINDS.has(c.kind) && (verdict === "same" || verdict === "worse")) || (SAFETY_KINDS.has(c.kind) && verdict === "worse");
    const why_he = mine.length === 0
      ? "אף משימה במדידה לא נגעה ברכיב הזה — לא נמדד"
      : verdict === "improved"
        ? blocked && after <= before ? `נראה חוסם בפועל בזרוע "עם" (${mine.filter((t) => t.with.blocked).map((t) => t.title_he).join(", ")})` : `${after} מתוך ${mine.length} משימות עוברות עם הרכיב, ${before} בלעדיו`
        : verdict === "worse" ? `עם הרכיב עוברות ${after} משימות, בלעדיו ${before} — הוא מזיק` : `אותן ${after} משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה`;
    return { key: c.key, kind: c.kind, family: c.family, tasks: mine.map((t) => t.key), delta, removalProposed, why_he };
  });

  const measured = taskSummaries.filter((t) => t.verdict !== "unmeasured");
  const count = (v: TaskVerdict) => taskSummaries.filter((t) => t.verdict === v).length;
  const withRuns = runs.filter((r) => r.arm === "with");
  const withoutRuns = runs.filter((r) => r.arm === "without");
  const costW = mean(withRuns.map((r) => r.costUsd));
  const costWo = mean(withoutRuns.map((r) => r.costUsd));
  return {
    tasks: taskSummaries,
    components: componentSummaries,
    totals: {
      tasks: taskSummaries.length, measured: measured.length, improved: count("improved"), same: count("same"), worse: count("worse"), unmeasured: count("unmeasured"),
      with: { passK: measured.filter((t) => t.with.passK).length, meanCostUsd: costW, meanTurns: mean(withRuns.map((r) => r.numTurns).filter((n): n is number => typeof n === "number")) },
      without: { passK: measured.filter((t) => t.without.passK).length, meanCostUsd: costWo, meanTurns: mean(withoutRuns.map((r) => r.numTurns).filter((n): n is number => typeof n === "number")) },
      costChange: costW !== null && costWo ? Math.round(((costW - costWo) / costWo) * 100) / 100 : null,
      spentUsd: Math.round(runs.reduce((a, r) => a + r.costUsd, 0) * 100) / 100,
    },
  };
}

/** The tasks whose arms disagree after the first pass — the ones worth a second run (a single sample is noise). */
export const tasksWorthRerun = (summary: EvalSummary): string[] => summary.tasks.filter((t) => t.verdict === "improved" || t.verdict === "worse").map((t) => t.key);

/** The old before/after shape the screen and the coach still read, from the new summary. */
export const legacyDelta = (s: EvalSummary) => ({
  before: { passed: s.totals.without.passK, total: s.totals.measured, costUsd: (s.totals.without.meanCostUsd ?? 0) * s.totals.measured },
  after: { passed: s.totals.with.passK, total: s.totals.measured, costUsd: (s.totals.with.meanCostUsd ?? 0) * s.totals.measured },
  costPerTaskChange: s.totals.costChange,
});

const usd = (x: number | null) => (x === null ? "—" : `$${x.toFixed(2)}`);

/** The summary as a Hebrew Markdown report — the research record and the pull request's table. */
export function renderEvalMarkdown(s: EvalSummary, title: string): string {
  const lines: string[] = [`# ${title}`, "", `משימות: ${s.totals.tasks} · נמדדו: ${s.totals.measured} · השתפרו: ${s.totals.improved} · אותו דבר: ${s.totals.same} · הורעו: ${s.totals.worse} · לא נמדדו: ${s.totals.unmeasured}`,
    `עוברות בכל הרצה — עם: ${s.totals.with.passK}/${s.totals.measured} · בלי: ${s.totals.without.passK}/${s.totals.measured} · עלות ממוצעת להרצה — עם ${usd(s.totals.with.meanCostUsd)} · בלי ${usd(s.totals.without.meanCostUsd)}${s.totals.costChange !== null ? ` (${s.totals.costChange >= 0 ? "+" : ""}${Math.round(s.totals.costChange * 100)}%)` : ""} · סך ההוצאה $${s.totals.spentUsd}`, "",
    "| משימה | סוג | עם (עבר/הרצות) | בלי (עבר/הרצות) | פסק דין | עלות עם | עלות בלי | תורות עם | תורות בלי |", "|---|---|---|---|---|---|---|---|---|"];
  const v: Record<TaskVerdict, string> = { improved: "השתפרה", same: "אותו דבר", worse: "הורעה", unmeasured: "לא נמדדה" };
  for (const t of s.tasks) lines.push(`| ${t.title_he} (\`${t.key}\`) | ${t.kind === "action" ? "פעולה" : "ידע"} | ${t.with.passed}/${t.with.runs} | ${t.without.passed}/${t.without.runs} | ${v[t.verdict]} | ${usd(t.with.meanCostUsd)} | ${usd(t.without.meanCostUsd)} | ${t.with.meanTurns?.toFixed(0) ?? "—"} | ${t.without.meanTurns?.toFixed(0) ?? "—"} |`);
  if (s.components.length) {
    lines.push("", "| רכיב | סוג | משימות | לפני | אחרי | פסק דין | מוצע להסרה |", "|---|---|---|---|---|---|---|");
    for (const c of s.components) lines.push(`| \`${c.key}\` | ${c.kind} | ${c.tasks.length} | ${c.delta.before} | ${c.delta.after} | ${c.delta.verdict} | ${c.removalProposed ? "כן" : ""} |`);
  }
  return lines.join("\n") + "\n";
}
