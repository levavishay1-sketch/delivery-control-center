import { describe, expect, it } from "vitest";
import { chooseBase, type DependencyFacts } from "./task-base.ts";

const dep = (id: string, over: Partial<DependencyFacts> = {}): DependencyFacts => ({
  id, seq: Number(id.replace(/\D/g, "")) || 1, intent: `task ${id}`, state: "in_progress", branch: `task/R-${id}`, merged: false, ...over,
});
const none = () => false;

describe("chooseBase", () => {
  it("starts from the default branch when nothing it depends on is open", () => {
    expect(chooseBase([], none)).toEqual({ on: null, missing: [] });
    expect(chooseBase([dep("a1", { merged: true })], none)).toEqual({ on: null, missing: [] });
  });

  it("builds on the one dependency that already has code", () => {
    const a = dep("a1");
    expect(chooseBase([a], none)).toEqual({ on: a, missing: [] });
  });

  it("names a dependency that was never developed as missing, and one finished without code as nothing to wait for", () => {
    const a = dep("a1", { branch: null, state: "pending" });
    const b = dep("b2", { branch: null, state: "done" });
    expect(chooseBase([a, b], none)).toEqual({ on: null, missing: [{ dep: a, why: "not_developed" }] });
  });

  it("stacks on the last link of a chain, which already holds the others", () => {
    const a = dep("a1"), b = dep("b2");
    const plan = chooseBase([a, b], (x, y) => x === b && y === a);
    expect(plan).toEqual({ on: b, missing: [] });
  });

  it("does not pick between two lines of work that are not in one line — both are missing", () => {
    const a = dep("a1"), b = dep("b2");
    expect(chooseBase([a, b], none)).toEqual({ on: null, missing: [{ dep: a, why: "parallel" }, { dep: b, why: "parallel" }] });
  });

  it("builds on the developed one and still names the one not developed yet", () => {
    const a = dep("a1"), b = dep("b2", { branch: null });
    expect(chooseBase([a, b], none)).toEqual({ on: a, missing: [{ dep: b, why: "not_developed" }] });
  });
});
