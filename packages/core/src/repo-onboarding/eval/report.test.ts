import { describe, expect, it } from "vitest";
import { legacyDelta, renderEvalMarkdown, summarizeEval, tasksWorthRerun, type EvalRunRecord } from "./report.ts";
import type { EvalTask } from "./tasks.ts";

/**
 * From runs to verdicts: pass^k per arm, a task improved/same/worse, a
 * component's delta from the tasks that exercise it, a safety component
 * credited for a block it showed, a knowledge component proposed for removal
 * when it changed nothing.
 */

const t = (key: string, exercises: EvalTask["exercises"], kind: EvalTask["kind"] = "action"): EvalTask => ({ key, kind, title_he: key, prompt: "", allowsEdits: true, exercises, graders: [], judge: null, from: "test" });
const r = (taskKey: string, arm: "with" | "without", passed: boolean | null, o: Partial<EvalRunRecord> = {}): EvalRunRecord => ({ taskKey, title_he: taskKey, arm, runIndex: 0, passed, failureKind: passed ? null : "missing_fact", detail: "", costUsd: 0.3, numTurns: 8, graders: [], judgedBy: "code", callId: null, answer: "", ...o });

const tasks = [t("gen", { keys: ["generated_paths_guard"], kinds: ["hook"] }), t("build", { keys: ["cannot_build_here_rule"] }), t("typo", { keys: ["match_style_rule"] }), t("secret", { keys: ["deny_read_secret_files"] })];
const components = [
  { key: "generated_paths_guard", kind: "hook" as const, family: "safety" as const, files: [".claude/hooks/block-paths.mjs"] },
  { key: "cannot_build_here_rule", kind: "rule" as const, family: "knowledge" as const, files: ["AGENTS.md"] },
  { key: "match_style_rule", kind: "rule" as const, family: "knowledge" as const, files: ["AGENTS.md"] },
  { key: "deny_read_secret_files", kind: "permission" as const, family: "safety" as const, files: [".claude/settings.json"] },
  { key: "unrelated_doc", kind: "doc" as const, family: "knowledge" as const, files: ["docs/x.md"] },
];

describe("summarizeEval", () => {
  const runs = [
    // gen: both arms pass, but the "with" arm shows the hook blocking — the safety component earns its place.
    r("gen", "without", true), r("gen", "with", true, { graders: [{ type: "tool_blocked", passed: true, skipped: false, detail: "blocked" }] }),
    // build: fails without, passes with, twice — improved.
    r("build", "without", false), r("build", "with", true), r("build", "without", false, { runIndex: 1 }), r("build", "with", true, { runIndex: 1 }),
    // typo: passes both — the style line changed nothing.
    r("typo", "without", true), r("typo", "with", true),
    // secret: passes without (by luck), fails with — worse.
    r("secret", "without", true, { costUsd: 0.2 }), r("secret", "with", false, { costUsd: 0.6 }),
  ];
  const s = summarizeEval(tasks, runs, components);

  it("pass^k per arm and a verdict per task", () => {
    const by = Object.fromEntries(s.tasks.map((x) => [x.key, x]));
    expect(by.build!.with.passK).toBe(true);
    expect(by.build!.without.passK).toBe(false);
    expect(by.build!.verdict).toBe("improved");
    expect(by.typo!.verdict).toBe("same");
    expect(by.secret!.verdict).toBe("worse");
    expect(by.gen!.with.blocked).toBe(true);
    expect(s.totals).toMatchObject({ tasks: 4, measured: 4, improved: 1, same: 2, worse: 1, unmeasured: 0 });
    expect(s.totals.with.passK).toBe(3);
    expect(s.totals.without.passK).toBe(3);
  });

  it("a component's delta comes from the tasks that exercise it; a block counts for a safety component; 'same' proposes removal of a knowledge component", () => {
    const by = Object.fromEntries(s.components.map((c) => [c.key, c]));
    expect(by.cannot_build_here_rule!.delta).toMatchObject({ before: 0, after: 1, total: 1, verdict: "improved" });
    expect(by.cannot_build_here_rule!.removalProposed).toBe(false);
    expect(by.generated_paths_guard!.delta.verdict).toBe("improved");
    expect(by.generated_paths_guard!.why_he).toMatch(/חוסם/);
    expect(by.match_style_rule!.delta.verdict).toBe("same");
    expect(by.match_style_rule!.removalProposed).toBe(true);
    expect(by.deny_read_secret_files!.delta.verdict).toBe("worse");
    expect(by.deny_read_secret_files!.removalProposed).toBe(true);
    expect(by.unrelated_doc!.delta.verdict).toBe("unmeasured");
    expect(by.unrelated_doc!.removalProposed).toBe(false);
  });

  it("the tasks worth a second run are the ones whose arms disagreed", () => {
    expect(tasksWorthRerun(s).sort()).toEqual(["build", "secret"]);
  });

  it("cost per run compares the arms, and the legacy before/after shape still reads", () => {
    const secretOnly = summarizeEval([tasks[3]!], runs.filter((x) => x.taskKey === "secret"));
    expect(secretOnly.totals.costChange).toBe(2);
    const legacy = legacyDelta(s);
    expect(legacy.before.total).toBe(4);
    expect(legacy.after.passed).toBe(3);
  });

  it("an arm that never ran leaves the task unmeasured, not failed", () => {
    const one = summarizeEval([t("x", {})], [r("x", "without", true)]);
    expect(one.tasks[0]!.verdict).toBe("unmeasured");
    expect(one.tasks[0]!.with.passK).toBeNull();
  });

  it("renders a Hebrew table with one row per task and per component", () => {
    const md = renderEvalMarkdown(s, "מדידה");
    expect(md).toContain("| build (`build`) |");
    expect(md).toContain("| `match_style_rule` |");
    expect(md).toContain("השתפרה");
  });
});
