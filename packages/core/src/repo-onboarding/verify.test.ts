import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DOSSIER_FILE, appendLines, buildComponents, componentName, ensureFrontmatter, mergeSettings, nameFrom, repoFacts, setFrontmatterName, stripFence, stripPreamble, writeDossier, type Author } from "./build.ts";
import { checkClaims, hookRouting, jointCheck, mcpPlaceholder, statusAfter, validateAgent, validateGitattributes, validateMcp, validateScript, validateSettings, validateSkill, validateText } from "./verify.ts";
import type { Component, RepoProfile } from "./types.ts";

/**
 * The build's composing of shared files, its names and its second attempt, and the validators: pure on scratch
 * directories (a `git init` for check-attr). The hooks and the scripts are executed for real, here and in the
 * catalog's own tests; the whole run with its database is `prove:onboarding`.
 */
const dirs: string[] = [];
const scratch = () => { const d = mkdtempSync(path.join(os.tmpdir(), "dcc-verify-test-")); dirs.push(d); return d; };
let dir: string;
beforeAll(() => { dir = scratch(); });
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const card = (o: Partial<Component>): Component => ({
  key: "k", kind: "rule", family: "knowledge", title_he: "t", why_he: "w", what_he: "x", source: "rule", sourceRef: null, group: "approval", risk: "reversible", contextTokens: null,
  verifyHow_he: "", status: "approved", params: {}, files: [], validation: null, delta: null, questions: [], decidedBy: null, decidedAt: null, declineReason: null, ...o,
});
const write = (d: string, rel: string, text: string) => { mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); writeFileSync(path.join(d, rel), text); };

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
});

describe("a model's answer, as a file", () => {
  it("loses its fence", () => {
    expect(stripFence("```md\n# hi\n```")).toBe("# hi\n");
    expect(stripFence("plain")).toBe("plain\n");
  });
  it("loses the talk before its frontmatter — with the fence that talk opened", () => {
    const fm = "---\nname: x\ndescription: d\n---\nbody";
    expect(stripPreamble(`Now I have all the evidence needed. Here is the file content:\n\n${fm}`, true)).toBe(fm);
    expect(stripPreamble(`Here it is:\n\`\`\`markdown\n${fm}\n\n\`\`\`bash\nnpm test\n\`\`\`\n\`\`\`\nHope this helps.`, true)).toBe(`${fm}\n\n\`\`\`bash\nnpm test\n\`\`\``);
    expect(stripPreamble(fm, true)).toBe(fm);
    expect(stripPreamble("Intro\n---\nnot frontmatter", false)).toBe("Intro\n---\nnot frontmatter");
  });
  it("is named from stable keys: ASCII, cut to 40 and trimmed after the cut, never 'undefined', never from a Hebrew title", () => {
    expect(componentName(card({ key: "skill_release_build", params: { process: "release", step: "build" } }))).toBe("release-build");
    expect(componentName(card({ key: "reviewer_1_skill", params: {} }))).toBe("reviewer-1-skill");
    expect(nameFrom(`${"a".repeat(39)}_b`, "k")).toBe("a".repeat(39));
    expect(nameFrom("סוכן בדיקה", "agent_review")).toBe("agent-review");
    expect(nameFrom("סוכן", "סוכן")).toMatch(/^c-[0-9a-f]{8}$/);
    expect(setFrontmatterName("---\nname: Wrong Name\ndescription: d\n---\nb", "right")).toBe("---\nname: right\ndescription: d\n---\nb");
    expect(setFrontmatterName("---\ndescription: d\n---\nb", "right")).toBe("---\nname: right\ndescription: d\n---\nb");
    // No frontmatter at all (the author wrote the body alone): one is made from the card, and the body is kept.
    const agentCard = { kind: "agent" as const, title_he: "סוקר שינויי פלאגין", why_he: "כי", what_he: "בודק כל שינוי בפלאגין מול הרישום." };
    const made = ensureFrontmatter("## Role\nChecks plugins.\n", agentCard, "plugin-reviewer");
    expect(made.startsWith("---\nname: plugin-reviewer\ndescription: \"סוקר שינויי פלאגין. בודק כל שינוי בפלאגין מול הרישום.\"\ntools: Glob, Grep, Read, Bash\nmodel: sonnet\n---\n")).toBe(true);
    expect(made.endsWith("## Role\nChecks plugins.\n")).toBe(true);
    expect(ensureFrontmatter("---\nname: x\ndescription: d\n---\nbody", { ...agentCard, kind: "skill" as const }, "right")).toBe("---\nname: right\ndescription: d\n---\nbody");
  });
});

