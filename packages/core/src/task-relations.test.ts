import { describe, expect, it } from "vitest";
import { taskRelations, type RelDep, type RelRow } from "./task-relations.ts";

const row = (id: string, seq: number, over: Partial<RelRow> = {}): RelRow => ({ id, seq, kind: "task", parentTaskId: null, active: true, state: "pending", ...over });

// The shape of a real breakdown: group G1 (#1) with sub-tasks A (#2), B (#3) and
// its check C1 (#5); group G2 (#6) with sub-tasks X (#7), Y (#8).
const rows: RelRow[] = [
  row("G1", 1), row("A", 2, { parentTaskId: "G1" }), row("B", 3, { parentTaskId: "G1" }),
  row("C1", 5, { kind: "check", parentTaskId: "G1" }),
  row("G2", 6), row("X", 7, { parentTaskId: "G2" }), row("Y", 8, { parentTaskId: "G2" }),
  row("L", 9),
];
const dep = (taskId: string, dependsOnTaskId: string): RelDep => ({ taskId, dependsOnTaskId });

describe("taskRelations", () => {
  it("a task with sub-tasks is a group; one without is developed — whatever its TFS type", () => {
    const r = taskRelations(rows, []);
    expect(r.isGroup("G1")).toBe(true);
    expect(r.isGroup("A")).toBe(false);
    expect(r.isGroup("L")).toBe(false);
    expect(r.isGroup("C1")).toBe(false);
  });

  it("a sub-task that is dropped or set aside does not make its parent a group", () => {
    const r = taskRelations([row("P", 1), row("S", 2, { parentTaskId: "P", active: false })], []);
    expect(r.isGroup("P")).toBe(false);
  });

  it("depending on a group means depending on each of its sub-tasks", () => {
    const r = taskRelations(rows, [dep("L", "G1")]);
    expect(r.effectiveDeps("L")).toEqual([
      { id: "A", via: { through: "group", seq: 1 } },
      { id: "B", via: { through: "group", seq: 1 } },
    ]);
  });

  it("depending on a check means depending on the task it belongs to", () => {
    const r = taskRelations([row("T", 1), row("TC", 2, { kind: "check", parentTaskId: "T" }), row("U", 3)], [dep("U", "TC")]);
    expect(r.effectiveDeps("U")).toEqual([{ id: "T", via: { through: "check", seq: 2 } }]);
  });

  it("a sub-task waits for whatever its group waits for", () => {
    const r = taskRelations(rows, [dep("G2", "B")]);
    expect(r.effectiveDeps("X")).toEqual([{ id: "B", via: { through: "parent", seq: 6 } }]);
    expect(r.effectiveDeps("Y")).toEqual([{ id: "B", via: { through: "parent", seq: 6 } }]);
  });

  it("a declared dependency is kept once, and a task never waits for itself or its own group", () => {
    const r = taskRelations(rows, [dep("X", "B"), dep("G2", "B"), dep("X", "G2")]);
    expect(r.effectiveDeps("X")).toEqual([{ id: "B" }]);
  });

  it("dropped and inactive rows are not waited for", () => {
    const r = taskRelations([...rows, row("Z", 20, { state: "dropped" })], [dep("L", "Z")]);
    expect(r.effectiveDeps("L")).toEqual([]);
  });

  it("knows who waits for a task, including through its group", () => {
    const r = taskRelations(rows, [dep("L", "G1"), dep("C1", "B")]);
    expect(r.waitingOn("B").sort()).toEqual(["C1", "L"]);
    expect(r.waitingOn("G1")).toEqual(["L"]);
  });
});
