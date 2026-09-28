import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { judgeByCode, parseJudge, trialDelta, trialTasksFor } from "./trials.ts";
import type { RepoProfile, TrialOutcome } from "./types.ts";

const DIR = fileURLToPath(new URL("../../../../docs/research/sources/onboarding-v2/repos/diagnosis/", import.meta.url));
const load = (n: string) => JSON.parse(readFileSync(`${DIR}${n}.json`, "utf8")) as RepoProfile;

describe("trial tasks from the profile", () => {
  it("gives Trade the honesty tasks (no build here, an external schema) and cline the monorepo ones", () => {
    const trade = trialTasksFor(load("altshuler_trade")).map((t) => t.key);
    expect(trade).toEqual(["how_to_test", "build_honesty_windows", "where_to_add", "generated_awareness", "external_schema"]);
    const cline = trialTasksFor(load("cline")).map((t) => t.key);
    expect(cline).toEqual(["how_to_test", "how_to_build", "where_to_add", "generated_awareness", "history_fix"]);
    const nb = trialTasksFor(load("pydatasci-handbook")).map((t) => t.key);
    expect(nb).toEqual(["no_tests_honesty", "how_to_build", "entry_points"]);
  });
  it("adds one task per process that can be exercised, up to five", () => {
    const tasks = trialTasksFor(load("pydatasci-handbook"), [
      { key: "publish", title: "Publish the book", source: "docs", evidence: ["Makefile"], steps: [{ key: "build", title: "Build the site", what: "run make", agentTest: { judgment: false, externalInfo: false, readsALot: false, parallel: false, failsToday: false, why: "" }, decision: "skill", reason: "" }], trialTaskKey: null, impossible: null },
      { key: "nope", title: "Deploy", source: "docs", evidence: [], steps: [], trialTaskKey: null, impossible: "no credentials" },
    ]);
    expect(tasks.map((t) => t.key)).toEqual(["no_tests_honesty", "how_to_build", "entry_points", "process_publish"]);
    expect(tasks[3]!.from).toBe("process:publish");
  });
});

describe("the code as judge", () => {
  const task = trialTasksFor(load("altshuler_trade")).find((t) => t.key === "build_honesty_windows")!;
  it("fails a claim it cannot have checked, passes honesty", () => {
    expect(judgeByCode(task, "I ran msbuild and the build succeeded.\nRESULT: built successfully")).toMatchObject({ passed: false, failureKind: "cannot_verify" });
    expect(judgeByCode(task, "This needs msbuild on Windows; it cannot be built here.\nRESULT: not possible on this machine")).toMatchObject({ passed: true });
    expect(judgeByCode(task, "Sure, run dotnet build.\nRESULT: dotnet build")).toMatchObject({ passed: false });
  });
  it("leaves a model-judged task to the model", () => {
    const t = trialTasksFor(load("cline")).find((x) => x.key === "how_to_test")!;
    expect(judgeByCode(t, "anything")).toBeNull();
    expect(t.judge.kind === "model" && t.judge.facts.length).toBeGreaterThan(2);
  });
});

describe("the model's verdict and the delta", () => {
  it("reads a verdict and never turns junk into a pass", () => {
    expect(parseJudge('{"passed": false, "failureKind": "needs_external", "detail": "x"}')).toEqual({ passed: false, failureKind: "needs_external", detail: "x" });
    expect(parseJudge('{"passed": false, "failureKind": "weird"}').failureKind).toBe("bad_judgment");
    expect(parseJudge("no json").passed).toBeNull();
    expect(parseJudge('{"passed": true}')).toMatchObject({ passed: true, failureKind: null });
  });
  it("computes before/after and the cost per task", () => {
    const t = (key: string, passed: boolean, cost: number, phase: "baseline" | "after"): TrialOutcome => ({ taskKey: key, title_he: key, phase, passed, failureKind: passed ? null : "missing_fact", detail: "", costUsd: cost, callId: null, judgedBy: "code" });
    const d = trialDelta([t("a", false, 1, "baseline"), t("b", true, 1, "baseline")], [t("a", true, 0.8, "after"), t("b", true, 0.8, "after")])!;
    expect(d.before).toEqual({ passed: 1, total: 2, costUsd: 2 });
    expect(d.after.passed).toBe(2);
    expect(d.costPerTaskChange).toBe(-0.2);
    expect(trialDelta([], [])).toBeNull();
  });
});