describe("claims are checked against the files and this machine", () => {
  let repo: string;
  beforeAll(() => {
    repo = scratch();
    write(repo, "src/a.ts", "");
    write(repo, "src/Model/Entities.cs", "");
    write(repo, "src/Model/EBG/OptionSets.cs", "");
    write(repo, "scripts/gate.mjs", "");
    write(repo, "package.json", JSON.stringify({ scripts: { build: "tsc", lint: "eslint ." }, devDependencies: { typescript: "5" } }));
    write(repo, "Pcf/Control/package.json", JSON.stringify({ scripts: { build: "pcf-scripts build" } }));
  });
  it("a path must exist; one missing path fails — no tolerance", () => {
    const r = checkClaims("Edit `src/a.ts`; the model is `src/Model/Entities.cs`; also `src/nothing.ts`.", repo);
    expect(r).toMatchObject({ checked: 3, found: 2, missing: ["src/nothing.ts"] });
  });
  it("a relative path is looked up from the text's own folder, then the root, then as the end of a real path; a bare name anywhere", () => {
    expect(checkClaims("Regenerate `Model/Entities.cs`.", repo, { file: "src/CLAUDE.md" }).missing).toEqual([]);
    expect(checkClaims("Options live in `EBG/OptionSets.cs` and `Entities.cs`.", repo, { file: "AGENTS.md" }).missing).toEqual([]);
    expect(checkClaims("Options live in `EBG/Missing.cs`.", repo, { file: "AGENTS.md" }).missing).toEqual(["EBG/Missing.cs"]);
  });
  it("a package id, a MIME type, a scoped package and a call are not path claims; a negative mention is not a claim", () => {
    expect(checkClaims("Uses `FakeXrmEasy.9`, `application/json`, `@dcc/core`, `console.log`.", repo).checked).toBe(0);
    expect(checkClaims("Never commit `secrets/prod.json`; never run `pac plugin push`.", repo, { tools: { pac: null } })).toMatchObject({ checked: 0, missing: [] });
    expect(checkClaims("Registration with `pac plugin push` is a person's job.", repo, { tools: { pac: null } }).missing).toEqual([]);
  });
  it("a command's first word must be a tool this machine has — the diagnosis decides, `dotnet msbuild` apart from `msbuild`", () => {
    const tools = { msbuild: null, dotnet: "C:/dotnet/dotnet.exe", dotnet_msbuild: "C:/dotnet/dotnet.exe", "vstest.console": null };
    expect(checkClaims("Build with `msbuild App.sln /t:Build`.", repo, { tools }).missing).toEqual(["msbuild App.sln /t:Build"]);
    expect(checkClaims("Build with `dotnet msbuild App.sln`.", repo, { tools }).missing).toEqual([]);
    expect(checkClaims("Test with `vstest.console.exe bin/T.dll`.", repo, { tools }).missing).toEqual(["vstest.console.exe bin/T.dll"]);
    expect(checkClaims("Run `git status` and `npx vitest`.", repo, { tools: {} }).missing).toEqual([]);
  });
  it("`npm run <script>` needs the script; a folder's own instructions mean its own package.json", () => {
    expect(checkClaims("Run `npm run build` and `npm run lint`, then `npm run deploy`.", repo).missing).toEqual(["npm run deploy"]);
    expect(checkClaims("Run `npm run build|lint`.", repo).missing).toEqual([]);
    expect(checkClaims("From here: `npm run build`.", repo, { file: "Pcf/CLAUDE.md" }).missing).toEqual([]);
    rmSync(path.join(repo, "package.json"));
    expect(checkClaims("From here: `npm run lint`.", repo, { file: "Pcf/CLAUDE.md" }).missing).toEqual(["npm run lint"]);
    expect(checkClaims("In a control (`cd Pcf/<name>`), `npm run build`.", repo, { file: "AGENTS.md" }).missing).toEqual([]);
    expect(checkClaims("A control: `cd Pcf/Control && npm run build`. Another: `cd Pcf/Nope && npm run build`.", repo).missing).toEqual(["cd Pcf/Nope && npm run build"]);
    write(repo, "package.json", JSON.stringify({ scripts: { build: "tsc", lint: "eslint ." }, devDependencies: { typescript: "5" } }));
  });
  it("`node <file>` needs the file; a shell block's lines are commands too", () => {
    expect(checkClaims("Gate: `node scripts/gate.mjs`; old: `node scripts/old.mjs`.", repo).missing).toEqual(["node scripts/old.mjs"]);
    const block = "Build:\n\n```sh\nnpm run build\n```\n\nRelease:\n\n```bash\n$ npm run release\n```\n\n```ts\nnpm run nothing\n```\n";
    expect(checkClaims(block, repo)).toMatchObject({ checked: 2, missing: ["$ npm run release"] });
  });
  it("still takes the profile's commands in the third place from earlier callers", () => {
    expect(checkClaims("Edit `src/a.ts`.", repo, ["npm run build"])).toMatchObject({ checked: 1, found: 1 });
  });
});

