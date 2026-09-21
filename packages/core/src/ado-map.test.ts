import { describe, expect, it } from "vitest";
import { adoTypeForLevel, htmlToText, mapAdoState, mapAdoType } from "./ado-map.ts";

describe("adoTypeForLevel", () => {
  // The leaves are always Tasks; the depth of the tree picks the rungs above.
  it.each([
    [1, ["Task"]],
    [2, ["User Story", "Task"]],
    [3, ["Feature", "User Story", "Task"]],
    [4, ["Epic", "Feature", "User Story", "Task"]],
  ])("a tree %i deep maps level by level", (depth, expected) => {
    expect(expected.map((_, level) => adoTypeForLevel(level, depth))).toEqual(expected);
  });

  it("clamps a tree deeper than the ladder and one shallower than 1", () => {
    expect(adoTypeForLevel(0, 9)).toBe("Epic");
    expect(adoTypeForLevel(0, 0)).toBe("Task");
  });

  it("never runs past Task for a level below the leaves", () => {
    expect(adoTypeForLevel(7, 2)).toBe("Task");
  });
});

describe("mapAdoType / mapAdoState", () => {
  it("maps known types and states case-insensitively, ignoring padding", () => {
    expect(mapAdoType("  User Story ")).toBe("story");
    expect(mapAdoType("PRODUCT BACKLOG ITEM")).toBe("story");
    expect(mapAdoState(" In Progress")).toBe("building");
    expect(mapAdoState("Removed")).toBe("archived");
  });

  it("falls back to task / intake for anything unknown", () => {
    expect(mapAdoType("Something Custom")).toBe("task");
    expect(mapAdoState("Waiting on vendor")).toBe("intake");
  });
});

describe("htmlToText", () => {
  it("turns block ends and <br> into line breaks and drops other tags", () => {
    expect(htmlToText("<div>one</div><p>two<br/>three</p>")).toBe("one\ntwo\nthree");
  });

  it("decodes the common entities", () => {
    expect(htmlToText("a&nbsp;b &amp; c &lt;d&gt; &quot;e&quot; &#39;f&#39;")).toBe("a b & c <d> \"e\" 'f'");
  });

  it("collapses runs of blank lines", () => {
    expect(htmlToText("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\n\nb");
  });
});
