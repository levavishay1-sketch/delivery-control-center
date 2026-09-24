import { describe, expect, it } from "vitest";
import { flowSteps, gainedDeps, liveCycleState, type FlowBase, type FlowCycle, type FlowNow } from "./task-flow-steps.ts";

const base = (without: number[] = [], on: number | null = null, sha: string | null = null): FlowBase => ({ on: on == null ? null : { seq: on, sha }, without });
const run = (over: Partial<FlowCycle> = {}): FlowCycle => ({
  state: "done", startedAt: "2026-09-20T10:00:00Z", base: base(), buildVerified: true, buildFailed: false,
  checks: { ran: 2, passed: 2, failed: 0, waiting: 0 }, reviewed: false, ...over,
});
const now = (over: Partial<FlowNow> = {}): FlowNow => ({ running: null, closed: false, pendingDeps: [], ...over });
const shape = (steps: ReturnType<typeof flowSteps>) => steps.map((s) => `${s.kind}:${s.state}`);

describe("flowSteps", () => {
  it("draws the three steps of a task that has not run, the first one waiting", () => {
    expect(shape(flowSteps([], now()))).toEqual(["develop:current", "checks:todo", "review:todo"]);
  });

  it("leaves no trace of a dependency that was there before the task started", () => {
    const steps = flowSteps([run({ base: base([], 3) })], now());
    expect(steps.map((s) => s.kind)).toEqual(["develop", "checks", "review"]);
  });

  it("puts the dependency step before the checks when it arrived before they ran", () => {
    const steps = flowSteps([
      run({ base: base([3]), checks: { ran: 0, passed: 0, failed: 0, waiting: 0 } }),
      run({ base: base([], 3), startedAt: "2026-09-22T10:00:00Z" }),
    ], now());
    expect(shape(steps)).toEqual(["develop:done", "dependency:done", "checks:done", "review:current"]);
    expect(steps[1]!.deps).toEqual([3]);
  });

  it("goes through the checks again when the dependency arrived after they ran", () => {
    const steps = flowSteps([run({ base: base([3]) }), run({ base: base([], 3) })], now());
    expect(shape(steps)).toEqual(["develop:done", "checks:done", "dependency:done", "checks:done", "review:current"]);
    expect(steps.filter((s) => s.past).map((s) => s.kind)).toEqual(["develop", "checks"]);
  });

  it("goes through the checks and the review again when it arrived after the review", () => {
    const steps = flowSteps([run({ base: base([3]), reviewed: true }), run({ base: base([], 3) })], now());
    expect(steps.map((s) => s.kind)).toEqual(["develop", "checks", "review", "dependency", "checks", "review"]);
  });

  it("shows the dependency step as the next thing to do the moment its work exists", () => {
    const steps = flowSteps([run({ base: base([3]) })], now({ pendingDeps: [3] }));
    expect(shape(steps)).toEqual(["develop:done", "checks:done", "dependency:current", "checks:todo", "review:todo"]);
    expect(steps[2]!.note).toContain("#3");
  });

  it("counts a base that moved on as the dependency coming in again", () => {
    expect(gainedDeps(base([], 3, "aaa"), base([], 3, "bbb"))).toEqual([3]);
    expect(gainedDeps(base([], 3, "aaa"), base([], 3, "aaa"))).toEqual([]);
    const steps = flowSteps([run({ base: base([], 3, "aaa") }), run({ base: base([], 3, "bbb") })], now());
    expect(steps.map((s) => s.kind)).toEqual(["develop", "checks", "dependency", "checks", "review"]);
  });

  it("takes N dependencies coming in at different times as one step each", () => {
    const steps = flowSteps([
      run({ base: base([2, 3]) }),
      run({ base: base([2], 3) }),
      run({ base: base([], 3) }),
    ], now());
    expect(steps.filter((s) => s.kind === "dependency").map((s) => s.deps)).toEqual([[3], [2]]);
  });

  it("does not start a round for a plain run again", () => {
    expect(flowSteps([run(), run({ state: "error" }), run()], now()).map((s) => s.kind)).toEqual(["develop", "checks", "review"]);
  });

  it("follows a run that is going on, step by step", () => {
    expect(shape(flowSteps([run({ state: "running" })], now({ running: "build" })))).toEqual(["develop:current", "checks:todo", "review:todo"]);
    expect(shape(flowSteps([run({ state: "running" })], now({ running: "test" })))).toEqual(["develop:done", "checks:current", "review:todo"]);
  });

  it("marks where it fell — the build inside development, a check inside the checks", () => {
    expect(shape(flowSteps([run({ buildFailed: true, checks: { ran: 0, passed: 0, failed: 0, waiting: 0 } })], now()))).toEqual(["develop:failed", "checks:todo", "review:todo"]);
    expect(shape(flowSteps([run({ checks: { ran: 2, passed: 1, failed: 1, waiting: 0 } })], now()))).toEqual(["develop:done", "checks:failed", "review:todo"]);
    expect(shape(flowSteps([run({ state: "error" })], now()))).toEqual(["develop:failed", "checks:todo", "review:todo"]);
  });

  it("never marks development done before a run has finished", () => {
    expect(flowSteps([], now())[0]!.state).toBe("current");
    expect(flowSteps([run({ state: "rolled_back" })], now())[0]!.state).toBe("current");
  });

  it("does not mark development done on a run whose build was never actually verified — a legacy run, or checks added after it ran", () => {
    const legacy = run({ buildVerified: false, checks: { ran: 0, passed: 0, failed: 0, waiting: 0 } });
    expect(shape(flowSteps([legacy], now()))).toEqual(["develop:current", "checks:todo", "review:todo"]);
  });

  it("is done when the task was closed", () => {
    expect(flowSteps([run()], now({ closed: true })).at(-1)!.state).toBe("done");
  });
});

