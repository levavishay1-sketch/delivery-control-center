import { describe, expect, it } from "vitest";
import { requirementRung, structuralTypes } from "./task-types.ts";

const n = (id: string, parentId: string | null = null) => ({ id, parentId });

describe("structuralTypes — a node is typed by what it holds", () => {
  it("makes a leaf a Task and a node over Tasks a User Story", () => {
    const t = structuralTypes([n("g"), n("a", "g"), n("b", "g")]);
    expect([t.get("g"), t.get("a"), t.get("b")]).toEqual(["User Story", "Task", "Task"]);
  });

  it("goes up a rung per level of holding: Feature over stories, Epic over features", () => {
    const t = structuralTypes([n("e"), n("f", "e"), n("s", "f"), n("t", "s")]);
    expect(["e", "f", "s", "t"].map((id) => t.get(id))).toEqual(["Epic", "Feature", "User Story", "Task"]);
  });

  it("types a ragged tree by role, not by depth — a bare task beside a story is still a Task", () => {
    const t = structuralTypes([n("story"), n("t1", "story"), n("t2", "story"), n("bare")]);
    expect([t.get("story"), t.get("t1"), t.get("bare")]).toEqual(["User Story", "Task", "Task"]);
  });

  it("stops at Epic", () => {
    const t = structuralTypes([n("a"), n("b", "a"), n("c", "b"), n("d", "c"), n("e", "d")]);
    expect(t.get("a")).toBe("Epic");
  });

  it("does not loop on a ring of parents", () => {
    expect(() => structuralTypes([n("a", "b"), n("b", "a")])).not.toThrow();
  });
});

describe("requirementRung — more than one User Story needs a Feature above it", () => {
  const stories = (count: number) => Array.from({ length: count }, (_, i) => [n(`s${i}`), n(`s${i}t1`, `s${i}`), n(`s${i}t2`, `s${i}`)]).flat();

  it("makes the requirement a Feature over three parallel stories", () => {
    expect(requirementRung(stories(3))).toEqual({ type: "Feature", over: 3, of: "User Story" });
  });

  it("gives a single User Story nothing above it — a Feature is not needed", () => {
    expect(requirementRung(stories(1))).toBeNull();
  });

  it("gives loose tasks side by side nothing above them, as before", () => {
    expect(requirementRung([n("a"), n("b"), n("c")])).toBeNull();
  });

  it("makes the requirement an Epic over several Features", () => {
    const f = (i: number) => [n(`f${i}`), n(`f${i}s`, `f${i}`), n(`f${i}t`, `f${i}s`)];
    expect(requirementRung([...f(1), ...f(2)])).toEqual({ type: "Epic", over: 2, of: "Feature" });
  });

  it("has nothing to put above several Epics", () => {
    const e = (i: number) => [n(`e${i}`), n(`e${i}f`, `e${i}`), n(`e${i}s`, `e${i}f`), n(`e${i}t`, `e${i}s`)];
    expect(requirementRung([...e(1), ...e(2)])).toBeNull();
  });

  it("counts a bare task among the top level too — the stories still need their Feature", () => {
    expect(requirementRung([...stories(2), n("bare")])).toEqual({ type: "Feature", over: 3, of: "User Story" });
  });
});
