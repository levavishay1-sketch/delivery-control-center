import { describe, expect, it } from "vitest";
import { computeMeterArc } from "./meter";

describe("computeMeterArc", () => {
  it("returns a full offset (empty arc) at 0%", () => {
    const { circumference, offset } = computeMeterArc(0, 43);
    expect(offset).toBeCloseTo(circumference);
  });

  it("returns a zero offset (full arc) at 100%", () => {
    const { offset } = computeMeterArc(100, 43);
    expect(offset).toBeCloseTo(0);
  });

  it("returns half the circumference at 50%", () => {
    const { circumference, offset } = computeMeterArc(50, 43);
    expect(offset).toBeCloseTo(circumference / 2);
  });

  it("clamps values above 100 to a full arc", () => {
    const { offset } = computeMeterArc(140, 43);
    expect(offset).toBeCloseTo(0);
  });

  it("clamps negative values to an empty arc", () => {
    const { circumference, offset } = computeMeterArc(-20, 43);
    expect(offset).toBeCloseTo(circumference);
  });

  it("computes circumference from the given radius", () => {
    const { circumference } = computeMeterArc(50, 10);
    expect(circumference).toBeCloseTo(2 * Math.PI * 10);
  });
});