describe("text kinds end passed or failed", () => {
  let repo: string;
  beforeAll(() => { repo = scratch(); write(repo, "src/a.ts", ""); write(repo, "AGENTS.md", "- other card: `src/gone.ts`\n"); });
  it("a rule is judged on its own line, not on the rest of AGENTS.md", () => {
    expect(validateText(card({ kind: "rule", params: { text: "Edit `src/a.ts` only." }, files: ["AGENTS.md"] }), repo).passed).toBe(true);
    expect(validateText(card({ kind: "rule", params: { text: "Never write outside `src/`." }, files: ["AGENTS.md"] }), repo).passed).toBe(true);
    const bad = validateText(card({ kind: "rule", params: { text: "Generated: `src/gen/x.ts`." }, files: ["AGENTS.md"] }), repo);
    expect(bad).toMatchObject({ passed: false });
    expect(bad.detail).toContain("src/gen/x.ts");
  });
  it("a document that names nothing checkable fails; one true claim makes it specific", () => {
    write(repo, "pkg/CLAUDE.md", "# pkg\n\nBuild and test from the root. Follow the conventions.\n");
    const generic = validateText(card({ kind: "scaffold", files: ["pkg/CLAUDE.md"] }), repo);
    expect(generic.passed).toBe(false);
    expect(generic.detail).toContain("אין טענה שאפשר לבדוק");
    write(repo, "pkg/CLAUDE.md", "# pkg\n\nThe entry point is `src/a.ts`.\n");
    expect(validateText(card({ kind: "scaffold", files: ["pkg/CLAUDE.md"] }), repo).passed).toBe(true);
  });
});

describe("skills and agents", () => {
  let repo: string;
  beforeAll(() => { repo = scratch(); write(repo, "src/a.ts", ""); });
  const body = "# Steps\n\n1. run the checks on `src/a.ts`\n".repeat(12);
  it("a skill needs frontmatter on its first line, a Claude Code name, a description long enough to trigger on, and a body", () => {
    write(repo, ".claude/skills/x/SKILL.md", "---\nname: x\ndescription: short\n---\nbody");
    expect(validateSkill(card({ kind: "skill", files: [".claude/skills/x/SKILL.md"] }), repo).passed).toBe(false);
    write(repo, ".claude/skills/x/SKILL.md", `Here is the skill:\n---\nname: x\ndescription: Runs the affected tests of a change. Use before saying a change is done.\n---\n${body}`);
    expect(validateSkill(card({ kind: "skill", files: [".claude/skills/x/SKILL.md"] }), repo).passed).toBe(false);
    write(repo, ".claude/skills/x/SKILL.md", `---\nname: Undefined Undefined\ndescription: Runs the affected tests of a change. Use before saying a change is done.\n---\n${body}`);
    expect(validateSkill(card({ kind: "skill", files: [".claude/skills/x/SKILL.md"] }), repo).detail).toContain("Undefined Undefined");
    write(repo, ".claude/skills/x/SKILL.md", `---\nname: x\ndescription: Runs the affected tests of a change. Use before saying a change is done.\n---\n${body}`);
    expect(validateSkill(card({ kind: "skill", files: [".claude/skills/x/SKILL.md"] }), repo).passed).toBe(true);
  });
  it("a skill whose body names a path that does not exist fails — it is not 'not checked'", () => {
    write(repo, ".claude/skills/y/SKILL.md", `---\nname: y\ndescription: Runs the affected tests of a change. Use before saying a change is done.\n---\n${body}\nThe tests are in \`Test/Alt.Test.Crm/Tests.cs\`.\n`);
    const v = validateSkill(card({ kind: "skill", files: [".claude/skills/y/SKILL.md"] }), repo);
    expect(v.passed).toBe(false);
    expect(v.detail).toContain("Test/Alt.Test.Crm/Tests.cs");
  });
  it("an agent that can write is refused; a read-only one with a checklist — bullets or numbers — passes", () => {
    write(repo, ".claude/agents/r.md", "---\nname: r\ndescription: reviews\ntools: Read, Edit\n---\n- a\n- b\n- c\n- d");
    expect(validateAgent(card({ kind: "agent", files: [".claude/agents/r.md"] }), repo).passed).toBe(false);
    write(repo, ".claude/agents/r.md", "---\nname: r\ndescription: reviews\ntools: Glob, Grep, Read, Bash\n---\n- a\n- b\n- c\n- d");
    expect(validateAgent(card({ kind: "agent", files: [".claude/agents/r.md"] }), repo)).toMatchObject({ passed: true });
    write(repo, ".claude/agents/r.md", "---\nname: r\ndescription: reviews\ntools: Glob, Grep, Read, Bash\n---\nChecklist:\n\n1. exports of `src/a.ts` stay\n2) no secrets\n3. the build passes\n");
    expect(validateAgent(card({ kind: "agent", files: [".claude/agents/r.md"] }), repo)).toMatchObject({ passed: true });
    write(repo, ".claude/agents/r.md", "Now I have the evidence.\n---\nname: r\ndescription: reviews\ntools: Read\n---\n1. a\n2. b\n3. c\n");
    expect(validateAgent(card({ kind: "agent", files: [".claude/agents/r.md"] }), repo).passed).toBe(false);
  });
});

