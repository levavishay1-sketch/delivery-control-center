import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendLines, mergeSettings, repoFacts, stripFence } from "./build.ts";
import { checkClaims, jointCheck, validateAgent, validateSettings, validateSkill } from "./verify.ts";
import type { Component, RepoProfile } from "./types.ts";

/**
 * The build's merging of shared files and the validators that need no
 * repository: pure on a scratch directory. The hooks and the scripts are
 * executed for real in the catalog's own tests and in `prove:onboarding`.
 */
let dir: string;
beforeAll(() => { dir = mkdtempSync(path.join(os.tmpdir(), "dcc-verify-test-")); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const card = (o: Partial<Component>): Component => ({
  key: "k", kind: "rule", family: "knowledge", title_he: "t", why_he: "w", what_he: "x", source: "rule", sourceRef: null, group: "approval", risk: "reversible", contextTokens: null,
  verifyHow_he: "", status: "approved", params: {}, files: [], validation: null, delta: null, questions: [], decidedBy: null, decidedAt: null, declineReason: null, ...o,
});

describe("shared files are merged, never overwritten", () => {
  it("settings.json gains deny rules, hooks and plugins from several components without losing any", () => {
    mergeSettings(dir, { permissions: { deny: ["Read(.env)"] } });
    mergeSettings(dir, { permissions: { deny: ["Read(.env)", "Edit(gen/**)"] }, hooks: { PreToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: "node a.mjs" }] }] } });
    mergeSettings(dir, { hooks: { PreToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: "node b.mjs" }] }, { matcher: "Bash", hooks: [{ type: "command", command: "node c.mjs" }] }] } });
    mergeSettings(dir, { enabledPlugins: { "x@y": true } });
    const s = JSON.parse(readFileSync(path.join(dir, ".claude/settings.json"), "utf8")) as { permissions: { deny: string[] }; hooks: Record<string, { matcher: string; hooks: unknown[] }[]>; enabledPlugins: Record<string, boolean> };
    expect(s.permissions.deny).toEqual(["Read(.env)", "Edit(gen/**)"]);
    expect(s.hooks.PreToolUse!.map((h) => [h.matcher, h.hooks.length])).toEqual([["Edit|Write", 2], ["Bash", 1]]);
    expect(s.enabledPlugins["x@y"]).toBe(true);
    expect(validateSettings(dir, card({ kind: "permission", params: { deny: [".env", "gen/**"] } })).passed).toBe(true);
  });
  it("lines are appended once under a header", () => {
    writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");
    appendLines(dir, ".gitignore", ["bin/", "obj/"], "# added by DCC");
    appendLines(dir, ".gitignore", ["obj/", "packages/"], "# added by DCC");
    expect(readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe("node_modules/\n\n# added by DCC\nbin/\nobj/\npackages/\n");
  });
  it("a model's answer loses its fence", () => {
    expect(stripFence("```md\n# hi\n```")).toBe("# hi\n");
    expect(stripFence("plain")).toBe("plain\n");
  });
});

describe("claims are checked against the files", () => {
  it("a path in backticks must exist; a command is noted, not failed", () => {
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "src/a.ts"), "");
    const r = checkClaims("Edit `src/a.ts`, never `src/missing.ts`; run `npm run build`.", dir, ["npm run build"]);
    expect(r.checked).toBe(3);
    expect(r.missing).toEqual(["src/missing.ts"]);
  });
});

describe("skills and agents", () => {
  it("a skill needs a name, a description long enough to trigger on, and a body", () => {
    mkdirSync(path.join(dir, ".claude/skills/x"), { recursive: true });
    writeFileSync(path.join(dir, ".claude/skills/x/SKILL.md"), "---\nname: x\ndescription: short\n---\nbody");
    expect(validateSkill(card({ kind: "skill", files: [".claude/skills/x/SKILL.md"] }), dir).passed).toBe(false);
    writeFileSync(path.join(dir, ".claude/skills/x/SKILL.md"), `---\nname: x\ndescription: Runs the affected tests of a change. Use before saying a change is done.\n---\n${"# Steps\n\n1. run `src/a.ts`\n".repeat(12)}`);
    expect(validateSkill(card({ kind: "skill", files: [".claude/skills/x/SKILL.md"] }), dir).passed).toBe(true);
  });
  it("an agent that can write is refused; a read-only one with a checklist passes", () => {
    mkdirSync(path.join(dir, ".claude/agents"), { recursive: true });
    writeFileSync(path.join(dir, ".claude/agents/r.md"), "---\nname: r\ndescription: reviews\ntools: Read, Edit\n---\n- a\n- b\n- c\n- d");
    expect(validateAgent(card({ kind: "agent", files: [".claude/agents/r.md"] }), dir).passed).toBe(false);
    writeFileSync(path.join(dir, ".claude/agents/r.md"), "---\nname: r\ndescription: reviews\ntools: Glob, Grep, Read, Bash\n---\n- a\n- b\n- c\n- d");
    expect(validateAgent(card({ kind: "agent", files: [".claude/agents/r.md"] }), dir)).toMatchObject({ passed: true });
  });
});

describe("the joint check", () => {
  it("flags a skill under a read deny, counts the always-loaded context, ignores shared files as duplicates", () => {
    writeFileSync(path.join(dir, "AGENTS.md"), "x".repeat(400));
    const cards = [
      card({ key: "deny", kind: "permission", params: { deny: ["Read(.claude/skills/**)"] }, files: [".claude/settings.json"], status: "verified" }),
      card({ key: "skill", kind: "skill", files: [".claude/skills/x/SKILL.md"], status: "verified" }),
      card({ key: "rule1", files: ["AGENTS.md"], status: "verified" }), card({ key: "rule2", files: ["AGENTS.md"], status: "verified" }),
      card({ key: "mcp", kind: "mcp", contextTokens: 2100, files: [".mcp.json"], status: "installed" }),
    ];
    const j = jointCheck(cards, dir);
    expect(j.contradictions).toHaveLength(1);
    expect(j.duplicates).toEqual([]);
    expect(j.alwaysLoadedTokens).toBe(100 + 2100);
  });
});

describe("the facts the templates get", () => {
  it("derives the commands from the profile", () => {
    const p = { build: { system: ["package.json scripts"], commands: ["npm run build   # -> tsc"] }, ci: { present: true, systems: ["github-actions"], workflows: [], commands: ["npm test"] }, tests: { frameworks: ["vitest"], test_files: 3, test_dirs: [] }, lint_format: ["eslint"], languages: [{ language: "TypeScript", files: 1, lines: 1 }], package_managers: ["npm"], windows_build: { windows_only_build: false } } as unknown as RepoProfile;
    expect(repoFacts(p, "r", "main")).toMatchObject({ buildCommand: "npm run build", testCommand: "npm test", lintCommand: "npx eslint .", packageManager: "npm", windowsOnly: false });
  });
});
