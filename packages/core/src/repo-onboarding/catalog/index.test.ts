import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CATALOG_VERSION, listTemplates, renderTemplate, type Rendered, type RepoFacts } from "./index.ts";

/**
 * The catalog is pure, so this test renders every template and then runs
 * what it produced the way Claude Code would: each hook as a child process
 * with the event on stdin, exit 2 = denied. Nothing here touches the database.
 */

const repo: RepoFacts = { name: "acme-shop", buildCommand: "npm run build", testCommand: "npm test", lintCommand: "npm run lint", languages: ["TypeScript", "C#"], packageManager: "npm", defaultBranch: "main", windowsOnly: false };
const bare: RepoFacts = { name: "bare", buildCommand: null, testCommand: null, lintCommand: null, languages: [], packageManager: null, defaultBranch: null, windowsOnly: false };

/** Representative params for every template — the shapes rules.json passes. */
const SAMPLE: Record<string, Record<string, unknown>> = {
  "block-paths": { paths: ["src/generated", "*.snk"], reason: "generated — change the source and regenerate" },
  "block-commands": { patterns: ["terraform apply", "terraform destroy"], reason: "plan is the deliverable; apply is a person's" },
  "secret-scan": { allowTests: true },
  "build-gate": { command: "npm run build" },
  "post-format": { formatter: "prettier" },
  "post-validate": { match: "\\.ipynb$", command: "python -m nbformat --validate" },
  deny: { deny: ["secrets/", ".env", "Bash(rm -rf *)"] },
  gitignore: { entries: ["bin/", "obj/"] },
  gitattributes: { paths: ["src/generated", "Model.g.cs"] },
  "local-gate": { build: "npm run build", test: "npm test" },
  "first-test": { languages: ["TypeScript", "C#"] },
  "agents-md": { mergeFrom: [".cursorrules", ".github/copilot-instructions.md"] },
  "agents-md-delta": { existing: ["CLAUDE.md"], date: "2026-09-27" },
  "per-package": { packages: ["packages/core", "apps/web"] },
  "per-area": { areas: [{ dir: "Pcf", toolchain: "node", command: "npm run build" }, { dir: "CrmEntryPoints", toolchain: "msbuild", command: "msbuild Crm.sln" }] },
  "docs-set": { docs: ["architecture", "integrations", "build-and-run", "glossary"] },
  "hot-dir-doc": { dir: "src/Entities", changes: "312", authors: "14" },
  "run-affected-tests": { command: "npm test", dirs: ["tests", "src/__tests__"], frameworks: ["vitest"] },
  "verify-like-ci": { commands: ["npm ci", "npm run lint", "npm test"], systems: ["github-actions"] },
  "which-package": { packages: ["packages/core", "apps/web"], workspaces: "packages/*; apps/*" },
  "change-recipe": { shapes: [{ files: ["src/a.ts", "src/b.ts", "src/c.test.ts"], times: 7 }] },
  "build-on-runner": { solution: "Acme.sln" },
  "terraform-docs": {},
  "docs-sync": { pointer: "docs/architecture.md" },
  "emulator-free-verify": { screenshot: "roborazzi" },
  "contribution-style": { contributing: ["CONTRIBUTING.md", ".github/CONTRIBUTING.md"] },
  "scoped-reviewer": { dir: "src/Entities", changes: 312, authors: 14, withReviewMd: true },
  "security-reviewer": { languages: ["PHP", "JavaScript"] },
  reviewer: {},
  "pr-template": {},
  mcp: { server: "dataverse", url: "https://{org}.crm.dynamics.com/api/mcp", tools: ["describe_table", "read_query", "search"], readOnly: true, needs: ["org", "admin consent"] },
};

let dir: string;
let n = 0;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), "dcc-catalog-")); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

/** Writes one rendered file into a fresh sub-folder of the temp dir and returns its absolute path. */
function place(r: Rendered, rel: string): string {
  const f = r.files.find((x) => x.path === rel);
  if (!f) throw new Error(`no file ${rel} among ${r.files.map((x) => x.path).join(", ") || "(none)"}`);
  const abs = path.join(dir, String(n++), rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, f.content, { mode: f.mode ?? 0o644 });
  return abs;
}

