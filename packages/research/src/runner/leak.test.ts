import path from "node:path";
import { describe, expect, it } from "vitest";
import { diffSnapshots, scanCanaries, scanTranscriptPaths } from "./leak.ts";

/** The detection scanners on hand-made inputs (code tests; they say nothing about a real agent). */

const root = process.platform === "win32" ? "C:\\runs\\copy" : "/runs/copy";
const call = (name: string, input: Record<string, unknown>) => ({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
const details = (events: Record<string, unknown>[]) => scanTranscriptPaths(events, root).map((f) => f.detail);

describe("paths in the transcript", () => {
  it("a path inside the copy is not a finding, relative or absolute", () => {
    expect(details([call("Read", { file_path: "src/a.js" }), call("Read", { file_path: path.join(root, "src", "a.js") })])).toEqual([]);
  });
  it("a URL is not a path", () => {
    expect(details([call("Bash", { command: "curl http://example.invalid/x && curl https://127.0.0.1:8080/v1" })])).toEqual([]);
  });
  it("an absolute path outside, a home reference and a way out with ..", () => {
    const outside = process.platform === "win32" ? "C:\\Users\\someone\\.claude\\CLAUDE.md" : "/home/someone/.claude/CLAUDE.md";
    const d = details([call("Read", { file_path: outside }), call("Bash", { command: "cat ~/.gitconfig" }), call("Read", { file_path: "../../harness/secret.txt" })]);
    expect(d.some((x) => x.includes("CLAUDE.md"))).toBe(true);
    expect(d.some((x) => x.includes("home reference"))).toBe(true);
    expect(d.some((x) => x.includes("leaves the root"))).toBe(true);
  });
  it("only assistant tool calls are read, not tool results", () => {
    expect(details([{ type: "user", message: { content: [{ type: "tool_result", content: "C:\\Windows\\System32" }] } }])).toEqual([]);
  });
});

describe("canaries and snapshots", () => {
  it("a token is found wherever it appears, and only there", () => {
    const f = scanCanaries({ stdout: "x DCC-CANARY-1 y", stderr: "" }, [{ token: "DCC-CANARY-1", file: "a" }, { token: "DCC-CANARY-2", file: "b" }]);
    expect(f).toEqual([{ mechanism: "canary", detail: "token from a found in stdout" }]);
  });
  it("added, changed and removed files", () => {
    const before = new Map([["a", "1"], ["b", "2"]]);
    const after = new Map([["a", "1"], ["b", "3"], ["c", "4"]]);
    expect(diffSnapshots("h", before, after).map((f) => f.detail).sort()).toEqual(["h: added c", "h: changed b"]);
    expect(diffSnapshots("h", after, before).map((f) => f.detail).sort()).toEqual(["h: changed b", "h: removed c"]);
  });
});
