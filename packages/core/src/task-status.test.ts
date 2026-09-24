import { describe, expect, it } from "vitest";
import { dependencyBlockers, dependencyTag, storedStateAfterChecks, taskStatus, type StatusCheck, type StatusFacts } from "./task-status.ts";

const f = (over: Partial<StatusFacts> = {}): StatusFacts => ({
  kind: "task", state: "pending", active: true, approved: true, inTfs: true, running: null, lastRunError: null, developed: false,
  checks: [], openDeps: [], builtWithout: [], onMoved: null, ...over,
});
const check = (seq: number, kind: string | null, result: string | null, cause: string | null = null): StatusCheck => ({ seq, kind, result, cause, active: true });
const std = (build: string | null, tests: string | null, regression: string | null) => [check(10, "build", build), check(11, "tests", tests), check(12, "regression", regression)];

describe("taskStatus", () => {
  it("waits for approval and the TFS setup first", () => {
    expect(taskStatus(f({ approved: false })).key).toBe("awaiting_approval");
  });

  it("cannot start before it exists in TFS — a task developed before that keeps its real status", () => {
    expect(taskStatus(f({ inTfs: false }))).toMatchObject({ key: "awaiting_tfs", tone: "warning" });
    expect(taskStatus(f({ inTfs: false, running: "develop" })).key).toBe("running");
    expect(taskStatus(f({ inTfs: false, developed: true, checks: std("passed", "passed", "passed") })).key).toBe("review");
  });

  it("keeps its phase when it depends on something — the dependency is a tag beside it, not a status", () => {
    expect(taskStatus(f({ openDeps: [{ seq: 2, developed: false }] })).key).toBe("ready");
    expect(taskStatus(f({ running: "develop", openDeps: [{ seq: 2, developed: false }] })).key).toBe("running");
  });

  it("says specifically what it fell on, not just 'נפלה'", () => {
    expect(taskStatus(f({ developed: true, checks: std("failed", null, null) })).label).toBe("נפלה על ה-Build");
    expect(taskStatus(f({ developed: true, checks: std("passed", "failed", "failed") })).label).toBe("נפלה על בדיקות הפיתוח");
    expect(taskStatus(f({ developed: true, checks: std("passed", "passed", "failed") })).label).toBe("נפלה על בדיקות רגרסיה");
    expect(taskStatus(f({ developed: true, checks: [check(10, "build", "failed", "environment")] })).label).toBe("נפלה על ה-Build");
  });

  it("names a dependency with no code as the likely reason for an unclear requirement", () => {
    const s = taskStatus(f({ developed: true, checks: [check(11, "tests", "failed", "requirement_ambiguity")], openDeps: [{ seq: 2, developed: false }] }));
    expect(s.reason).toContain("#2 עוד לא פותחה");
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

  it("is still in development — not 'waiting for checks' — while the build itself has never run", () => {
    // A real task surfaced this: `developed` only means some implement run finished,
    // not that the code compiled. The FLOW rail's own develop step ("כולל Build")
    // is not done until the build check has; the status must agree, not skip ahead.
    expect(taskStatus(f({ developed: true, checks: std(null, null, null) }))).toMatchObject({ key: "build_pending", label: "ממתינה להרצת Build", tone: "warning" });
    expect(taskStatus(f({ developed: true, checks: std(null, null, null), openDeps: [{ seq: 2, developed: false }] })).key).toBe("build_pending");
  });

  it("says a disabled build's last result, not that it never ran — a real task surfaced this too", () => {
    const disabledPassed = [{ ...check(10, "build", "passed"), active: false }, check(11, "tests", null), check(12, "regression", null)];
    expect(taskStatus(f({ developed: true, checks: disabledPassed }))).toMatchObject({ key: "build_pending", label: "ה-Build מושבת", tone: "inactive" });
    expect(taskStatus(f({ developed: true, checks: disabledPassed })).reason).toContain("עברה");
    const disabledFailed = [{ ...check(10, "build", "failed"), active: false }, check(11, "tests", null), check(12, "regression", null)];
    expect(taskStatus(f({ developed: true, checks: disabledFailed })).reason).toContain("נכשלה");
  });

  it("says when the checks after the build have not run — only once the build itself passed", () => {
    expect(taskStatus(f({ developed: true, checks: std("passed", null, null) })).key).toBe("checks_pending");
  });

  it("never says 'בעבודה' for checks pending — nothing is running, it is waiting for a click", () => {
    const s = taskStatus(f({ developed: true, checks: std("passed", null, null) }));
    expect(s.label).not.toContain("בעבודה");
    expect(s).toMatchObject({ label: "ממתינה להרצת בדיקות", tone: "warning" });
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

describe("dependencyTag", () => {
  it("is there while a dependency is not done, whatever the phase, and gone once they all are", () => {
    expect(dependencyTag(f())).toBeNull();
    expect(dependencyTag(f({ openDeps: [{ seq: 2, developed: false }] }))).toMatchObject({ tone: "critical", label: "🔗 קיימת תלות · #2" });
    expect(dependencyTag(f({ running: "test", openDeps: [{ seq: 2, developed: false }] }))).not.toBeNull();
  });

  it("is orange once every dependency has code, and red while any one has none", () => {
    expect(dependencyTag(f({ openDeps: [{ seq: 3, developed: true }] }))!.tone).toBe("warning");
    expect(dependencyTag(f({ openDeps: [{ seq: 3, developed: true }, { seq: 5, developed: false }] }))).toMatchObject({ tone: "critical", label: "🔗 קיימת תלות · #3, #5" });
  });

  it("is not drawn on a check, or on a task set aside", () => {
    expect(dependencyTag(f({ kind: "check", openDeps: [{ seq: 2, developed: false }] }))).toBeNull();
    expect(dependencyTag(f({ active: false, openDeps: [{ seq: 2, developed: false }] }))).toBeNull();
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

describe("a group — a task with sub-tasks, never developed itself", () => {
  const sub = (seq: number, developed: boolean, done = false) => ({ seq, developed, done });
  const integration = (result: string | null) => [check(5, null, result)];

  it("follows its sub-tasks while any is not developed — never 'ready to develop' or 'waiting for build'", () => {
    const s = taskStatus(f({ subtasks: [sub(2, false), sub(3, false)], checks: integration(null) }));
    expect(s).toMatchObject({ key: "group_open", label: "0/2 תת-משימות הסתיימו", tone: "neutral" });
    expect(s.reason).toContain("#2, #3 עוד לא פותחה");
    expect(taskStatus(f({ subtasks: [sub(2, true), sub(3, false)], developed: true })).tone).toBe("active");
  });

  it("waits for its integration check once every sub-task is developed", () => {
    expect(taskStatus(f({ subtasks: [sub(2, true), sub(3, true)], developed: true, checks: integration(null) }))).toMatchObject({ key: "checks_pending", label: "ממתינה לבדיקת השילוב" });
  });

  it("falls on its integration check like any task falls on a check", () => {
    expect(taskStatus(f({ subtasks: [sub(2, true)], developed: true, checks: integration("failed") }))).toMatchObject({ key: "failed", label: "נפלה בבדיקת השילוב" });
  });

  it("is ready to close only when every sub-task is done", () => {
    expect(taskStatus(f({ subtasks: [sub(2, true, true), sub(3, true)], developed: true, checks: integration("passed") })).key).toBe("group_open");
    expect(taskStatus(f({ subtasks: [sub(2, true, true), sub(3, true, true)], developed: true, checks: integration("passed") }))).toMatchObject({ key: "review", label: "ממתינה לסגירה" });
  });

  it("goes through the same gates as any task first: approval, TFS", () => {
    expect(taskStatus(f({ approved: false, subtasks: [sub(2, false)] })).key).toBe("awaiting_approval");
    expect(taskStatus(f({ inTfs: false, subtasks: [sub(2, false)] })).key).toBe("awaiting_tfs");
  });
});

describe("storedStateAfterChecks — the stored coarse state", () => {
  it("moves to failed_checks only when a check actually failed", () => {
    expect(storedStateAfterChecks("in_progress", false, 1)).toEqual({ state: "failed_checks", wasDone: false });
    expect(storedStateAfterChecks("in_progress", false, 0)).toBeNull();
  });

  it("leaves failed_checks the moment nothing failed — a check not run yet failed nothing", () => {
    // The live bug: build failed, then passed on a rerun, the tests not run yet — the task stayed failed_checks.
    expect(storedStateAfterChecks("failed_checks", false, 0)).toEqual({ state: "in_progress", wasDone: false });
  });

  it("remembers a closed task a failing check reopened, and returns it to done", () => {
    expect(storedStateAfterChecks("done", false, 1)).toEqual({ state: "failed_checks", wasDone: true });
    expect(storedStateAfterChecks("failed_checks", true, 0)).toEqual({ state: "done", wasDone: false });
  });

  it("never touches a dropped task", () => {
    expect(storedStateAfterChecks("dropped", false, 3)).toBeNull();
  });
});