describe("hooks, .gitattributes, connections, the gate", () => {
  it("a hook passes only when settings.json routes its event to it, with a matcher that catches its tool", () => {
    const repo = scratch();
    const hook = card({ kind: "hook", params: { template: "block-commands" }, files: [".claude/hooks/block-commands.mjs", ".claude/settings.json"] });
    expect(hookRouting(hook, repo)).toContain("settings.json");
    write(repo, ".claude/settings.json", JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/block-commands.mjs"' }] }] } }));
    expect(hookRouting(hook, repo)).toContain("Bash");
    write(repo, ".claude/settings.json", JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash|PowerShell", hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/block-commands.mjs"' }] }] } }));
    expect(hookRouting(hook, repo)).toBeNull();
    write(repo, ".claude/settings.json", JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/block-commands.mjs"' }] }] } }));
    expect(hookRouting(hook, repo)).toContain("PreToolUse");
  });
  it(".gitattributes is asked of git itself: a line that does not reach the files under the path fails", () => {
    const repo = scratch();
    if (spawnSync("git", ["init", "-q"], { cwd: repo }).status !== 0) return; // no git here: the line check alone, covered above
    write(repo, "gen/Model.cs", "// generated\n");
    const c = card({ kind: "gitattributes", params: { paths: ["gen"] }, files: [".gitattributes"] });
    write(repo, ".gitattributes", "gen linguist-generated=true\n");
    expect(validateGitattributes(c, repo)).toMatchObject({ passed: false, how: "git check-attr" });
    write(repo, ".gitattributes", "gen/** linguist-generated=true\n");
    expect(validateGitattributes(c, repo)).toMatchObject({ passed: true, how: "git check-attr" });
  });
  it("an MCP entry that parses is configured, not verified; an address with a slot is never written", () => {
    const repo = scratch();
    write(repo, ".mcp.json", JSON.stringify({ mcpServers: { docs: { type: "http", url: "https://mcp.example.com/mcp" } } }));
    const mcp = card({ kind: "mcp", params: { server: "docs" }, files: [".mcp.json"] });
    const v = validateMcp(mcp, repo);
    expect(v.passed).toBe(true);
    expect(statusAfter(mcp, v)).toBe("configured");
    expect(statusAfter(card({ kind: "skill" }), v)).toBe("verified");
    expect(statusAfter(card({ kind: "skill" }), { ...v, passed: null })).toBe("failed");
    expect(mcpPlaceholder(card({ kind: "mcp", params: { url: "https://{org}.crm4.dynamics.com/api/mcp" } }))).toBe("https://{org}.crm4.dynamics.com/api/mcp");
    expect(mcpPlaceholder(card({ kind: "mcp", params: { server: "x", placeholder: true } }))).toBe("x");
    expect(mcpPlaceholder(mcp)).toBeNull();
    write(repo, ".mcp.json", JSON.stringify({ mcpServers: { docs: { type: "http", url: "https://{org}.example.com/mcp" } } }));
    expect(validateMcp(mcp, repo).passed).toBe(false);
  });
  it("a plugin is configured when settings.json enables its key", () => {
    const repo = scratch();
    mergeSettings(repo, { enabledPlugins: { "typescript-lsp@claude-plugins-official": true } });
    const lsp = card({ kind: "lsp", params: { pluginKey: "typescript-lsp@claude-plugins-official" }, files: [".claude/settings.json"] });
    expect(validateSettings(repo, lsp).passed).toBe(true);
    expect(validateSettings(repo, card({ kind: "lsp", params: { pluginKey: "other@x" } })).passed).toBe(false);
  });
  it("a gate that cannot run here fails — it is not delivered as 'not checked'", () => {
    const repo = scratch();
    write(repo, "scripts/dcc-verify.mjs", 'console.log("VERIFY: cannot run here (Windows-only build)"); process.exit(3);\n');
    const v = validateScript(card({ kind: "script", files: ["scripts/dcc-verify.mjs"] }), repo);
    expect(v.passed).toBe(false);
    expect(v.detail).toContain("cannot run here");
  });
});

describe("the joint check", () => {
  it("flags a skill under a read deny, counts the always-loaded context and the MCP servers really written, ignores shared files as duplicates", () => {
    writeFileSync(path.join(dir, "AGENTS.md"), "x".repeat(400));
    const cards = [
      card({ key: "deny", kind: "permission", params: { deny: ["Read(.claude/skills/**)"] }, files: [".claude/settings.json"], status: "verified" }),
      card({ key: "skill", kind: "skill", files: [".claude/skills/x/SKILL.md"], status: "verified" }),
      card({ key: "rule1", files: ["AGENTS.md"], status: "verified" }), card({ key: "rule2", files: ["AGENTS.md"], status: "verified" }),
      card({ key: "mcp", kind: "mcp", contextTokens: 2100, files: [".mcp.json"], status: "configured" }),
      card({ key: "mcp_slot", kind: "mcp", contextTokens: 700, files: [], status: "configured" }),
    ];
    const j = jointCheck(cards, dir);
    expect(j.contradictions).toHaveLength(1);
    expect(j.duplicates).toEqual([]);
    expect(j.alwaysLoadedTokens).toBe(100 + 2100);
  });
});

/* ── the build ────────────────────────────────────────────────────── */

const profile = (tools: Record<string, string | null> = {}): RepoProfile => ({
  name: "p", path: "/p", languages: [{ language: "TypeScript", files: 1, lines: 1 }], frameworks: [], package_managers: ["npm"],
  build: { system: ["package.json scripts"], commands: ['node -e "process.exit(0)"'] }, tests: { frameworks: [], test_files: 0, test_dirs: [] }, lint_format: [],
  ci: { present: false, systems: [], workflows: [], commands: [] }, monorepo: { is_monorepo: false, workspaces: [], packages: [] },
  generated_code: { paths: [], header_marked_files: 0, header_sample: [], header_dirs: [] },
  secrets: { total: 0, by_kind: {}, files: [], sensitive_files: [], in_test_files: 0, outside_tests: 0, dotenv_examples: [] },
  external_systems: {}, ai_config: { present: false, files: [], count: 0, kinds: [], sizes: {} },
  docs: { readme: "README.md", readme_bytes: 100, docs_dir: false, docs_files: 0, adrs: [], contributing: [], architecture_docs: [], license: [], changelog: [], license_kind: "none" },
  windows_build: { sln: 0, csproj: 0, snk: 0, vbproj: 0, packages_config: 0, ps1: 0, bat_cmd: 0, legacy_netframework: false, dll_checked_in: 0, exe_checked_in: 0, windows_only_build: false },
  environment: { devcontainer: false, dockerfile: [], docker_compose: [], makefile: false, nix_flake: false, editorconfig: false, tool_versions: [], tools },
  size: { files: 3, code_lines: 1, bytes_on_disk_excl_git: 1, largest_files: [], top_level_dirs: ["src"] }, git: { available: false },
});

describe("the facts the templates get", () => {
  it("derives the commands from the profile", () => {
    const p = { build: { system: ["package.json scripts"], commands: ["npm run build   # -> tsc"] }, ci: { present: true, systems: ["github-actions"], workflows: [], commands: ["npm test"] }, tests: { frameworks: ["vitest"], test_files: 3, test_dirs: [] }, lint_format: ["eslint"], languages: [{ language: "TypeScript", files: 1, lines: 1 }], package_managers: ["npm"], windows_build: { windows_only_build: false } } as unknown as RepoProfile;
    expect(repoFacts(p, "r", "main")).toMatchObject({ buildCommand: "npm run build", testCommand: "npm test", lintCommand: "npx eslint .", packageManager: "npm", windowsOnly: false });
  });
  it("hands the templates what this machine has and what git tracks: the tools, the test projects and their commands, the solution, the web projects", () => {
    const base = profile({ msbuild: null, dotnet: "C:/dotnet/dotnet.exe", dotnet_msbuild: "C:/dotnet/dotnet.exe" });
    const p: RepoProfile = {
      ...base, build: { system: ["msbuild"], commands: ["msbuild Altshuler.sln /t:Build"] },
      tests: { frameworks: ["MSTest"], test_files: 4, test_dirs: [], projects: ["Test/Alt.Test.CrmApi"], commands: ["dotnet test Test/Alt.Test.CrmApi/Alt.Test.CrmApi.csproj"] },
      windows_build: { ...base.windows_build, windows_only_build: true, web_app_projects: 2 },
    };
    expect(repoFacts(p, "r", null)).toMatchObject({
      buildCommand: "msbuild Altshuler.sln /t:Build", windowsOnly: true, tools: { msbuild: null, dotnet: "C:/dotnet/dotnet.exe", dotnet_msbuild: "C:/dotnet/dotnet.exe" },
      testProjects: ["Test/Alt.Test.CrmApi"], testCommands: ["dotnet test Test/Alt.Test.CrmApi/Alt.Test.CrmApi.csproj"], solution: "Altshuler.sln", webAppProjects: 2,
    });
    expect(repoFacts(profile(), "r", null)).toMatchObject({ testProjects: null, testCommands: null, solution: null, webAppProjects: null });
  });
});

describe("the build: shared files from what passed, failures taken out, one second attempt", () => {
  const SKILL_OK = "---\nname: whatever\ndescription: Builds a release of this repository and checks it before anyone says it is done.\nallowed-tools: Read, Grep, Glob, Bash\n---\n# Build a release\n\n" + "1. Change `src/a.ts` and run `npm run build` from the root.\n".repeat(6);
  const AGENT_OK = "---\nname: whatever\ndescription: Reviews a release change; call it after a release build.\ntools: Glob, Grep, Read, Bash\nmodel: sonnet\n---\nChecks a release.\n\n1. exports of `src/a.ts` stay stable\n2. `npm run build` passes\n3. no secret in the diff\n";
  let repo: string;
  let calls: { key: string; fix?: string }[];
  let run: Awaited<ReturnType<typeof buildComponents>>;
  const by = (key: string) => run.find((o) => o.key === key)!;
  beforeAll(async () => {
    repo = scratch();
    write(repo, "README.md", "# p\n\nThis repository builds a small TypeScript library that other services import to price their trades.\n");
    write(repo, "src/a.ts", "export const a = 1;\n");
    write(repo, "package.json", `${JSON.stringify({ name: "p", scripts: { build: "tsc" } }, null, 2)}\n`);
    calls = [];
    const author: Author = async ({ component, fix }) => {
      calls.push({ key: component.key, fix });
      if (component.key === "skill_release_build") return fix ? `Here is the fixed file:\n${SKILL_OK}` : `Now I have all the evidence needed. Here is the file content:\n\n${SKILL_OK}\nTests: \`Test/Alt.Test.Crm/Tests.cs\`.\n`;
      if (component.key === "agent_release_review") return `\`\`\`markdown\n${AGENT_OK}\`\`\``;
      return "unused";
    };
    const cards: Component[] = [
      card({ key: "agents_md_from_profile", kind: "scaffold", params: { template: "agents-md" } }),
      card({ key: "rule_good", kind: "rule", params: { text: "Change `src/a.ts` only through its exports." } }),
      card({ key: "rule_bad", kind: "rule", params: { text: "Generated code lives in `src/gen/Entities.ts`." } }),
      card({ key: "local_gate_script", kind: "script", family: "verification", params: { template: "local-gate", build: 'node -e "process.exit(1)"' } }),
      card({ key: "block_nothing_hook", kind: "hook", family: "safety", params: { template: "block-paths", paths: [] } }),
      card({ key: "deny_env", kind: "permission", family: "safety", params: { deny: [".env"] } }),
      card({ key: "skill_release_build", kind: "skill", family: "skills", source: "process", params: { template: "process-skill", process: "release", step: "build" } }),
      card({ key: "skill_release_build_twin", kind: "skill", family: "skills", source: "process", params: { template: "process-skill", process: "release", step: "build" } }),
      card({ key: "agent_release_review", kind: "agent", family: "agents", source: "process", params: { template: "process-agent", process: "release", step: "review" } }),
      card({ key: "crm_mcp", kind: "mcp", family: "connections", risk: "external", params: { server: "crm", url: "https://{org}.crm4.dynamics.com/api/mcp", tools: ["retrieve"] } }),
      card({ key: "lsp_typescript_lsp", kind: "lsp", family: "connections", params: { url: "https://github.com/anthropics/claude-plugins-official", pluginName: "typescript-lsp" } }),
    ];
    run = await buildComponents({ dir: repo, repoName: "p", profile: profile(), cards, processes: [], author, log: () => undefined });
  }, 120_000);

  it("every card ends verified, configured or failed — none 'installed, not checked'", () => {
    expect(Object.fromEntries(run.map((o) => [o.key, o.status]))).toEqual({
      deny_env: "verified", block_nothing_hook: "failed", local_gate_script: "failed", agents_md_from_profile: "verified", rule_bad: "failed", rule_good: "verified",
      crm_mcp: "configured", lsp_typescript_lsp: "configured", skill_release_build: "verified", skill_release_build_twin: "failed", agent_release_review: "verified",
    });
  });
  it("a failed card's line, route and gate are not in the shared files; its own files are gone and reported", () => {
    const agents = readFileSync(path.join(repo, "AGENTS.md"), "utf8");
    expect(agents).toContain("Change `src/a.ts` only through its exports.");
    expect(agents).not.toContain("src/gen/Entities.ts");
    expect(agents).not.toContain("dcc-verify");
    // The layout is the map from the diagnosis, and the verification section says only how a change is checked.
    expect(agents).toContain("- `src/`");
    expect(agents).not.toMatch(/Packages \(\d+\)|\{\{[A-Za-z_]+\}\}/);
    expect(agents).toContain("run the build and the tests above");
    const settings = JSON.parse(readFileSync(path.join(repo, ".claude/settings.json"), "utf8")) as { permissions: { deny: string[] }; hooks?: unknown; enabledPlugins: Record<string, boolean> };
    expect(settings.permissions.deny).toEqual(["Read(.env)", "Edit(.env)"]);
    expect(settings.hooks).toBeUndefined();
    expect(settings.enabledPlugins["typescript-lsp@claude-plugins-official"]).toBe(true);
    expect(existsSync(path.join(repo, "scripts/dcc-verify.mjs"))).toBe(false);
    expect(existsSync(path.join(repo, ".claude/hooks"))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")).scripts.verify).toBeUndefined();
    expect(run.removedFiles.sort()).toEqual([".claude/hooks/block-paths.mjs", "scripts/dcc-verify.mjs"]);
    expect(by("local_gate_script")).toMatchObject({ files: [], removed: ["scripts/dcc-verify.mjs"] });
    expect(by("rule_bad").files).toEqual([]);
  });
  it("a model-written file that fails is written once more with what the check said, then passes; its talk and its fence are gone, its name is its folder's", () => {
    expect(calls.filter((c) => c.key === "skill_release_build").map((c) => !!c.fix)).toEqual([false, true]);
    expect(calls.find((c) => c.key === "skill_release_build" && c.fix)!.fix).toContain("Test/Alt.Test.Crm/Tests.cs");
    expect(by("skill_release_build").retry).toMatchObject({ passed: false });
    const skill = readFileSync(path.join(repo, ".claude/skills/release-build/SKILL.md"), "utf8");
    expect(skill.startsWith("---\nname: release-build\n")).toBe(true);
    const agent = readFileSync(path.join(repo, ".claude/agents/release-review.md"), "utf8");
    expect(agent.startsWith("---\nname: release-review\n")).toBe(true);
    expect(agent).not.toContain("```");
  });
  it("two cards on one name: the second fails and never overwrites the first — and the model is not asked for it", () => {
    expect(by("skill_release_build_twin").validation?.detail).toContain("skill_release_build");
    expect(calls.some((c) => c.key === "skill_release_build_twin")).toBe(false);
    expect(readFileSync(path.join(repo, ".claude/skills/release-build/SKILL.md"), "utf8")).toContain("name: release-build");
  });
  it("an MCP address with a slot is not written: configured, its instruction for the report", () => {
    expect(existsSync(path.join(repo, ".mcp.json"))).toBe(false);
    expect(by("crm_mcp")).toMatchObject({ status: "configured", files: [] });
    expect(by("crm_mcp").validation?.detail).toContain("{org}");
  });
});

describe("the build on a repository with its own instructions file", () => {
  it("puts the rule lines into the section added to that file, once — and writes no AGENTS.md of its own", async () => {
    const repo = scratch();
    write(repo, "src/a.ts", "");
    write(repo, "CLAUDE.md", "# Existing\n\nUse `src/a.ts`.\n");
    const run = await buildComponents({
      dir: repo, repoName: "p", profile: profile(), processes: [], author: async () => "unused", log: () => undefined,
      cards: [card({ key: "delta_to_existing_instructions", kind: "doc", params: { template: "agents-md-delta" } }), card({ key: "rule_good", kind: "rule", params: { text: "Change `src/a.ts` only through its exports." } })],
    });
    expect(run.map((o) => [o.key, o.status])).toEqual([["delta_to_existing_instructions", "verified"], ["rule_good", "verified"]]);
    expect(existsSync(path.join(repo, "AGENTS.md"))).toBe(false);
    const claude = readFileSync(path.join(repo, "CLAUDE.md"), "utf8");
    expect(claude.startsWith("# Existing\n\nUse `src/a.ts`.\n")).toBe(true);
    expect(claude.match(/Change `src\/a\.ts` only through its exports/g)).toHaveLength(1);
    expect(run.find((o) => o.key === "rule_good")!.files).toEqual(["CLAUDE.md"]);
  });
});

describe("the dossier in the repository", () => {
  it("is one file: what was delivered and how it was verified, the measurement — no profile, no costs, no local paths", () => {
    const repo = scratch();
    write(repo, ".dcc/an-older-record.json", "{}");
    write(repo, ".dcc/another-older-record.json", "{}");
    const at = "2026-09-29T00:00:00.000Z";
    const cards = [
      card({ key: "a", kind: "skill", title_he: "א", status: "verified", files: [".claude/skills/a/SKILL.md"], validation: { how: "frontmatter", passed: true, detail: "C:\\Users\\someone\\x", at } }),
      card({ key: "m", kind: "mcp", title_he: "מ", status: "configured", files: [], validation: { how: "הגדרה", passed: true, detail: "", at } }),
      card({ key: "f", kind: "doc", status: "failed", files: [] }),
      card({ key: "d", kind: "doc", status: "declined" }),
    ];
    expect(writeDossier(repo, { cards, runId: "r1", baselineSha: "abc", eval: { tasks: 12 } })).toEqual([DOSSIER_FILE]);
    expect(readdirSync(path.join(repo, ".dcc"))).toEqual(["onboarding.json"]);
    const body = JSON.parse(readFileSync(path.join(repo, DOSSIER_FILE), "utf8")) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["writtenAt", "runId", "baselineSha", "delivered", "eval"]);
    expect(body.delivered).toEqual([
      { key: "a", kind: "skill", title_he: "א", files: [".claude/skills/a/SKILL.md"], verified: { how: "frontmatter", at } },
      { key: "m", kind: "mcp", title_he: "מ", files: [], verified: { how: "הגדרה", at } },
    ]);
    expect(body.eval).toEqual({ tasks: 12 });
    expect(readFileSync(path.join(repo, DOSSIER_FILE), "utf8")).not.toContain("Users");
  });
});

describe("a command of the repository's own toolchain, on a machine without that tool", () => {
  it("holds when the copy's manifests show the toolchain, and fails when they do not", () => {
    const repo = scratch();
    write(repo, "Cargo.toml", "[workspace]\nmembers = [\"tokio\"]\n");
    write(repo, "tokio/Cargo.toml", "[package]\nname = \"tokio\"\n");
    write(repo, "AGENTS.md", "# tokio\n");
    const none = { cargo: null, pytest: null, dotnet: null } as const;
    expect(checkClaims("Run `cargo test --all-features` from the root; `cargo hack test --each-feature` in CI.", repo, { tools: none, file: "AGENTS.md" }).missing).toEqual([]);
    expect(checkClaims("Run `pytest tests/` before a PR.", repo, { tools: none, file: "AGENTS.md" }).missing).toEqual(["pytest tests/"]);
    expect(checkClaims("Build with `dotnet build`.", repo, { tools: none, file: "AGENTS.md" }).missing).toEqual(["dotnet build"]);
  });
});

describe("a build output under a folder that exists", () => {
  it("is a real path once the build ran — the test command the diagnosis names points there", () => {
    const repo = scratch();
    write(repo, "Test/Alt.Test.CrmApi/Alt.Test.CrmApi.csproj", "<Project />");
    write(repo, "AGENTS.md", "# x\n");
    expect(checkClaims("Run `vstest.console Test/Alt.Test.CrmApi/bin/Debug/Alt.Test.CrmApi.dll` after the build.", repo, { tools: { "vstest.console": "C:/vs/vstest.console.exe" }, file: "AGENTS.md" }).missing).toEqual([]);
    expect(checkClaims("The tests are in `Test/Nope/bin/Debug/Nope.dll`.", repo, { file: "AGENTS.md" }).missing).toEqual(["Test/Nope/bin/Debug/Nope.dll"]);
  });
});
