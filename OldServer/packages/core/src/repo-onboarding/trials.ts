import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluate, fill, ruleContext, type Condition } from "./rules.ts";
import { factsForJudge } from "./profile.ts";
import type { ComponentKind, DiscoveredProcess, FailureKind, RepoProfile, TrialDelta, TrialJudge, TrialOutcome, TrialTask } from "./types.ts";

/**
 * The trial run: representative tasks the agent does in the isolated copy
 * with no components, before the build (the baseline) and after it. The
 * task list comes from the profile (`trial-tasks.json`) and from the
 * processes; the judge is the code where the answer can be checked, a model
 * other than the executor where it cannot. Every failure names the kind of
 * component that would answer it. Pure here; `runs.ts` makes the calls.
 */

type Template = { key: string; priority: number; when?: Condition; title_he: string; prompt: string; judge: TrialJudge };
const FILE = fileURLToPath(new URL("./trial-tasks.json", import.meta.url));
let templates: Template[] | null = null;
const loadTemplates = () => (templates ??= (JSON.parse(readFileSync(FILE, "utf8")) as { tasks: Template[] }).tasks);

export const MIN_TASKS = 3;
export const MAX_TASKS = 5;

/** Three to five tasks: the templates the profile calls for, then one per process that has a step the trial can exercise. */
export function trialTasksFor(profile: RepoProfile, processes: readonly DiscoveredProcess[] = []): TrialTask[] {
  const ctx = ruleContext(profile);
  const facts = factsForJudge(profile);
  const out: TrialTask[] = loadTemplates()
    .filter((t) => !t.when || evaluate(t.when, profile))
    .sort((a, b) => a.priority - b.priority)
    .map((t) => ({ key: t.key, title_he: fill(t.title_he, ctx), prompt: fill(t.prompt, ctx), judge: t.judge.kind === "model" ? { ...t.judge, facts: t.judge.facts.length ? facts : facts } : t.judge, from: "profile" }));
  for (const p of processes) {
    if (out.length >= MAX_TASKS) break;
    if (p.impossible) continue;
    const step = p.steps.find((s) => s.decision !== "none") ?? p.steps[0];
    if (!step) continue;
    out.push({
      key: `process_${p.key}`.slice(0, 60), title_he: `תהליך: ${p.title}`,
      prompt: `In this repository, how is this done: "${p.title}"? Describe the steps in order, naming the files and commands involved (paths that exist). Focus on the step "${step.title}". Do not change anything.`,
      judge: { kind: "model", facts: [...facts, ...p.evidence.map((e) => `Evidence: ${e}`)], failureKind: "missing_fact" }, from: `process:${p.key}`,
    });
  }
  return out.slice(0, MAX_TASKS);
}

/* ── judging ──────────────────────────────────────────────────────── */

const resultLine = (answer: string) => answer.split("\n").reverse().find((l) => /^\s*RESULT:/i.test(l))?.replace(/^\s*RESULT:\s*/i, "").trim() ?? "";

/** The code's verdict, when the task's judge is the code; null when it is not. */
export function judgeByCode(task: TrialTask, answer: string): { passed: boolean; failureKind: FailureKind | null; detail: string } | null {
  if (task.judge.kind !== "code") return null;
  const text = answer.toLowerCase();
  const claimed = (task.judge.mustNotClaim ?? []).find((c) => text.includes(c.toLowerCase()));
  if (claimed) return { passed: false, failureKind: task.judge.failureKind, detail: `הסוכן טען "${claimed}" — טענה שאי אפשר לבסס כאן.` };
  const must = task.judge.mustMention ?? [];
  if (must.length && !must.some((m) => text.includes(m.toLowerCase()))) return { passed: false, failureKind: task.judge.failureKind, detail: `התשובה לא אמרה את מה שהיה צריך: ${task.judge.expect_he}` };
  const r = resultLine(answer);
  return { passed: true, failureKind: null, detail: r ? `עבר. ${r.slice(0, 200)}` : "עבר." };
}

/** The judge model's JSON → a verdict; a malformed answer is "could not judge", never a pass. */
export function parseJudge(raw: string): { passed: boolean | null; failureKind: FailureKind | null; detail: string } {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return { passed: null, failureKind: null, detail: "השופט לא ענה בפורמט שאפשר לקרוא." };
  try {
    const o = JSON.parse(raw.slice(start, end + 1)) as { passed?: unknown; failureKind?: unknown; detail?: unknown };
    const passed = o.passed === true ? true : o.passed === false ? false : null;
    const kinds: readonly string[] = ["missing_fact", "rule_violated", "needs_external", "cannot_verify", "bad_judgment"];
    const kind = passed === false && kinds.includes(String(o.failureKind)) ? (o.failureKind as FailureKind) : passed === false ? "bad_judgment" : null;
    return { passed, failureKind: kind, detail: typeof o.detail === "string" ? o.detail.slice(0, 400) : "" };
  } catch {
    return { passed: null, failureKind: null, detail: "השופט לא ענה בפורמט שאפשר לקרוא." };
  }
}

/** The kind of component a failure points at — the rule that replaces "what /init decided". */
export const FAILURE_TO_KIND: Record<FailureKind, { kinds: ComponentKind[]; he: string }> = {
  missing_fact: { kinds: ["rule", "doc"], he: "לא ידע עובדה → שורת הנחיה או מסמך" },
  rule_violated: { kinds: ["hook", "permission"], he: "ידע ועבר על כלל → hook או הרשאה" },
  needs_external: { kinds: ["mcp", "agent"], he: "חסר מידע חיצוני → MCP או סוכן עם גישה" },
  cannot_verify: { kinds: ["script", "runner"], he: "לא יכול לאמת → סקריפט build/בדיקות או מריץ" },
  bad_judgment: { kinds: ["agent", "skill"], he: "שיפוט שגוי → סוכן בודק או skill" },
};

export const FAILURE_HE: Record<FailureKind, string> = {
  missing_fact: "לא ידע עובדה", rule_violated: "ידע ועבר על כלל", needs_external: "חסר מידע חיצוני", cannot_verify: "לא יכול לאמת", bad_judgment: "שיפוט שגוי",
};

export function trialDelta(before: readonly TrialOutcome[], after: readonly TrialOutcome[]): TrialDelta | null {
  if (!before.length || !after.length) return null;
  const sum = (xs: readonly TrialOutcome[]) => ({ passed: xs.filter((t) => t.passed === true).length, total: xs.length, costUsd: xs.reduce((a, t) => a + t.costUsd, 0) });
  const b = sum(before);
  const a = sum(after);
  const perB = b.total ? b.costUsd / b.total : 0;
  const perA = a.total ? a.costUsd / a.total : 0;
  return { before: b, after: a, costPerTaskChange: perB > 0 ? Math.round(((perA - perB) / perB) * 100) / 100 : null };
}

export const byKind = (xs: readonly TrialOutcome[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const t of xs) if (t.failureKind) out[t.failureKind] = (out[t.failureKind] ?? 0) + 1;
  return out;
};

export const renderTrials = (xs: readonly TrialOutcome[]) => (xs.length
  ? xs.map((t) => `- ${t.title_he} (${t.taskKey}): ${t.passed === true ? "passed" : t.passed === false ? `FAILED — ${t.failureKind}` : "not judged"}${t.detail ? ` — ${t.detail}` : ""}`).join("\n")
  : "(no trial run yet)");
