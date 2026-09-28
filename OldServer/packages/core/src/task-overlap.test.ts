import { describe, expect, it } from "vitest";
import { readMergeTree, sharedFiles } from "./task-overlap.ts";

describe("sharedFiles", () => {
  it("names the files both tasks changed", () => {
    expect(sharedFiles(["a.js", "b.cs", "c.cs"], ["c.cs", "a.js", "z"])).toEqual(["a.js", "c.cs"]);
  });
  it("is empty when they share nothing", () => {
    expect(sharedFiles(["a"], ["b"])).toEqual([]);
    expect(sharedFiles([], ["b"])).toEqual([]);
  });
});

describe("readMergeTree", () => {
  it("reads a clean merge", () => {
    expect(readMergeTree(0, "abc123")).toEqual({ clean: true });
  });
  it("lists the conflicted files, not the messages after them", () => {
    const out = "abc123\nsrc/a.js\nsrc/b.cs\n\nAuto-merging src/a.js\nCONFLICT (content): Merge conflict in src/a.js";
    expect(readMergeTree(1, out)).toEqual({ clean: false, conflictFiles: ["src/a.js", "src/b.cs"] });
  });
  it("does not call an error a conflict", () => {
    expect(readMergeTree(128, "fatal: not a git repository")).toBeNull();
  });
});
