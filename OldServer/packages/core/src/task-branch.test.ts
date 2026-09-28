import { describe, expect, it } from "vitest";
import { branchOf, branchToRecord, taskBranchName } from "./task-branch.ts";

const task = { seq: 7, intent: "Make it inactive" };

describe("branchOf", () => {
  it("names a new branch from the requirement key, the number and the wording", () => {
    expect(taskBranchName("WI-1001", task)).toBe("task/WI-1001-t7-make-it-inactive");
    expect(taskBranchName(null, { seq: 2, intent: "" })).toBe("task/REQ-t2");
  });

  it("reads the recorded branch — a key or wording that changed afterwards does not move it", () => {
    const t = { ...task, branch: "task/REQ-t7-5" };
    expect(branchOf("WI-1001", t)).toBe("task/REQ-t7-5");
    expect(branchOf("WI-1001", { ...t, intent: "edited wording" })).toBe("task/REQ-t7-5");
  });

  it("falls back to the name it would be given now only when nothing is recorded", () => {
    expect(branchOf("WI-1001", { ...task, branch: null })).toBe("task/WI-1001-t7-make-it-inactive");
    expect(branchOf("WI-1001", task)).toBe("task/WI-1001-t7-make-it-inactive");
  });
});

describe("branchToRecord", () => {
  const has = (...names: string[]) => (b: string) => names.includes(b);

  it("takes the newest run's branch that still exists", () => {
    expect(branchToRecord({ runBranches: ["task/WI-1001-t7-x", "task/REQ-t7-5"], derived: "task/WI-1001-t7-y", exists: has("task/WI-1001-t7-x", "task/REQ-t7-5") })).toBe("task/WI-1001-t7-x");
  });

  it("skips a run's branch that is gone and uses an older one that exists", () => {
    expect(branchToRecord({ runBranches: ["task/new", "task/REQ-t7-5"], derived: "task/d", exists: has("task/REQ-t7-5") })).toBe("task/REQ-t7-5");
  });

  it("uses the formula's name only when no run's branch exists", () => {
    expect(branchToRecord({ runBranches: ["gone"], derived: "task/d", exists: has("task/d") })).toBe("task/d");
  });

  it("guesses nothing when no branch exists", () => {
    expect(branchToRecord({ runBranches: ["a"], derived: "b", exists: () => false })).toBeNull();
    expect(branchToRecord({ runBranches: [], derived: "b", exists: () => false })).toBeNull();
  });

  it("ignores empty names — a manual report has no branch", () => {
    expect(branchToRecord({ runBranches: ["", "task/a"], derived: "task/d", exists: has("task/a") })).toBe("task/a");
  });
});
