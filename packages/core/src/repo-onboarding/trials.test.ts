import { describe, expect, it } from "vitest";
import { FAILURE_TO_KIND, byKind, latestPerTask, parseJudge, renderTrials } from "./trials.ts";
import type { TrialOutcome } from "./types.ts";

const t = (key: string, phase: "baseline" | "after", passed: boolean | null, runIndex = 0, kind: TrialOutcome["failureKind"] = passed ? null : "missing_fact"): TrialOutcome =>
  ({ taskKey: key, title_he: key, phase, runIndex, passed, failureKind: kind, detail: "", costUsd: 0.1, callId: null, judgedBy: "code" });

describe("the judge's verdict", () => {
  it("reads a verdict and never turns junk into a pass", () => {
    expect(parseJudge('{"passed": false, "failureKind": "needs_external", "detail": "x"}')).toEqual({ passed: false, failureKind: "needs_external", detail: "x" });
    expect(parseJudge('{"passed": false, "failureKind": "weird"}').failureKind).toBe("bad_judgment");
    expect(parseJudge("no json").passed).toBeNull();
    expect(parseJudge('{"passed": true}')).toMatchObject({ passed: true, failureKind: null });
  });
  it("maps every failure kind to a kind of component", () => {
    for (const k of ["missing_fact", "rule_violated", "needs_external", "cannot_verify", "bad_judgment"] as const) expect(FAILURE_TO_KIND[k].kinds.length).toBeGreaterThan(0);
  });
});

describe("runs as the prompts read them", () => {
  it("keeps the latest run of each task per phase, and counts failure kinds over every run", () => {
    const xs = [t("a", "baseline", false, 0), t("a", "baseline", true, 1), t("b", "baseline", false, 0, "cannot_verify"), t("a", "after", true, 0)];
    expect(latestPerTask(xs).map((x) => [x.taskKey, x.phase, x.passed])).toEqual([["a", "baseline", true], ["b", "baseline", false], ["a", "after", true]]);
    expect(byKind(xs)).toEqual({ missing_fact: 1, cannot_verify: 1 });
    expect(renderTrials(xs)).toContain("(a, without helpers): passed");
    expect(renderTrials([])).toBe("(no measurement yet)");
  });
});