describe("a past step knows the run it was", () => {
  it("names, for each step of an earlier round, the last run of that round — where its record is kept", () => {
    const steps = flowSteps([run({ runId: "r1", base: base([3]) }), run({ runId: "r2", base: base([3]) })], now({ pendingDeps: [3] }));
    expect(steps.filter((x) => x.past).map((x) => `${x.kind}:${x.runId}`)).toEqual(["develop:r2", "checks:r2"]);
  });
});

describe("liveCycleState", () => {
  it("reads the build check's live result, not a stale run snapshot — the '🔁 הרץ Build שוב' case", () => {
    // A combined run failed the build; "🔁 הרץ Build שוב" ran it again on its own and it passed — the check row shows it live.
    const live = [{ kind: "build", result: "passed", cause: null }, { kind: "tests", result: "failed", cause: null }, { kind: "regression", result: "failed", cause: null }];
    expect(liveCycleState(live)).toMatchObject({ buildVerified: true, buildFailed: false, checks: { ran: 2, passed: 0, failed: 2, waiting: 0 } });
    const steps = flowSteps([run({ buildFailed: true, checks: { ran: 0, passed: 0, failed: 0, waiting: 0 } }, )], now());
    const overlaid = flowSteps([{ ...run(), ...liveCycleState(live) }], now());
    expect(overlaid.map((s) => s.kind + ":" + s.state)).toEqual(["develop:done", "checks:failed", "review:todo"]);
    expect(steps[0]!.state).toBe("failed"); // sanity: the un-overlaid snapshot really was stale
  });

  it("counts nothing run yet as nothing to report — a task whose checks never started", () => {
    expect(liveCycleState([{ kind: "build", result: null, cause: null }])).toMatchObject({ buildVerified: false, buildFailed: false, checks: { ran: 0 } });
  });

  it("a check still to do keeps the checks step open — checks set one at a time, by hand or by a rerun", () => {
    const live = [{ kind: "build", result: "passed", cause: null }, { kind: "tests", result: "passed", cause: null }, { kind: "regression", result: null, cause: null }];
    expect(liveCycleState(live)).toMatchObject({ checks: { ran: 1, passed: 1, notRun: 1 } });
    expect(shape(flowSteps([{ ...run(), ...liveCycleState(live) }], now()))).toEqual(["develop:done", "checks:current", "review:todo"]);
    const all = live.map((c) => ({ ...c, result: "passed" }));
    expect(shape(flowSteps([{ ...run(), ...liveCycleState(all) }], now()))).toEqual(["develop:done", "checks:done", "review:current"]);
  });

  it("does not count a check waiting on a dependency as failed", () => {
    const live = [{ kind: "build", result: "passed", cause: null }, { kind: "tests", result: "waiting", cause: "dependency_missing" }];
    expect(liveCycleState(live)).toMatchObject({ checks: { ran: 1, passed: 0, failed: 0, waiting: 1 } });
  });
});