/** The hook's environment without the session's own project dir, so a test states the one it means. */
const { CLAUDE_PROJECT_DIR: _sessionProjectDir, ...baseEnv } = process.env;
function run(script: string, event: unknown, cwd = dir, env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [script], { input: JSON.stringify(event), encoding: "utf8", cwd, env: { ...baseEnv, ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const hook = (name: string, params: Record<string, unknown>, facts = repo) => place(renderTemplate(name, params, facts), `.claude/hooks/${name}.mjs`);
const edit = (file: string, extra: Record<string, unknown> = {}, cwd = dir) => ({ tool_name: "Edit", tool_input: { file_path: path.join(cwd, file), old_string: "a", new_string: "b", ...extra }, cwd });
const gitAvailable = spawnSync("git", ["--version"]).status === 0;

describe("the catalog", () => {
  it("has a version", () => {
    expect(CATALOG_VERSION).toBe(1);
  });

  it("renders every listed template with representative params — a missing template file fails here", () => {
    const list = listTemplates();
    expect(list.map((t) => t.name).sort()).toEqual(Object.keys(SAMPLE).sort());
    for (const t of list) {
      expect(t.kind, t.name).toBeTruthy();
      expect(t.produces.length, t.name).toBeGreaterThan(0);
      const r = renderTemplate(t.name, SAMPLE[t.name]!, repo);
      expect(Array.isArray(r.files), t.name).toBe(true);
      expect(Array.isArray(r.notes), t.name).toBe(true);
      for (const f of r.files) {
        expect(f.path, t.name).not.toMatch(/^\/|\\/);
        // DCC's own slots are all filled; only the builder's {{UPPERCASE}} slots may remain.
        expect(f.content, `${t.name} ${f.path}`).not.toMatch(/\{\{[a-z][a-z0-9_]*\}\}/);
        expect(f.content, `${t.name} ${f.path}`).not.toContain("@dcc:config");
      }
      if (t.kind === "hook") {
        const h = r.files.find((f) => f.path.startsWith(".claude/hooks/"));
        expect(h, t.name).toBeDefined();
        expect(h!.content.startsWith("#!/usr/bin/env node\n"), t.name).toBe(true);
        expect(h!.mode, t.name).toBe(0o755);
        expect(r.settings?.hooks, t.name).toBeDefined();
      }
    }
  });

  it("throws on a template it does not have", () => {
    expect(() => renderTemplate("no-such-template", {}, repo)).toThrow(/unknown catalog template/);
  });

  it("wires hooks in Claude Code's settings format", () => {
    const r = renderTemplate("block-paths", SAMPLE["block-paths"]!, repo);
    const blockPaths = [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/block-paths.mjs"' }];
    // every file-writing tool, and the shells a write can go through
    expect(r.settings?.hooks).toEqual({ PreToolUse: [{ matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: blockPaths }, { matcher: "Bash|PowerShell", hooks: blockPaths }] });
    expect(renderTemplate("block-commands", SAMPLE["block-commands"]!, repo).settings?.hooks?.PreToolUse?.[0]).toMatchObject({ matcher: "Bash|PowerShell" });
    expect(renderTemplate("secret-scan", {}, repo).settings?.hooks?.PreToolUse).toMatchObject([{ matcher: "Edit|Write|MultiEdit|NotebookEdit" }, { matcher: "Bash|PowerShell" }]);
    const stop = renderTemplate("build-gate", SAMPLE["build-gate"]!, repo).settings?.hooks?.Stop?.[0] as { matcher?: string; hooks: { timeout: number }[] };
    expect(stop.matcher).toBeUndefined();
    expect(stop.hooks[0]!.timeout).toBeGreaterThanOrEqual(600);
    expect(renderTemplate("post-format", SAMPLE["post-format"]!, repo).settings?.hooks?.PostToolUse).toHaveLength(1);
  });
});

describe("block-paths", () => {
  const script = () => hook("block-paths", { paths: ["src/generated", "Keys/**", "*.snk", "Entities.cs"], reason: "generated — change the source and regenerate" });

  it("denies a file under a forbidden path, with the reason", () => {
    const r = run(script(), edit("src/generated/Model.cs"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("generated — change the source and regenerate");
    expect(r.stderr).toContain("src/generated/Model.cs");
  });

  it("allows a file elsewhere, and a sibling whose name merely starts the same", () => {
    expect(run(script(), edit("src/app.ts")).status).toBe(0);
    expect(run(script(), edit("src/generatedByHand/x.ts")).status).toBe(0);
  });

  it("understands /** entries, file-name patterns and bare file names", () => {
    expect(run(script(), edit("Keys/deep/x.txt")).status).toBe(2);
    expect(run(script(), edit("Signing/Acme.snk")).status).toBe(2);
    expect(run(script(), edit("Crm/Entities.cs")).status).toBe(2);
    expect(run(script(), edit("Crm/EntitiesHelper.cs")).status).toBe(0);
  });

  it("ignores other tools and files outside the repository", () => {
    expect(run(script(), { tool_name: "Read", tool_input: { file_path: path.join(dir, "src/generated/a") }, cwd: dir }).status).toBe(0);
    expect(run(script(), { tool_name: "Edit", tool_input: { file_path: path.join(dir, "..", "src/generated/a") }, cwd: path.join(dir, "inner") }).status).toBe(0);
  });

  it("measures from the project root Claude Code names, not from where the session has cd'ed", () => {
    const deep = { tool_name: "Edit", tool_input: { file_path: path.join(dir, "src/generated/Model.cs") }, cwd: path.join(dir, "sub") };
    expect(run(script(), deep, dir, { CLAUDE_PROJECT_DIR: dir }).status).toBe(2);
  });

  it("guards a notebook edit too", () => {
    expect(run(script(), { tool_name: "NotebookEdit", tool_input: { notebook_path: path.join(dir, "src/generated/a.ipynb"), new_source: "x" }, cwd: dir }).status).toBe(2);
  });

  it("blocks a shell command that writes into a guarded path, in Bash or PowerShell, and lets reads through", () => {
    const sh = (tool: string, command: string) => run(script(), { tool_name: tool, tool_input: { command }, cwd: dir }).status;
    expect(sh("Bash", "echo x > src/generated/a.ts")).toBe(2);
    expect(sh("Bash", "printf x >> ./src/generated/a.ts")).toBe(2);
    expect(sh("Bash", "cp tmp/a.ts src/generated/")).toBe(2);
    expect(sh("Bash", "sed -i 's/a/b/' src/generated/a.ts")).toBe(2);
    expect(sh("Bash", "echo x | tee Keys/new.txt")).toBe(2);
    expect(sh("PowerShell", "Set-Content -Path src/generated/b.cs -Value 'x'")).toBe(2);
    expect(sh("PowerShell", "'x' | Out-File src\\generated\\c.cs")).toBe(2);
    expect(sh("PowerShell", "Copy-Item tmp/a.cs -Destination src/generated/a.cs")).toBe(2);
    expect(sh("PowerShell", "Move-Item tmp/a.snk Signing/b.snk")).toBe(2);
    expect(sh("Bash", "cat src/generated/a.ts > out.txt")).toBe(0);
    expect(sh("Bash", "npm test 2>&1 | tail -5")).toBe(0);
    expect(sh("Bash", 'node -e "const f = (x) => x"')).toBe(0);
    expect(sh("PowerShell", "Get-Content src/generated/a.ts")).toBe(0);
  });
});

describe("block-commands", () => {
  const script = () => hook("block-commands", { patterns: ["terraform apply", "terraform destroy", "terraform state "], reason: "plan is the deliverable; apply is a person's" });

  it("denies terraform apply and allows terraform plan", () => {
    const denied = run(script(), { tool_name: "Bash", tool_input: { command: "cd infra && terraform apply -auto-approve" } });
    expect(denied.status).toBe(2);
    expect(denied.stderr).toContain("plan is the deliverable");
    expect(run(script(), { tool_name: "Bash", tool_input: { command: "terraform plan -out=tfplan" } }).status).toBe(0);
  });

  it("compares case-insensitively with whitespace collapsed", () => {
    expect(run(script(), { tool_name: "Bash", tool_input: { command: "Terraform \\\n   APPLY" } }).status).toBe(2);
    expect(run(script(), { tool_name: "Bash", tool_input: { command: "terraform state list" } }).status).toBe(2);
    expect(run(script(), { tool_name: "Edit", tool_input: { file_path: "terraform apply" } }).status).toBe(0);
  });
});

describe("secret-scan", () => {
  const write = (file: string, content: string) => ({ tool_name: "Write", tool_input: { file_path: path.join(dir, file), content }, cwd: dir });

  it("denies a connection-string password and never prints the value", () => {
    const r = run(hook("secret-scan", { allowTests: false }), write("appsettings.json", '{ "Db": "Server=x;Password=Sup3rSecret123;" }'));
    expect(r.status).toBe(2);
    expect(r.stderr).not.toContain("Sup3rSecret123");
    expect(r.stderr).toContain("***");
    expect(r.stderr).toContain("password in a connection string");
    expect(r.stderr).toContain("appsettings.json:1");
  });

  it("lets a placeholder through", () => {
    expect(run(hook("secret-scan", { allowTests: false }), write("appsettings.json", "Password=changethis;")).status).toBe(0);
    expect(run(hook("secret-scan", { allowTests: false }), write("appsettings.json", "Password=${DB_PASSWORD};")).status).toBe(0);
  });

  it("catches the other kinds in an Edit's new_string and a MultiEdit", () => {
    const s = hook("secret-scan", { allowTests: false });
    const cases = ["const key = \"AKIAIOSFODNN7EXAMPL0\";", "-----BEGIN RSA PRIVATE KEY-----", "url = postgres://app:hunter22@db:5432/app", "api_key = \"9f8e7d6c5b4a3f2e1d\"", "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789", "SLACK=xoxb-1234567890-abcdefghij", "stripe: sk_live_Qm7xZp2Lk9"];
    for (const c of cases) expect(run(s, edit("src/config.ts", { new_string: c })).status, c).toBe(2);
    const multi = { tool_name: "MultiEdit", tool_input: { file_path: path.join(dir, "src/x.ts"), edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: 'password = "hunter2hunter2"' }] }, cwd: dir };
    expect(run(s, multi).status).toBe(2);
    expect(run(s, edit("src/config.ts", { new_string: "const x = 1;" })).status).toBe(0);
  });

  it("skips test files when allowTests is on, and only then", () => {
    const content = "Password=Sup3rSecret123;";
    expect(run(hook("secret-scan", { allowTests: true }), write("tests/x.test.ts", content)).status).toBe(0);
    expect(run(hook("secret-scan", { allowTests: true }), write("src/fixtures/db.ts", content)).status).toBe(0);
    expect(run(hook("secret-scan", { allowTests: true }), write("src/db.ts", content)).status).toBe(2);
    expect(run(hook("secret-scan", { allowTests: false }), write("tests/x.test.ts", content)).status).toBe(2);
  });

  it.skipIf(!gitAvailable)("scans the staged diff on git commit", () => {
    const repoDir = path.join(dir, "git-repo");
    mkdirSync(path.join(repoDir, "tests"), { recursive: true });
    expect(spawnSync("git", ["init", "-q"], { cwd: repoDir }).status).toBe(0);
    writeFileSync(path.join(repoDir, "tests/fixture.txt"), "Password=Sup3rSecret123;\n");
    writeFileSync(path.join(repoDir, "config.txt"), "ok\nPassword=Sup3rSecret123;\n");
    expect(spawnSync("git", ["add", "-A"], { cwd: repoDir }).status).toBe(0);
    const commit = { tool_name: "Bash", tool_input: { command: 'git commit -m "add config"' }, cwd: repoDir };
    const r = run(hook("secret-scan", { allowTests: true }), commit, repoDir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("config.txt:2");
    expect(r.stderr).not.toContain("tests/fixture.txt");
    expect(r.stderr).not.toContain("Sup3rSecret123");
    expect(run(hook("secret-scan", { allowTests: true }), { tool_name: "Bash", tool_input: { command: "git status" }, cwd: repoDir }, repoDir).status).toBe(0);
  });

  it.skipIf(!gitAvailable)("scans what a `git add` in the same command is about to stage, in Bash and PowerShell", () => {
    const repoDir = path.join(dir, "git-add-repo");
    mkdirSync(repoDir, { recursive: true });
    const g = (...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@x", "-c", "commit.gpgsign=false", ...a], { cwd: repoDir });
    expect(g("init", "-q").status).toBe(0);
    writeFileSync(path.join(repoDir, "tracked.txt"), "ok\n");
    expect(g("add", "-A").status).toBe(0);
    expect(g("commit", "-q", "-m", "init").status).toBe(0);
    // nothing staged: the hook sees the secret only because it reads what the add will stage
    writeFileSync(path.join(repoDir, "tracked.txt"), "ok\nPassword=Sup3rSecret123;\n");
    writeFileSync(path.join(repoDir, "new.cs"), 'const string C = "Server=x;Password=An0therSecret9;";\n');
    const s = hook("secret-scan", { allowTests: false });
    const all = run(s, { tool_name: "Bash", tool_input: { command: 'git add -A && git commit -m "x"' }, cwd: repoDir }, repoDir);
    expect(all.status).toBe(2);
    expect(all.stderr).toContain("tracked.txt:2");
    expect(all.stderr).toContain("new.cs:1");
    expect(all.stderr).not.toContain("Sup3rSecret123");
    const named = run(s, { tool_name: "PowerShell", tool_input: { command: 'git add new.cs; git commit -m "x"' }, cwd: repoDir }, repoDir);
    expect(named.status).toBe(2);
    expect(named.stderr).toContain("new.cs:1");
    expect(named.stderr).not.toContain("tracked.txt");
    expect(run(s, { tool_name: "PowerShell", tool_input: { command: "git add tracked.txt" }, cwd: repoDir }, repoDir).status).toBe(0);
  });

  it("scans a notebook cell", () => {
    const r = run(hook("secret-scan", { allowTests: false }), { tool_name: "NotebookEdit", tool_input: { notebook_path: path.join(dir, "a.ipynb"), new_source: 'api_key = "9f8e7d6c5b4a3f2e1d"' }, cwd: dir });
    expect(r.status).toBe(2);
  });
});

describe("build-gate", () => {
  it("sends a failing build back to Claude and lets a passing one stop", () => {
    const failing = run(hook("build-gate", { command: 'node -e "console.log(1); console.error(\'boom\'); process.exit(1)"' }), { cwd: dir });
    expect(failing.status).toBe(2);
    expect(failing.stderr).toContain("boom");
    expect(run(hook("build-gate", { command: 'node -e "process.exit(0)"' }), { cwd: dir }).status).toBe(0);
  });

  it("never loops: stop_hook_active ends it, and no command is a pass", () => {
    expect(run(hook("build-gate", { command: 'node -e "process.exit(1)"' }), { cwd: dir, stop_hook_active: true }).status).toBe(0);
    const r = run(hook("build-gate", { command: "" }, bare), { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toBe("");
  });
});

describe("post-format", () => {
  it("maps a formatter to its command and keeps to its extensions", () => {
    const r = renderTemplate("post-format", { formatter: "rustfmt/clippy (toolchain pinned)" }, repo);
    expect(r.files[0]!.content).toContain('"rustfmt"');
    expect(r.files[0]!.content).toContain('".rs"');
    expect(renderTemplate("post-format", { formatter: "@biomejs/biome" }, repo).files[0]!.content).toContain("@biomejs/biome");
  });

  it("exits 0 for an unknown formatter and says so in the notes; spotless is skipped", () => {
    const r = renderTemplate("post-format", { formatter: "made-up-fmt" }, repo);
    expect(r.notes.join("\n")).toContain("no command known for made-up-fmt");
    expect(run(place(r, ".claude/hooks/post-format.mjs"), edit("src/a.ts")).status).toBe(0);
    const spotless = renderTemplate("post-format", { formatter: "spotless" }, repo);
    expect(spotless.files).toEqual([]);
    expect(spotless.notes[0]).toMatch(/spotless/);
  });

  it("never blocks, even when the formatter fails", () => {
    const r = renderTemplate("post-format", { formatter: "prettier" }, repo);
    const content = r.files[0]!.content.replace('"npx",\n    "prettier",\n    "--write"', '"node",\n    "-e",\n    "\\"process.exit(1)\\""');
    expect(content).toContain("process.exit(1)");
    expect(content).not.toContain('"--write"');
    const abs = path.join(dir, String(n++), "post-format.mjs");
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    const run1 = run(abs, edit("src/a.ts"));
    expect(run1.status).toBe(0);
    expect(run1.stdout).toContain("did not format");
  });
});

describe("post-validate", () => {
  it("runs the command on a matching file and hands a failure back", () => {
    const failing = hook("post-validate", { match: "\\.ipynb$", command: 'node -e "console.error(\'invalid notebook\'); process.exit(1)"' });
    const r = run(failing, edit("notebooks/a.ipynb"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("invalid notebook");
    expect(r.stderr).toContain("notebooks/a.ipynb");
    expect(run(failing, edit("src/a.ts")).status).toBe(0);
    expect(run(hook("post-validate", { match: "\\.ipynb$", command: 'node -e "process.exit(0)"' }), edit("notebooks/a.ipynb")).status).toBe(0);
  });
});

describe("deny", () => {
  it("normalises to Claude Code's permission rules", () => {
    const r = renderTemplate("deny", { deny: ["secrets/", ".env", "Bash(rm -rf *)", "./certs/server.key", "Read(**/bin/**)", "id_rsa", "secrets/"] }, repo);
    expect(r.settings?.permissions?.deny).toEqual([
      "Read(secrets/**)", "Edit(secrets/**)",
      "Read(.env)", "Edit(.env)",
      "Bash(rm -rf *)",
      "Read(certs/server.key)", "Edit(certs/server.key)",
      "Read(**/bin/**)",
      "Read(id_rsa)", "Edit(id_rsa)",
    ]);
    expect(r.files).toEqual([]);
  });
});

describe("files", () => {
  it("gitattributes marks a directory with /** and a file as it is", () => {
    const r = renderTemplate("gitattributes", { paths: ["src/generated", "Model.g.cs", "gen/"] }, repo);
    expect(r.files[0]!.path).toBe(".gitattributes");
    expect(r.files[0]!.content).toContain("src/generated/** linguist-generated=true\n");
    expect(r.files[0]!.content).toContain("Model.g.cs linguist-generated=true\n");
    expect(r.files[0]!.content).toContain("gen/** linguist-generated=true\n");
    // folded in a review, never hidden from it
    expect(r.files[0]!.content).not.toContain("-diff");
  });

  it("gitignore returns only the lines under the DCC header", () => {
    const r = renderTemplate("gitignore", { entries: ["bin/", "*.user"] }, repo);
    expect(r.files[0]!.content).toBe("# added by DCC onboarding\nbin/\n*.user\n");
    expect(r.notes[0]).toMatch(/^merge/);
  });

  it("local-gate prints one verdict line", () => {
    const nothing = renderTemplate("local-gate", { build: "", test: "-" }, bare);
    expect(nothing.notes.join("\n")).toContain('"verify": "node scripts/dcc-verify.mjs"');
    const r0 = run(place(nothing, "scripts/dcc-verify.mjs"), {});
    expect(r0.status).toBe(0);
    expect(r0.stdout.trim()).toBe("VERIFY: nothing to run");
    const ok = run(place(renderTemplate("local-gate", { build: 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"' }, bare), "scripts/dcc-verify.mjs"), {});
    expect(ok.status).toBe(0);
    expect(ok.stdout.trim().split("\n").pop()).toBe("VERIFY: ok");
    const failed = run(place(renderTemplate("local-gate", { build: 'node -e "process.exit(0)"', test: 'node -e "process.exit(3)"' }, bare), "scripts/dcc-verify.mjs"), {});
    expect(failed.status).toBe(1);
    expect(failed.stdout.trim().split("\n").pop()).toBe("VERIFY: failed test");
  });

  it("local-gate exits 3 only when the build's tool is missing, and says which", () => {
    const r = run(place(renderTemplate("local-gate", { build: "no-such-tool-xyz Acme.sln", tests: [] }, { ...bare, windowsOnly: true }), "scripts/dcc-verify.mjs"), {});
    expect(r.status).toBe(3);
    expect(r.stdout.trim()).toBe("VERIFY: cannot run here (no no-such-tool-xyz)");
  });

  it("local-gate builds an msbuild solution with the tool the machine has first, and tests only tracked test projects", () => {
    const dotnetOnly = renderTemplate("local-gate", { build: "msbuild Acme.sln /t:Build", sln: "Acme.sln", tools: { msbuild: null, dotnet: "d", dotnet_msbuild: "d" }, tests: [] }, bare).files[0]!.content;
    expect(dotnetOnly.indexOf('"dotnet msbuild Acme.sln"')).toBeGreaterThan(-1);
    expect(dotnetOnly.indexOf('"dotnet msbuild Acme.sln"')).toBeLessThan(dotnetOnly.indexOf('"msbuild Acme.sln"'));
    expect(dotnetOnly).not.toContain('"name": "test"');
    const vs = renderTemplate("local-gate", { build: "msbuild Acme.sln", tools: { msbuild: "C:/VS/MSBuild.exe", dotnet: "d" }, tests: ["vstest.console Test/X/bin/Debug/X.dll"] }, bare).files[0]!.content;
    expect(vs.indexOf('"msbuild Acme.sln"')).toBeLessThan(vs.indexOf('"dotnet msbuild Acme.sln"'));
    expect(vs).toContain('"vstest.console Test/X/bin/Debug/X.dll"');
    // the diagnosing machine's paths never go into the client's script
    expect(vs).not.toContain("C:/VS");
  });

  it("local-gate takes the first way the machine can run, and a missing test tool is a partial pass, not a failure", () => {
    const gate = readFileSync(new URL("./templates/scripts/dcc-verify.mjs", import.meta.url), "utf8");
    const withConfig = (config: unknown) => {
      const abs = path.join(dir, String(n++), "scripts", "dcc-verify.mjs");
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, gate.replace("/* @dcc:config */ {}", JSON.stringify(config)));
      return abs;
    };
    const second = run(withConfig({ steps: [{ name: "build", run: ["no-such-tool-xyz a", 'node -e "process.exit(0)"'] }] }), {});
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("[verify] build: node -e");
    expect(second.stdout.trim().split("\n").pop()).toBe("VERIFY: ok");
    const partial = run(withConfig({ steps: [{ name: "build", run: ['node -e "process.exit(0)"'] }, { name: "test", run: ["no-such-tool-xyz run"] }] }), {});
    expect(partial.status).toBe(0);
    expect(partial.stdout.trim().split("\n").pop()).toBe("VERIFY: partial — test not run here (no no-such-tool-xyz)");
  });

  it("first-test picks the first supported language in the native framework", () => {
    expect(renderTemplate("first-test", { languages: ["Markdown", "TypeScript"] }, repo).files[0]!.path).toBe("tests/smoke.test.mjs");
    expect(renderTemplate("first-test", { languages: ["Jupyter", "Python"] }, repo).files[0]!.path).toBe("tests/test_smoke.py");
    const go = renderTemplate("first-test", { languages: ["Go"] }, repo);
    expect(go.files[0]!.path).toBe("smoke_test.go");
    expect(go.notes[0]).toContain("package main");
    const cs = renderTemplate("first-test", { languages: ["C#"] }, repo);
    expect(cs.files[0]!.path).toBe("Tests/Smoke/SmokeTests.cs");
    expect(cs.files[0]!.content).toContain("[TestMethod]");
    expect(cs.notes[0]).toContain("test project");
    expect(renderTemplate("first-test", { languages: ["Java"] }, repo).files[0]!.content).toContain("org.junit.jupiter");
    const none = renderTemplate("first-test", { languages: ["Kotlin", "XML"] }, repo);
    expect(none.files).toEqual([]);
    expect(none.notes[0]).toBe("no first-test template for Kotlin (nor for XML)");
  });

  it("the node smoke test really runs", () => {
    const abs = place(renderTemplate("first-test", { languages: ["JavaScript"] }, repo), "tests/smoke.test.mjs");
    expect(spawnSync(process.execPath, ["--test", abs], { encoding: "utf8" }).status).toBe(0);
  });
});

describe("instructions", () => {
  it("agents-md has the sections, the commands from the facts, and a one-line CLAUDE.md", () => {
    const r = renderTemplate("agents-md", { mergeFrom: [".cursorrules"] }, repo);
    const agents = r.files.find((f) => f.path === "AGENTS.md")!.content;
    for (const h of ["# acme-shop", "## What this is", "## Build, test, lint", "## Layout", "## External systems", "## Rules for this repository", "## Verification", "## Merged from"]) expect(agents).toContain(`\n${h}\n`.replace(/^\n# /, "# "));
    for (const slot of ["{{PURPOSE}}", "{{LAYOUT}}", "{{EXTERNAL}}", "{{RULES}}", "{{VERIFICATION}}"]) expect(agents).toContain(slot);
    expect(agents).toContain("```sh\nnpm run build\n```");
    expect(agents).toContain("- `.cursorrules`");
    expect(agents.split("\n").length).toBeLessThan(80);
    expect(r.files.find((f) => f.path === "CLAUDE.md")!.content).toBe("@AGENTS.md\n");
    const windows = renderTemplate("agents-md", {}, { ...bare, name: "crm", windowsOnly: true }).files[0]!.content;
    expect(windows).toContain("Build: no build command was found in the repository.");
    expect(windows).toContain("only on Windows");
    expect(windows).not.toContain("not available here");
    expect(windows).not.toContain("Lint:");
    expect(windows).not.toContain("## Merged from");
  });

  it("agents-md states what exists: the build from the tools found, tests only from tracked projects, a layout map — no package list", () => {
    const trade: RepoFacts = { ...bare, name: "trade", windowsOnly: true, buildCommand: "msbuild Alt.sln /t:Build", languages: ["C#"] };
    const layout = { top: ["CrmEntryPoints", "Pcf", "Shared"], groups: [{ parent: "CrmEntryPoints/Plugins", members: ["CrmEntryPoints/Plugins/Alt.Account", "CrmEntryPoints/Plugins/Alt.Lead", "CrmEntryPoints/Plugins/Alt.Task"] }] };
    const md = (params: Record<string, unknown>) => renderTemplate("agents-md", params, trade).files[0]!.content;
    const dotnet = md({ tools: { msbuild: null, dotnet: "d", dotnet_msbuild: "d" }, sln: "Alt.sln", tests_projects: [], test_commands: [], layout, web_apps: 2 });
    expect(dotnet).toContain("```sh\ndotnet msbuild Alt.sln\n```");
    expect(dotnet).toContain("Web Application projects need Visual Studio's MSBuild");
    expect(dotnet).toContain("Tests: no test project is tracked in git");
    expect(dotnet).not.toMatch(/not available here|only on Windows|cannot build/i);
    expect(dotnet).toContain("- `CrmEntryPoints/` — `CrmEntryPoints/Plugins/` holds 3 projects side by side (e.g. `Alt.Account`)");
    expect(dotnet).toContain("- `Pcf/`\n");
    expect(dotnet).not.toContain("{{LAYOUT}}");
    expect(dotnet).not.toMatch(/Packages \(/);
    const vs = md({ tools: { msbuild: "C:/VS/MSBuild.exe", dotnet: "d" }, sln: "Alt.sln", tests_projects: ["Test/Alt.Tests"], test_commands: ["vstest.console Test/Alt.Tests/bin/Debug/Alt.Tests.dll"], layout, web_apps: 0 });
    expect(vs).toContain("```sh\nmsbuild Alt.sln\n```");
    expect(vs).toContain("`dotnet msbuild Alt.sln` builds the class libraries too.");
    expect(vs).toContain("Tests — the projects tracked in git: `Test/Alt.Tests/`");
    expect(vs).toContain("```sh\nvstest.console Test/Alt.Tests/bin/Debug/Alt.Tests.dll\n```");
    expect(vs).not.toContain("C:/VS");
  });

  it("agents-md-delta is a dated section to append", () => {
    const r = renderTemplate("agents-md-delta", { existing: ["CLAUDE.md"], date: "2026-09-27" }, repo);
    expect(r.files[0]!.path).toBe("AGENTS.md");
    expect(r.files[0]!.content).toContain("## Facts from DCC's diagnosis (2026-09-27)");
    expect(r.files[0]!.content).toContain("- Build: `npm run build`");
    expect(r.files[0]!.content).toContain("{{RULES}}");
    expect(r.notes[0]).toMatch(/^append/);
  });

  it("per-package caps at 12 and says so; per-area names the toolchain", () => {
    const packages = Array.from({ length: 15 }, (_, i) => `packages/p${i}`);
    const r = renderTemplate("per-package", { packages }, repo);
    expect(r.files).toHaveLength(12);
    expect(r.files[0]).toMatchObject({ path: "packages/p0/CLAUDE.md" });
    expect(r.files[0]!.content).toContain("# packages/p0\n\nThis package does not build with the root's command. Run these from this folder:\n\n{{PACKAGE_COMMANDS}}");
    expect(r.notes.find((x) => x.startsWith("capped"))).toContain("12 of 15");
    const own = renderTemplate("per-package", { packages: ["Pcf/Grid"], commands: [{ dir: "Pcf/Grid", build: "npm run build", test: null }] }, repo);
    expect(own.files[0]!.content).toContain("```sh\nnpm run build\n```");
    expect(own.files[0]!.content).not.toContain("{{PACKAGE_COMMANDS}}");
    const area = renderTemplate("per-area", SAMPLE["per-area"]!, repo);
    expect(area.files.map((f) => f.path)).toEqual(["Pcf/CLAUDE.md", "CrmEntryPoints/CLAUDE.md"]);
    expect(area.files[1]!.content).toContain("Toolchain: msbuild");
    expect(area.files[1]!.content).toContain("msbuild Crm.sln");
    expect(area.files[0]!.content).toContain("Run `npm install` in the folder first");
  });

  it("per-area with units side by side sends the command into each unit's folder, never the parent", () => {
    const r = renderTemplate("per-area", { areas: [{ dir: "Pcf", toolchain: "node", command: "npm run build", cwds: ["Pcf/Grid", "Pcf/Json"] }] }, repo);
    expect(r.files.map((f) => f.path)).toEqual(["Pcf/CLAUDE.md"]);
    const c = r.files[0]!.content;
    expect(c).toContain("run the command from inside it (there is no build manifest in `Pcf/` itself)");
    expect(c).toContain("- `Pcf/Grid/`\n- `Pcf/Json/`");
    expect(c).toContain("Do not build these with the rest");
  });

  it("docs-set writes the known skeletons and reports an unknown name; hot-dir-doc carries the numbers", () => {
    const r = renderTemplate("docs-set", { docs: ["architecture", "glossary", "bogus"] }, repo);
    expect(r.files.map((f) => f.path)).toEqual(["docs/architecture.md", "docs/glossary.md"]);
    expect(r.files[0]!.content).toContain("> Written by DCC onboarding from the repository's diagnosis; verify before relying on it.");
    expect(r.files[0]!.content).toContain("{{BODY}}");
    expect(r.notes[0]).toContain('unknown doc "bogus"');
    const hot = renderTemplate("hot-dir-doc", { dir: "src/Entities", changes: "312", authors: "14" }, repo);
    expect(hot.files[0]!.path).toBe("docs/architecture-src-entities.md");
    expect(hot.files[0]!.content).toContain("312 changes by 14 authors");
  });
});

describe("skills and agents", () => {
  const frontmatter = (content: string) => {
    const m = /^---\n([\s\S]*?)\n---\n/.exec(content);
    if (!m) throw new Error("no frontmatter");
    return Object.fromEntries(m[1]!.split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
  };

  it("every skill is a SKILL.md with name and description; read-only ones list their tools", () => {
    for (const t of listTemplates().filter((x) => x.kind === "skill")) {
      const r = renderTemplate(t.name, SAMPLE[t.name]!, repo);
      const f = r.files[0]!;
      expect(f.path, t.name).toBe(`.claude/skills/${t.name}/SKILL.md`);
      const fm = frontmatter(f.content);
      expect(fm.name, t.name).toBe(t.name);
      expect(fm.description!.length, t.name).toBeGreaterThan(80);
      expect(fm.description, t.name).toMatch(/Use (when|before|whenever)/);
      if (fm["allowed-tools"]) expect(fm["allowed-tools"], t.name).toBe("Read, Grep, Glob, Bash");
    }
    const tests = renderTemplate("run-affected-tests", SAMPLE["run-affected-tests"]!, repo).files[0]!.content;
    expect(tests).toContain("```sh\nnpm test\n```");
    expect(tests).toContain("`tests`, `src/__tests__`");
    const ci = renderTemplate("verify-like-ci", SAMPLE["verify-like-ci"]!, repo).files[0]!.content;
    expect(ci).toContain("# 1\nnpm ci\n# 2\nnpm run lint\n# 3\nnpm test");
    const recipe = renderTemplate("change-recipe", SAMPLE["change-recipe"]!, repo).files[0]!.content;
    expect(recipe).toContain("these 3 files changed together 7 times");
    expect(recipe).toContain("1. `src/a.ts`\n2. `src/b.ts`\n3. `src/c.test.ts`");
    const runner = renderTemplate("build-on-runner", SAMPLE["build-on-runner"]!, repo).files[0]!.content;
    expect(runner).toContain("Acme.sln");
    expect(runner).toContain("{{RUNNER}}");
    expect(runner).toContain("cannot build here");
  });

  it("which-package lists every package or none, names only the manifests the repository has, and says where to build", () => {
    const all = renderTemplate("which-package", { packages: ["Crm/A", "Crm/B", "Pcf/Grid"], count: "3", manifests: ["*.csproj", "package.json"], workspaces: "3 .NET projects in 1 solution(s)", rootBuild: "msbuild Alt.sln", own: [{ dir: "Pcf/Grid", build: "npm run build", test: null }] }, repo).files[0]!.content;
    expect(all).toContain("The 3 packages:\n\n- `Crm/A`\n- `Crm/B`\n- `Pcf/Grid`");
    expect(all).toContain("(`*.csproj`, `package.json`)");
    expect(all).not.toMatch(/pyproject|go\.mod|Cargo\.toml/);
    expect(all).toContain("Build and test from the root with `msbuild Alt.sln`, except these packages, which build from their own folder: `Pcf/Grid/` (`npm run build`).");
    const none = renderTemplate("which-package", { packages: [], count: "164", manifests: ["Cargo.toml", "package.json"], workspaces: "cargo workspace", rootBuild: "cargo build" }, repo);
    expect(none.files[0]!.content).toContain("The 164 packages are too many to list here; find them with Glob on `**/Cargo.toml`, `**/package.json`.");
    expect(none.files[0]!.content).toContain("Build and test from the root: `cargo build` builds every package.");
    expect(none.notes.join("\n")).toContain("no package list");
  });

  it("every agent is read-only, with a JSON findings format", () => {
    for (const t of listTemplates().filter((x) => x.kind === "agent")) {
      const r = renderTemplate(t.name, SAMPLE[t.name]!, repo);
      const agent = r.files.find((f) => f.path.startsWith(".claude/agents/"))!;
      const fm = frontmatter(agent.content);
      expect(fm.tools, t.name).toBe("Glob, Grep, Read, Bash");
      expect(fm.name, t.name).toBe(path.basename(agent.path, ".md"));
      expect(agent.content, t.name).toContain('"severity": "block"');
      expect(agent.content, t.name).toContain("do not approve");
    }
    const scoped = renderTemplate("scoped-reviewer", SAMPLE["scoped-reviewer"]!, repo);
    expect(scoped.files.map((f) => f.path)).toEqual([".claude/agents/reviewer-src-entities.md", "REVIEW.md"]);
    expect(scoped.files[0]!.content).toContain("{{CHECKLIST}}");
    expect(scoped.files[0]!.content).toContain("312 changes by 14 authors");
    expect(scoped.files[1]!.content).toContain("{{CHECKLIST}}");
    expect(renderTemplate("scoped-reviewer", { dir: "src/Entities" }, repo).files).toHaveLength(1);
    const sec = renderTemplate("security-reviewer", { languages: ["PHP", "JavaScript", "Brainfuck"] }, repo).files[0]!.content;
    expect(sec).toContain("**PHP**");
    expect(sec).toContain("**JavaScript**");
    expect(sec).toContain("**Brainfuck** — the checklist above applies");
    for (const item of ["Injection", "Cross-site scripting", "CSRF", "Path traversal", "Secrets"]) expect(sec).toContain(`**${item}**`);
    expect(renderTemplate("reviewer", {}, repo).files.map((f) => f.path)).toEqual([".claude/agents/reviewer.md", "REVIEW.md"]);
  });
});

describe("other", () => {
  it("pr-template has the four sections", () => {
    const r = renderTemplate("pr-template", {}, repo);
    expect(r.files[0]!.path).toBe(".github/pull_request_template.md");
    for (const h of ["## What", "## Why", "## How verified", "## Risks"]) expect(r.files[0]!.content).toContain(h);
  });

  it("mcp returns an .mcp.json entry and the rule line that limits the tools", () => {
    const http = renderTemplate("mcp", SAMPLE.mcp!, repo);
    expect(http.mcp).toEqual({ mcpServers: { dataverse: { type: "http", url: "https://{org}.crm.dynamics.com/api/mcp" } } });
    expect(http.files).toEqual([]);
    expect(http.notes[0]).toBe("rule: MCP `dataverse`: use only these tools: describe_table, read_query, search; it is read-only — never write through it.");
    expect(http.notes.join("\n")).toContain("placeholder");
    expect(http.notes.join("\n")).toContain("needs from the client: org, admin consent");
    const stdio = renderTemplate("mcp", { server: "db", command: "npx", args: ["-y", "pg-mcp"], env: { PGURL: "postgres://ro@db/app" }, tools: ["query"] }, repo);
    expect(stdio.mcp).toEqual({ mcpServers: { db: { command: "npx", args: ["-y", "pg-mcp"], env: { PGURL: "postgres://ro@db/app" } } } });
  });
});
