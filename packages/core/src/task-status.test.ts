import { describe, expect, it } from "vitest";
import { dependencyBlockers, taskStatus, type StatusCheck, type StatusFacts } from "./task-status.ts";

const f = (over: Partial<StatusFacts> = {}): StatusFacts => ({
  kind: "task", state: "pending", active: true, approved: true, running: null, lastRunError: null, developed: false,
  checks: [], openDeps: [], builtWithout: [], onMoved: null, ...over,
});
const check = (seq: number, kind: string | null, result: string | null, cause: string | null = null): StatusCheck => ({ seq, kind, result, cause, active: true });
const std = (build: string | null, tests: string | null, regression: string | null) => [check(10, "build", build), check(11, "tests", tests), check(12, "regression", regression)];

describe("taskStatus", () => {
  it("waits for approval and the TFS setup first", () => {
    expect(taskStatus(f({ approved: false })).key).toBe("awaiting_approval");
  });

  it("is red while it depends on something not developed yet, and says it can be developed anyway", () => {
    const s = taskStatus(f({ openDeps: [{ seq: 2, developed: false }] }));
    expect(s).toMatchObject({ key: "dependency_open", tone: "critical" });
    expect(s.reason).toContain("#2");
  });

  it("is ready, built on a dependency that has code", () => {
    expect(taskStatus(f({ openDeps: [{ seq: 3, developed: true }] }))).toMatchObject({ key: "ready", reason: "תיבנה על גבי #3" });
  });

  it("names the phase of a run that is going on", () => {
    expect(taskStatus(f({ running: "develop" })).label).toBe("בעבודה · בפיתוח");
    expect(taskStatus(f({ running: "build" })).label).toBe("בעבודה · מקמפלת");
    expect(taskStatus(f({ running: "test" })).label).toBe("בעבודה · בבדיקות");
  });

  it("falls with its reason — the build first, then the tests, then regression", () => {
    expect(taskStatus(f({ developed: true, state: "failed_checks", checks: std("failed", null, null) })).reason).toBe("ה-Build נכשל");
    expect(taskStatus(f({ developed: true, checks: std("passed", "failed", "failed") })).reason).toBe("בדיקות הפיתוח נכשלו (ועוד 1)");
    expect(taskStatus(f({ developed: true, checks: [check(10, "build", "failed", "environment")] })).reason).toBe("אי אפשר לבנות כאן — חסר כלי או SDK");
  });

  it("waits for its dependency once developed — and says when the dependency exists and it is time to run again", () => {
    expect(taskStatus(f({ developed: true, checks: std("passed", "passed", "passed"), openDeps: [{ seq: 3, developed: true }] }))).toMatchObject({ key: "waiting_dependency", tone: "warning" });
    expect(taskStatus(f({ developed: true, checks: [check(10, "build", "passed"), check(11, "tests", "waiting")], builtWithout: [{ seq: 2, available: false }] })).key).toBe("waiting_dependency");
    expect(taskStatus(f({ developed: true, checks: std("passed", "passed", "passed"), builtWithout: [{ seq: 2, available: true }] })).reason).toContain("#2 פותחה מאז");
    expect(taskStatus(f({ developed: true, checks: std("passed", "passed", "passed"), onMoved: { seq: 3 } })).reason).toContain("#3 השתנתה");
  });

  it("is ready for review when everything passed and nothing is waited for", () => {
    expect(taskStatus(f({ developed: true, state: "in_progress", checks: std("passed", "passed", "passed") })).key).toBe("review");
  });

  it("says when checks have not run — before anything about its dependencies", () => {
    expect(taskStatus(f({ developed: true, checks: std("passed", null, null) })).key).toBe("checks_pending");
    expect(taskStatus(f({ developed: true, checks: std(null, null, null), openDeps: [{ seq: 2, developed: false }] })).key).toBe("checks_pending");
  });

  it("is done when it was closed, and set aside when inactive or dropped", () => {
    expect(taskStatus(f({ state: "done", openDeps: [{ seq: 2, developed: false }] })).key).toBe("done");
    expect(taskStatus(f({ active: false })).key).toBe("inactive");
    expect(taskStatus(f({ state: "dropped" })).key).toBe("dropped");
  });

  it("gives a check its own status", () => {
    expect(taskStatus(f({ kind: "check", checkResult: "waiting" })).label).toBe("מחכה לתלות");
    expect(taskStatus(f({ kind: "check", checkResult: "failed", checkCause: "environment" })).label).toBe("לא יכלה לרוץ כאן");
    expect(taskStatus(f({ kind: "check", checkResult: null })).key).toBe("check_not_run");
  });
});

describe("dependencyBlockers", () => {
  it("names what keeps a dependent task from being closed", () => {
    expect(dependencyBlockers({ openDeps: [], builtWithout: [], onMoved: null })).toEqual([]);
    const b = dependencyBlockers({ openDeps: [{ seq: 2, developed: true }], builtWithout: [{ seq: 2, available: true }], onMoved: { seq: 3 } });
    expect(b).toHaveLength(3);
    expect(b[0]).toContain("#2 עוד לא הושלמה");
  });
});
