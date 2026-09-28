import type { ComponentKind, FailureKind, TrialOutcome } from "./types.ts";

/**
 * What the measurement's runs mean to the rest of the run: the judge's
 * verdict parsed, a failure kind mapped to the kind of component that
 * answers it, the runs rendered for the prompts. The tasks, the arms and
 * the graders live in `eval/`. Pure.
 */

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

export const byKind = (xs: readonly TrialOutcome[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const t of xs) if (t.failureKind) out[t.failureKind] = (out[t.failureKind] ?? 0) + 1;
  return out;
};

/** The latest run of every task in the phase — what a prompt or a card reads when it wants one line per task. */
export function latestPerTask(xs: readonly TrialOutcome[]): TrialOutcome[] {
  const latest = new Map<string, TrialOutcome>();
  for (const t of xs) {
    const prev = latest.get(`${t.phase}:${t.taskKey}`);
    if (!prev || (t.runIndex ?? 0) >= (prev.runIndex ?? 0)) latest.set(`${t.phase}:${t.taskKey}`, t);
  }
  return [...latest.values()];
}

export const renderTrials = (xs: readonly TrialOutcome[]) => {
  const rows = latestPerTask(xs);
  return rows.length
    ? rows.map((t) => `- ${t.title_he} (${t.taskKey}, ${t.phase === "baseline" ? "without helpers" : "with the delivered set"}): ${t.passed === true ? "passed" : t.passed === false ? `FAILED — ${t.failureKind}` : "not judged"}${t.detail ? ` — ${t.detail}` : ""}`).join("\n")
    : "(no measurement yet)";
};
