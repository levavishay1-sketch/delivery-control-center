import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The operator catalog (`openspec/changes/repository-coach`, plan → build):
 * DCC's reusable, parameterised templates for the components a rule puts on
 * a card — hooks, permissions, skills, agents, documents, scaffolds. The
 * builder calls `renderTemplate(name, params, repo)` with the card's
 * `params.template` (or, for a card without one, its kind: `deny`,
 * `gitignore`, `gitattributes`, `mcp`, `pr-template`, `reviewer`) and writes
 * what comes back into the isolated copy of the client's repository.
 *
 * Pure: no database, no model, no network. The template files under
 * `./templates/` and the parameters are the whole input, so a rendering is
 * reproducible and the unit test executes every hook it produces.
 *
 * Everything rendered lands in the CLIENT's repository: hooks and scripts
 * are plain Node (`.mjs`, zero dependencies), the rest is Markdown in the
 * exact shapes Claude Code reads. Two slot conventions in a template file:
 * `{{lowercase}}` is DCC's and is filled here; `{{UPPERCASE}}` is the
 * builder's (repository-specific prose it writes from the diagnosis) and is
 * left as it is. A hook declares `const CONFIG = {}` with the `@dcc:config`
 * marker comment before the braces (see CONFIG_MARK below); rendering
 * replaces that with the baked parameters — so the template file is itself
 * valid, lint-clean JavaScript that runs (with an empty config).
 */

export const CATALOG_VERSION = 1;

/** `path` is relative to the repository root. */
export type CatalogFile = { path: string; content: string; mode?: number };

export type Rendered = {
  files: CatalogFile[];
  /** Fragments of `.claude/settings.json`, in Claude Code's own format; the builder merges them. */
  settings?: { permissions?: { deny?: string[]; allow?: string[] }; hooks?: Record<string, unknown[]> };
  /** A fragment of `.mcp.json` (`{ mcpServers: { name: spec } }`). */
  mcp?: Record<string, unknown>;
  /** What the builder must still do or know: slots to fill, a merge to make, a limit that was hit. */
  notes: string[];
};

/**
 * What the templates know about the repository besides a card's params. The
 * optional facts come from the diagnosis (`environment.tools`,
 * `tests.projects`, `tests.commands`, the solution); a card's params of the
 * same name win, and a template left without either falls back to the
 * commands above.
 */
export type RepoFacts = {
  name: string;
  buildCommand: string | null;
  testCommand: string | null;
  lintCommand: string | null;
  languages: string[];
  packageManager: string | null;
  defaultBranch: string | null;
  windowsOnly: boolean;
  tools?: Tools | null;
  testProjects?: string[] | null;
  testCommands?: string[] | null;
  solution?: string | null;
  webAppProjects?: number | null;
};

/** The build and test tools the diagnosing machine has: name → resolved path, or null. */
export type Tools = Record<string, string | null>;

type Params = Record<string, unknown>;
type Template = { kind: string; produces: string[]; render: (params: Params, repo: RepoFacts) => Rendered };

/* ── the template files ─────────────────────────────────────────── */

const TEMPLATES_DIR = fileURLToPath(new URL("./templates/", import.meta.url));
const loaded = new Map<string, string>();

function template(rel: string): string {
  let text = loaded.get(rel);
  if (text === undefined) {
    text = readFileSync(path.join(TEMPLATES_DIR, rel), "utf8");
    loaded.set(rel, text);
  }
  return text;
}

/** `{{key}}` → its value for the lowercase keys given; an unknown one stays visible, never silently blank. Uppercase slots are the builder's. */
function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (m, k: string) => (Object.hasOwn(values, k) ? values[k]! : m));
}

const CONFIG_MARK = "/* @dcc:config */ {}";

/** A hook or a script with its parameters baked in as a const. */
function bake(rel: string, config: Record<string, unknown>): string {
  const text = template(rel);
  if (!text.includes(CONFIG_MARK)) throw new Error(`catalog template ${rel} has no config marker`);
  return text.replace(CONFIG_MARK, JSON.stringify(config, null, 2));
}

/* ── reading parameters ─────────────────────────────────────────── */

const str = (p: Params, k: string): string => (p[k] == null ? "" : String(p[k]).trim());

const strs = (p: Params, k: string): string[] => {
  const v = p[k];
  if (Array.isArray(v)) return v.map((x) => (x == null ? "" : String(x).trim())).filter(Boolean);
  return typeof v === "string" && v.trim() ? [v.trim()] : [];
};

/** The rules table writes "-" for a command it could not infer: that is "none", not a command. */
const command = (s: string | null | undefined): string => (s == null || s.trim() === "-" ? "" : s.trim());

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "root";
const code = (s: string): string => `\`${s.replace(/`/g, "'")}\``;
const bullets = (xs: string[]): string => xs.map((x) => `- ${code(x)}`).join("\n");

/** A value that goes into a YAML frontmatter line: no line breaks, no `: `, no ` #`. */
const yamlSafe = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, " ").replace(/:\s/g, " - ").replace(/\s#/g, " ").trim();

/* ── hooks ──────────────────────────────────────────────────────── */

const HOOK_DIR = ".claude/hooks";
const FILE_TOOLS = "Edit|Write|MultiEdit";
/** Every tool that writes a file — a guard that misses NotebookEdit is a guard with a door in it. */
const GUARD_TOOLS = "Edit|Write|MultiEdit|NotebookEdit";
/** The shells Claude Code runs commands in; on Windows that includes PowerShell. */
const SHELL_TOOLS = "Bash|PowerShell";
const hookCommand = (name: string): string => `node "$CLAUDE_PROJECT_DIR/${HOOK_DIR}/${name}.mjs"`;

/** One entry of `settings.hooks.<Event>`; `timeout` is in seconds (Claude Code kills a hook after 60 s by default). */
function hookEntry(name: string, matcher: string | null, timeoutSeconds?: number): Record<string, unknown> {
  return { ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: hookCommand(name), ...(timeoutSeconds ? { timeout: timeoutSeconds } : {}) }] };
}

function hookFile(name: string, config: Record<string, unknown>): CatalogFile {
  return { path: `${HOOK_DIR}/${name}.mjs`, content: bake(`hooks/${name}.mjs`, config), mode: 0o755 };
}

const verifyHook = (name: string, event: string, exit: string): string =>
  `verify: echo '${event}' | node ${HOOK_DIR}/${name}.mjs — ${exit}`;

type Formatter = { command: string[]; extensions: string[] };
const JS_EXT = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];
const BIOME: Formatter = { command: ["npx", "@biomejs/biome", "format", "--write"], extensions: [...JS_EXT, ".json", ".jsonc", ".css"] };
const GOFMT: Formatter = { command: ["gofmt", "-w"], extensions: [".go"] };

/** Formatter name (as the diagnosis writes it) → the per-file command. `null`: known, but it has no per-file command. */
const FORMATTERS: Record<string, Formatter | null> = {
  prettier: { command: ["npx", "prettier", "--write"], extensions: [...JS_EXT, ".json", ".css", ".scss", ".less", ".md", ".mdx", ".yaml", ".yml", ".html", ".vue", ".graphql"] },
  eslint: { command: ["npx", "eslint", "--fix"], extensions: JS_EXT },
  biome: BIOME,
  "@biomejs/biome": BIOME,
  ruff: { command: ["ruff", "format"], extensions: [".py", ".pyi"] },
  black: { command: ["black"], extensions: [".py", ".pyi"] },
  gofmt: GOFMT,
  "golangci-lint": GOFMT,
  rustfmt: { command: ["rustfmt"], extensions: [".rs"] },
  spotless: null,
  ktlint: { command: ["ktlint", "-F"], extensions: [".kt", ".kts"] },
  "php-cs-fixer": { command: ["php-cs-fixer", "fix"], extensions: [".php"] },
  terraform_fmt: { command: ["terraform", "fmt"], extensions: [".tf", ".tfvars"] },
};

/** "rustfmt/clippy (toolchain pinned)" → rustfmt; "Prettier" → prettier; unknown → undefined. */
function formatterFor(name: string): Formatter | null | undefined {
  const full = name.toLowerCase().trim();
  if (Object.hasOwn(FORMATTERS, full)) return FORMATTERS[full];
  const short = (full.replace(/\s*\(.*$/, "").split("/")[0] ?? "").trim();
  return Object.hasOwn(FORMATTERS, short) ? FORMATTERS[short] : undefined;
}

/* ── permissions, files ─────────────────────────────────────────── */

/**
 * Claude Code's permission-rule syntax: `Tool(pattern)`. An entry that already
 * is one stays; a bare path becomes both `Read(path)` and `Edit(path)`. A
 * directory is one that ends in `/` — it gets `/**` so everything under it is
 * covered; a path without the slash is taken as a file (`id_rsa`, `.env`),
 * because guessing "directory" from a missing extension would turn the most
 * important entries into rules that match nothing.
 */
function denyRules(entries: string[]): string[] {
  const out: string[] = [];
  const add = (r: string) => { if (!out.includes(r)) out.push(r); };
  for (const raw of entries) {
    const e = raw.trim();
    if (!e) continue;
    if (/^[A-Z][A-Za-z]*\(.*\)$/.test(e)) { add(e); continue; }
    let p = e.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
    if (p.endsWith("/")) {
      p = p.replace(/\/+$/, "");
      if (!/[*?[\]]/.test(p)) p = `${p}/**`;
    }
    if (!p) continue;
    add(`Read(${p})`);
    add(`Edit(${p})`);
  }
  return out;
}

/**
 * `.gitattributes`: a directory (trailing slash, or a last segment without an
 * extension) gets `/**`; a file is named as it is. Only `linguist-generated`:
 * it folds the path in a review, while `-diff` would hide a change to it from
 * the reviewer altogether.
 */
function gitattributesLine(raw: string): string {
  const p = raw.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  const last = p.split("/").pop() ?? "";
  const dir = raw.endsWith("/") || !/\.[A-Za-z0-9]+$/.test(last);
  return `${p}${dir ? "/**" : ""} linguist-generated=true`;
}

const fence = (cmds: string[]) => `\`\`\`sh\n${cmds.join("\n")}\n\`\`\``;

/** The tools, from the card's params or the facts; null when the diagnosis did not look. */
function toolsOf(p: Params, repo: RepoFacts): Tools | null {
  const v = p.tools;
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Tools;
  return repo.tools ?? null;
}
/** A list param given as an array (possibly empty — "known: none") wins; otherwise the fact; otherwise unknown. */
const known = (p: Params, k: string, fact: string[] | null | undefined): string[] | null => (Array.isArray(p[k]) ? strs(p, k) : fact ?? null);

/**
 * The ways to build: an msbuild solution builds with Visual Studio's MSBuild
 * or `dotnet msbuild` — the one the diagnosing machine has goes first, both
 * are kept so the script can take whichever the machine it runs on has. Any
 * other command is taken as it is.
 */
function buildAlternatives(build: string, sln: string, tools: Tools | null): string[] {
  const m = /^msbuild(?:\.exe)?\s+("[^"]+"|\S+)/i.exec(build);
  if (!m && !(sln && /^msbuild\b/i.test(build))) return build ? [build] : [];
  const target = m?.[1] ?? sln;
  const full = `msbuild ${target}`;
  const viaDotnet = `dotnet msbuild ${target}`;
  return tools && !tools.msbuild && (tools.dotnet_msbuild ?? tools.dotnet) ? [viaDotnet, full] : [full, viaDotnet];
}

/** What the build section of AGENTS.md says for a Windows-only (.NET Framework) solution, from the tools found — never "cannot build here" when one exists. */
function windowsBuildText(sln: string, tools: Tools, webApps: number | null | undefined): string {
  const target = sln || "<the solution>.sln";
  const dotnet = !!(tools.dotnet_msbuild ?? tools.dotnet);
  const web = webApps === 0 ? "" : webApps ? `; the ${webApps} Web Application project${webApps === 1 ? "" : "s"} need${webApps === 1 ? "s" : ""} Visual Studio's MSBuild` : "; Web Application projects need Visual Studio's MSBuild";
  if (tools.msbuild) {
    return [
      "Build (Windows, Visual Studio's MSBuild — from a Developer PowerShell, or MSBuild.exe by its full path when `msbuild` is not on PATH):",
      fence([`msbuild ${target}`]),
      ...(dotnet ? [`${code(`dotnet msbuild ${target}`)} builds the class libraries too${web}.`] : []),
    ].join("\n\n");
  }
  if (dotnet) return [`Build — the class libraries build with \`dotnet msbuild\`${web}:`, fence([`dotnet msbuild ${target}`])].join("\n\n");
  // Neither tool is here: the command is still the repository's (the check accepts a command of the repository's own
  // toolchain), and the line after it says plainly that it cannot run on this machine.
  return [`Build (Windows, Visual Studio's MSBuild — from a Developer PowerShell, or MSBuild.exe by its full path)${web}:`, fence([`msbuild ${target}`]), "Neither MSBuild nor the dotnet SDK is installed on this machine, so no build can run here — say so plainly; never claim a build or a test run."].join("\n\n");
}

/** Is a command's first word a tool this machine has (or one the check treats as always present)? Unknown tools → true, the check decides later. */
function runnableHere(cmd: string, tools: Tools | null): boolean {
  if (!tools) return true;
  const first = cmd.trim().split(/\s+/)[0]?.toLowerCase().replace(/\.exe$/, "") ?? "";
  if (["git", "npx", "node", "npm"].includes(first)) return first === "git" || first === "npx" || !!tools[first];
  const known = Object.keys(tools).some((k) => k.replace(/_/g, " ").split(" ")[0] === first || k === first);
  return known ? !!(tools[first] ?? tools[first.replace(/\./g, "_")]) : true;
}

/** The tests part: only test projects git tracks count; none tracked is said plainly; a runner this machine lacks is said in words, not fenced. */
function testsText(projects: string[], commands: string[] | null, fallback: string, tools: Tools | null = null): string {
  if (!projects.length) return "Tests: no test project is tracked in git — there is nothing to run. Say so rather than claim a test run.";
  const cmds = commands?.length ? commands : fallback ? [fallback] : [];
  // The commands are the repository's whatever this machine has; a runner missing here is said on the line after them.
  const missing = cmds.filter((c) => !runnableHere(c, tools)).map((c) => c.trim().split(/\s+/)[0]!.replace(/\.exe$/, ""));
  const head = `Tests — the projects tracked in git: ${projects.map((d) => code(d === "." ? "(root)" : `${d}/`)).join(", ")}${cmds.length ? "" : ". Run them with the runner their framework uses."}`;
  const parts = [head, ...(cmds.length ? [fence(cmds)] : [])];
  if (missing.length) parts.push(`The test runner (${[...new Set(missing)].join(", ")}) is not installed on this machine, so those tests cannot run here — say so instead of claiming a test run.`);
  return parts.join("\n\n");
}

/**
 * The "Build, test, lint" facts: fenced blocks for AGENTS.md, bullet lines for
 * a section appended to an existing file. With the tools and the tracked test
 * projects known, each part states what exists — a part with nothing behind
 * it is said once, plainly, or left out (lint).
 */
function commandsSection(repo: RepoFacts, fenced: boolean, seen?: { tools: Tools | null; testProjects: string[] | null; testCommands: string[] | null; sln: string; webApps?: number | null }): string {
  const build = command(repo.buildCommand);
  const test = command(repo.testCommand);
  const lint = command(repo.lintCommand);
  if (fenced && seen && (seen.tools || seen.testProjects)) {
    const parts: string[] = [];
    if (repo.windowsOnly && seen.tools) parts.push(windowsBuildText(seen.sln, seen.tools, seen.webApps));
    else parts.push(build ? `Build:\n\n${fence([build])}` : "Build: no build command was found in the repository.");
    parts.push(seen.testProjects ? testsText(seen.testProjects, seen.testCommands, test, seen.tools) : test ? `Test:\n\n${fence([test])}` : "Test: no test command was found in the repository.");
    if (lint) parts.push(`Lint:\n\n${fence([lint])}`);
    return parts.join("\n\n");
  }
  const rows: [string, string][] = [["Build", build], ["Test", test], ["Lint", lint]];
  const parts = rows.filter(([label, cmd]) => cmd || label !== "Lint").map(([label, cmd]) => {
    if (!cmd) return fenced ? `${label}: no ${label.toLowerCase()} command was found in the repository.` : `- ${label}: no command found in the repository`;
    return fenced ? `${label}:\n\n${fence([cmd])}` : `- ${label}: ${code(cmd)}`;
  });
  if (repo.windowsOnly) {
    parts.push(fenced
      ? "The build runs only on Windows (msbuild, Visual Studio build tools). Where there is none, say so — never claim a build or a test run."
      : "- The build runs only on Windows (msbuild); where there is none, say so — never claim a build or a test run");
  }
  return parts.join(fenced ? "\n\n" : "\n");
}

type LayoutMap = { top: string[]; groups: { parent: string; members: string[] }[] };
function layoutMapOf(v: unknown): LayoutMap | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as { top?: unknown; groups?: unknown };
  const top = Array.isArray(o.top) ? o.top.map(String) : [];
  const groups = (Array.isArray(o.groups) ? o.groups : [])
    .filter((g): g is { parent: unknown; members: unknown } => !!g && typeof g === "object")
    .map((g) => ({ parent: String(g.parent), members: Array.isArray(g.members) ? g.members.map(String) : [] }))
    .filter((g) => g.members.length);
  return top.length || groups.length ? { top, groups } : null;
}

const LAYOUT_TOP_MAX = 20;
/** A map of where things are — the top folders, and the folders that hold many projects side by side — never a list of every package. */
function layoutText(l: LayoutMap): string {
  const baseName = (p: string) => p.split("/").pop() ?? p;
  const within = (g: { parent: string }, top: string) => g.parent === top || g.parent.startsWith(`${top}/`);
  const groupText = (g: { parent: string; members: string[] }) => `${code(`${g.parent}/`)} holds ${g.members.length} projects side by side (e.g. ${code(baseName(g.members[0]!))})`;
  const lines = l.top.slice(0, LAYOUT_TOP_MAX).map((top) => {
    const gs = l.groups.filter((g) => within(g, top));
    return `- ${code(`${top}/`)}${gs.length ? ` — ${gs.map(groupText).join("; ")}` : ""}`;
  });
  if (l.top.length > LAYOUT_TOP_MAX) lines.push(`- and ${l.top.length - LAYOUT_TOP_MAX} more folders`);
  for (const g of l.groups.filter((x) => x.parent === ".")) lines.push(`- the root holds ${g.members.length} projects side by side (e.g. ${code(baseName(g.members[0]!))})`);
  return lines.join("\n") || "(flat)";
}

type FirstTest = { match: RegExp; file: string; template: string; note: string };
const FIRST_TESTS: FirstTest[] = [
  { match: /^(typescript|javascript|tsx|jsx|node(\.js)?)$/i, file: "tests/smoke.test.mjs", template: "tests/smoke.test.mjs", note: "run: node --test tests/ — Node's built-in runner, no dependency; move the test into the repository's own runner (vitest, jest) once there is one" },
  { match: /^python$/i, file: "tests/test_smoke.py", template: "tests/test_smoke.py", note: "run: python -m pytest tests/ — a plain assert, so any runner can take it" },
  { match: /^(go|golang)$/i, file: "smoke_test.go", template: "tests/smoke_test.go", note: "package name unknown (go.mod was not read): the file says `package main` — rename it to the package of the folder it lands in" },
  { match: /^(c#|csharp)$/i, file: "Tests/Smoke/SmokeTests.cs", template: "tests/SmokeTests.cs", note: "needs a test project: `dotnet new mstest -o Tests/Smoke`, put the file in it and add the project to the solution" },
  { match: /^java$/i, file: "src/test/java/SmokeTest.java", template: "tests/SmokeTest.java", note: "JUnit 5: junit-jupiter must be on the test classpath (test scope in pom.xml, or testImplementation + useJUnitPlatform() in Gradle)" },
];

const DOC_TITLES: Record<string, string> = {
  architecture: "Architecture",
  integrations: "Integrations and external systems",
  "build-and-run": "Build and run",
  glossary: "Glossary",
};

const PER_PACKAGE_CAP = 12;

/* ── skills, agents ─────────────────────────────────────────────── */

function skillFile(name: string, values: Record<string, string>): CatalogFile {
  return { path: `.claude/skills/${name}/SKILL.md`, content: fill(template(`skills/${name}.md`), values) };
}

function agentFile(name: string, templateName: string, values: Record<string, string>): CatalogFile {
  return { path: `.claude/agents/${name}.md`, content: fill(template(`agents/${templateName}.md`), values) };
}

const reviewMd = (agent: string): CatalogFile => ({ path: "REVIEW.md", content: fill(template("docs/REVIEW.md"), { agent }) });
const CHECKLIST_NOTE = "fill {{CHECKLIST}} from the history: what broke there before, what every change must keep — one line each";

/** How to run one test file with the framework the diagnosis named. */
function narrowHint(cmd: string, frameworks: string[]): string {
  const f = frameworks.join(" ").toLowerCase();
  if (/vitest|jest|mocha|node:test|ava/.test(f)) return `pass the test file's path: ${code(`${cmd} <path/to/file.test.*>`)}`;
  if (/pytest/.test(f)) return "`pytest <path/to/test_file.py>` (or `-k <name>`)";
  if (/\bgo\b|testing/.test(f)) return "`go test ./<package>/...`";
  if (/xunit|nunit|mstest|dotnet/.test(f)) return "`dotnet test --filter \"FullyQualifiedName~<TestClass>\"`";
  if (/phpunit/.test(f)) return "`phpunit --filter <TestClass>`";
  if (/junit|gradle|maven/.test(f)) return "`./gradlew test --tests <Class>` or `./mvnw -Dtest=<Class> test`";
  if (/cargo|rust/.test(f)) return "`cargo test <name>`";
  if (/playwright|cypress/.test(f)) return "pass the spec file's path to the runner";
  return "pass the test file's path to the command when the runner accepts one; otherwise run the whole suite";
}

const LANGUAGE_NOTES: Record<string, string> = {
  php: "**PHP** — `$_GET` / `$_POST` / `$_REQUEST` echoed, or concatenated into a query (`mysqli_query`, `->query`, `exec`); `include` / `require` with a variable path; `unserialize` on input; `htmlspecialchars` missing in a template; `move_uploaded_file` to a path from input.",
  javascript: "**JavaScript** — `innerHTML`, `document.write`, `dangerouslySetInnerHTML`, `eval` / `new Function`; `child_process.exec` with a string built from input; `path.join` on a request value without `path.resolve` and a prefix check; a redirect to a URL from input; prototype pollution through deep merges of request bodies.",
  typescript: "**TypeScript** — as JavaScript: `innerHTML`, `dangerouslySetInnerHTML`, `eval`; `child_process.exec` with input; `path.join` on a request value without a prefix check; a redirect to a URL from input; `as any` around request data that skips validation.",
  python: "**Python** — `subprocess` with `shell=True` and input; f-strings or `%` in SQL; `pickle.loads`, `yaml.load` without `SafeLoader`; `open()` on a path from input; Jinja `|safe` / `Markup` on data; `eval` / `exec`.",
  "c#": "**C#** — `SqlCommand` text built by concatenation or interpolation; `Html.Raw` on data; `BinaryFormatter` / `TypeNameHandling.All`; `Path.Combine` with a request value; `[ValidateAntiForgeryToken]` missing on a POST action; `Process.Start` with input.",
  java: "**Java** — `Statement` with concatenated SQL instead of `PreparedStatement`; `Runtime.exec` / `ProcessBuilder` with input; an XML parser without external entities disabled (XXE); `ObjectInputStream` on data; `th:utext` or a JSP scriptlet on data; `new File(base, input)` without a canonical-path check.",
  kotlin: "**Kotlin** — as Java (`PreparedStatement`, `ProcessBuilder`, XXE, deserialisation); on Android, `WebView.loadUrl` / `addJavascriptInterface` with data and exported components that trust an intent's extras.",
  go: "**Go** — `fmt.Sprintf` into `db.Query` instead of placeholders; `exec.Command(\"sh\", \"-c\", ...)` with input; `text/template` where `html/template` is needed; `filepath.Join` on input without `filepath.Clean` and a prefix check; `http.Get` on a URL from input.",
  rust: "**Rust** — `Command::new(\"sh\").arg(\"-c\")` with input; `format!` into SQL; `unsafe` blocks that trust an input length; path joins without canonicalisation.",
  ruby: "**Ruby** — string interpolation in `where` / `find_by_sql`; `system` / backticks with input; `Marshal.load` / `YAML.load` on data; `raw` / `html_safe` on data; `send` with a method name from input.",
};

/* ── the catalog ────────────────────────────────────────────────── */

const TEMPLATES: Record<string, Template> = {
  /* hooks */
  "block-paths": {
    kind: "hook", produces: [`${HOOK_DIR}/block-paths.mjs`, "settings.hooks.PreToolUse"],
    render: (p) => {
      const paths = strs(p, "paths");
      const reason = str(p, "reason") || "this path must not be edited by hand";
      const notes = [
        verifyHook("block-paths", `{"tool_name":"Edit","tool_input":{"file_path":"<a file under ${paths[0] ?? "<path>"}>"},"cwd":"<repo>"}`, "exit 2 with the reason; a file elsewhere exits 0"),
        "a shell command that writes into a guarded path (a > or >> redirect, Set-Content / Add-Content / Out-File, tee, cp / mv / copy / move / Copy-Item / Move-Item) is blocked the same way",
      ];
      if (!paths.length) notes.push("no paths given: the hook blocks nothing");
      return { files: [hookFile("block-paths", { paths, reason })], settings: { hooks: { PreToolUse: [hookEntry("block-paths", GUARD_TOOLS), hookEntry("block-paths", SHELL_TOOLS)] } }, notes };
    },
  },
  "block-commands": {
    kind: "hook", produces: [`${HOOK_DIR}/block-commands.mjs`, "settings.hooks.PreToolUse"],
    render: (p) => {
      const patterns = strs(p, "patterns");
      const reason = str(p, "reason") || "this command is a person's decision";
      const notes = [verifyHook("block-commands", `{"tool_name":"Bash","tool_input":{"command":"${patterns[0] ?? "<pattern>"}"}}`, "exit 2 with the reason; another command exits 0")];
      if (!patterns.length) notes.push("no patterns given: the hook blocks nothing");
      return { files: [hookFile("block-commands", { patterns, reason })], settings: { hooks: { PreToolUse: [hookEntry("block-commands", SHELL_TOOLS)] } }, notes };
    },
  },
  "secret-scan": {
    kind: "hook", produces: [`${HOOK_DIR}/secret-scan.mjs`, "settings.hooks.PreToolUse"],
    render: (p) => {
      const allowTests = p.allowTests === true;
      return {
        files: [hookFile("secret-scan", { allowTests })],
        settings: { hooks: { PreToolUse: [hookEntry("secret-scan", GUARD_TOOLS), hookEntry("secret-scan", SHELL_TOOLS)] } },
        notes: [
          verifyHook("secret-scan", '{"tool_name":"Write","tool_input":{"file_path":"config.ts","content":"Password=Sup3rSecret123;"}}', "exit 2, the value masked as ***"),
          allowTests ? "test files (tests/, __tests__/, spec/, fixtures/, testdata/, *.test.*, *.spec.*) are not scanned: their credentials are fixtures" : "test files are scanned too; use allowTests when fixtures hold fake credentials on purpose",
          "on `git commit` (in Bash or PowerShell) the staged diff is scanned, plus what a `git add` in the same command is about to stage (all changes and new files for `-A` / `.`), and the working tree for `commit -a`",
        ],
      };
    },
  },
  "build-gate": {
    kind: "hook", produces: [`${HOOK_DIR}/build-gate.mjs`, "settings.hooks.Stop"],
    render: (p, repo) => {
      const cmd = command(str(p, "command")) || command(repo.buildCommand);
      const notes = [verifyHook("build-gate", '{"cwd":"<repo>"}', "exit 2 with the build's last lines when it fails, 0 when it passes; with stop_hook_active:true always 0")];
      if (!cmd) notes.push("no build command known: the hook exits 0 and prints nothing — fill CONFIG.command when one is known");
      if (repo.windowsOnly) notes.push("Windows-only build: the hook only helps on a Windows machine; elsewhere the command fails and Claude is told so on every turn — consider not installing it");
      return { files: [hookFile("build-gate", { command: cmd })], settings: { hooks: { Stop: [hookEntry("build-gate", null, 660)] } }, notes };
    },
  },
  "post-format": {
    kind: "hook", produces: [`${HOOK_DIR}/post-format.mjs`, "settings.hooks.PostToolUse"],
    render: (p) => {
      const formatter = str(p, "formatter");
      const spec = formatterFor(formatter);
      if (spec === null) return { files: [], notes: [`skipped: ${formatter} has no per-file command (it runs through the build, e.g. ./gradlew spotlessApply) — no hook written`] };
      const notes: string[] = [];
      if (!spec) notes.push(`no command known for ${formatter || "(no formatter named)"} — the hook does nothing (exits 0); put the formatter's command into CONFIG.command by hand, or drop the hook`);
      else notes.push(`verify: edit a ${spec.extensions[0] ?? ""} file through Claude and see ${spec.command.join(" ")} run on it; the hook never blocks`);
      const config = spec ? { formatter, command: spec.command, extensions: spec.extensions } : { formatter, command: null, extensions: [] };
      return { files: [hookFile("post-format", config)], settings: { hooks: { PostToolUse: [hookEntry("post-format", FILE_TOOLS, 90)] } }, notes };
    },
  },
  "post-validate": {
    kind: "hook", produces: [`${HOOK_DIR}/post-validate.mjs`, "settings.hooks.PostToolUse"],
    render: (p) => {
      const match = str(p, "match");
      const cmd = command(str(p, "command"));
      const notes = [verifyHook("post-validate", '{"tool_name":"Write","tool_input":{"file_path":"<a matching file>"},"cwd":"<repo>"}', "exit 2 with the validator's output when it fails, 0 otherwise")];
      if (!match || !cmd) notes.push("match or command missing: the hook does nothing");
      try { new RegExp(match); } catch { notes.push(`match is not a valid regular expression: ${match}`); }
      return { files: [hookFile("post-validate", { match, command: cmd })], settings: { hooks: { PostToolUse: [hookEntry("post-validate", FILE_TOOLS, 150)] } }, notes };
    },
  },

  /* permissions, files */
  deny: {
    kind: "permission", produces: ["settings.permissions.deny"],
    render: (p) => {
      const deny = denyRules(strs(p, "deny"));
      return { files: [], settings: { permissions: { deny } }, notes: deny.length ? ["verify: `claude` in the repository, then /permissions shows the rules under Deny"] : ["no entries given: nothing to deny"] };
    },
  },
  gitignore: {
    kind: "gitignore", produces: [".gitignore (fragment)"],
    render: (p) => {
      const entries = strs(p, "entries");
      return {
        files: [{ path: ".gitignore", content: `# added by DCC onboarding\n${entries.join("\n")}\n` }],
        notes: ["merge: append the lines .gitignore does not already have, under the header — never replace the file", ...(entries.length ? [] : ["no entries given"])],
      };
    },
  },
  gitattributes: {
    kind: "gitattributes", produces: [".gitattributes (fragment)"],
    render: (p) => {
      const paths = strs(p, "paths");
      return {
        files: [{ path: ".gitattributes", content: `# added by DCC onboarding: generated code, folded in reviews (a change to it still shows)\n${paths.map(gitattributesLine).join("\n")}\n` }],
        notes: ["merge: append the lines .gitattributes does not already have — never replace the file", ...(paths.length ? [] : ["no paths given"])],
      };
    },
  },
  "local-gate": {
    kind: "script", produces: ["scripts/dcc-verify.mjs"],
    render: (p, repo) => {
      const tools = toolsOf(p, repo);
      const build = command(str(p, "build")) || command(repo.buildCommand);
      // A test step only for test projects git tracks; without that fact, the one test command there is.
      const tests = known(p, "tests", repo.testCommands) ?? [command(str(p, "test")) || command(repo.testCommand)].filter(Boolean);
      const buildRun = buildAlternatives(build, str(p, "sln") || repo.solution || "", tools);
      const steps = [...(buildRun.length ? [{ name: "build", run: buildRun }] : []), ...tests.map((t) => ({ name: "test", run: [t] }))];
      const notes = ['add "verify": "node scripts/dcc-verify.mjs" to package.json scripts when the repository has a package.json', "verify: node scripts/dcc-verify.mjs — the last line is the verdict (VERIFY: ok | partial — <step> not run here | failed <step> | nothing to run | cannot run here)"];
      if (!steps.length) notes.push("no build or test command known: the script prints VERIFY: nothing to run — fill CONFIG in the script when one is known");
      if (buildRun.length > 1) notes.push(`build: the first of ${buildRun.map(code).join(" / ")} whose tool the machine has; neither → VERIFY: cannot run here, exit 3`);
      if (!tests.length) notes.push("no test step: no test project is tracked in git");
      return { files: [{ path: "scripts/dcc-verify.mjs", content: bake("scripts/dcc-verify.mjs", { steps }), mode: 0o755 }], notes };
    },
  },
  "first-test": {
    kind: "scaffold", produces: FIRST_TESTS.map((t) => t.file),
    render: (p, repo) => {
      const languages = strs(p, "languages").length ? strs(p, "languages") : repo.languages;
      for (const language of languages) {
        const t = FIRST_TESTS.find((x) => x.match.test(language));
        if (t) return { files: [{ path: t.file, content: template(t.template) }], notes: [`${language}: ${t.note}`, "verify: run it in the isolated copy when a runner exists; a test that cannot run is text"] };
      }
      const rest = languages.slice(1);
      return { files: [], notes: [`no first-test template for ${languages[0] ?? "(no language)"}${rest.length ? ` (nor for ${rest.join(", ")})` : ""}`] };
    },
  },
  "agents-md": {
    kind: "scaffold", produces: ["AGENTS.md", "CLAUDE.md"],
    render: (p, repo) => {
      const mergeFrom = strs(p, "mergeFrom");
      const facts = [
        repo.languages.length ? `Languages: ${repo.languages.join(", ")}.` : "",
        repo.packageManager ? `Package manager: ${repo.packageManager}.` : "",
        repo.defaultBranch ? `Default branch: ${code(repo.defaultBranch)}.` : "",
      ].filter(Boolean).join(" ");
      const merged = mergeFrom.length
        ? `\n## Merged from\n\nThe files below were merged into this one; where they repeat or contradict the sections above, the sections above win.\n\n${bullets(mergeFrom)}\n`
        : "";
      const seen = { tools: toolsOf(p, repo), testProjects: known(p, "tests_projects", repo.testProjects), testCommands: known(p, "test_commands", repo.testCommands), sln: str(p, "sln") || repo.solution || "", webApps: typeof p.web_apps === "number" ? p.web_apps : repo.webAppProjects };
      const layout = layoutMapOf(p.layout);
      const content = fill(template("docs/AGENTS.md"), {
        name: repo.name, facts: facts ? `\n_${facts}_\n` : "", commands: commandsSection(repo, true, seen), merged,
        // A map of where things are; without the diagnosis's layout, the builder's slot stays for it to fill.
        layout: layout ? layoutText(layout) : "{{LAYOUT}}",
      });
      return {
        files: [{ path: "AGENTS.md", content }, { path: "CLAUDE.md", content: "@AGENTS.md\n" }],
        notes: [
          `fill {{PURPOSE}}${layout ? "" : ", {{LAYOUT}}"}, {{EXTERNAL}}, {{VERIFICATION}} from the diagnosis, and {{RULES}} with one bullet per approved rule line; keep the whole file short — every line is loaded in every session`,
          "{{VERIFICATION}} carries only how to check a change (the gate script when there is one): the build and test commands are already in their section above — never repeat them, never contradict them",
          "CLAUDE.md (the one line @AGENTS.md) is for a repository that has no CLAUDE.md — never overwrite an existing one",
          ...(mergeFrom.length ? [`merge the content of ${mergeFrom.join(", ")} into the matching sections and keep the list under ## Merged from`] : []),
        ],
      };
    },
  },
  "agents-md-delta": {
    kind: "doc", produces: ["AGENTS.md (a section to append)"],
    render: (p, repo) => {
      const existing = strs(p, "existing");
      const date = str(p, "date") || new Date().toISOString().slice(0, 10);
      const content = fill(template("docs/AGENTS-delta.md"), { date, commands: commandsSection(repo, false) });
      return {
        files: [{ path: "AGENTS.md", content }],
        notes: [`append: add this section to the end of ${existing.length ? existing.join(" / ") : "the existing AGENTS.md or CLAUDE.md"} — never replace the file`, "fill {{RULES}}: one bullet per approved rule line"],
      };
    },
  },
  "per-package": {
    kind: "scaffold", produces: ["<package>/CLAUDE.md"],
    render: (p) => {
      const packages = strs(p, "packages");
      const kept = packages.slice(0, PER_PACKAGE_CAP);
      // The commands the diagnosis found for a package (it lists only packages whose command differs from the root's); unknown → the builder reads the manifest.
      const own = new Map((Array.isArray(p.commands) ? p.commands : [])
        .filter((c): c is Params => !!c && typeof c === "object" && !Array.isArray(c))
        .map((c) => [str(c, "dir").replace(/\/+$/, ""), [str(c, "build"), str(c, "test")].filter(Boolean)] as const));
      const files = kept.map((raw) => {
        const dir = raw.replace(/\/+$/, "");
        const cmds = own.get(dir);
        return { path: `${dir}/CLAUDE.md`, content: fill(template("docs/package-CLAUDE.md"), { dir, commands: cmds?.length ? fence(cmds) : "{{PACKAGE_COMMANDS}}" }) };
      });
      const notes = own.size ? ["verify: each command runs from its package's folder"] : ["fill {{PACKAGE_COMMANDS}} in each file with the package's own build and test commands, read from its manifest"];
      if (packages.length > PER_PACKAGE_CAP) notes.push(`capped: ${PER_PACKAGE_CAP} of ${packages.length} packages got a file; left out: ${packages.slice(PER_PACKAGE_CAP).join(", ")}`);
      if (!packages.length) notes.push("no packages given — nothing written");
      return { files, notes };
    },
  },
  "per-area": {
    kind: "scaffold", produces: ["<area>/CLAUDE.md"],
    render: (p) => {
      const areas = (Array.isArray(p.areas) ? p.areas : []).filter((a): a is Params => !!a && typeof a === "object" && !Array.isArray(a));
      const files: CatalogFile[] = [];
      for (const a of areas) {
        const dir = str(a, "dir").replace(/\/+$/, "");
        if (!dir) continue;
        const toolchain = str(a, "toolchain") || "its own";
        // An area of several units (PCF controls side by side): the command runs inside each, never in the parent that has no manifest.
        const cwds = strs(a, "cwds").map((c) => c.replace(/\/+$/, ""));
        const where = cwds.length
          ? `Toolchain: ${toolchain}. Each folder below builds on its own — run the command from inside it (there is no build manifest in ${code(`${dir}/`)} itself):`
          : `Toolchain: ${toolchain}. This area builds on its own, from this folder:`;
        const after = toolchain === "node" ? `Run \`npm install\` in the folder first when it has no node_modules.\n\n` : "";
        // One checkable line per folder — `cd <folder> && <command>` from the repository root — never a bare command the
        // area folder itself cannot run (the Trade run failed `npm run build` said from Pcf/, which holds no package.json).
        const cmd = str(a, "command") || "<the build command>";
        const command = cwds.length ? cwds.map((c) => `cd ${c} && ${cmd}`).join("\n") : cmd;
        files.push({ path: `${dir}/CLAUDE.md`, content: fill(template("docs/area-CLAUDE.md"), { dir, where, command, after, them: cwds.length ? "these" : "it" }) });
      }
      return { files, notes: files.length ? ["verify: each command runs from the folder that holds its manifest (package.json, .sln)"] : ["no areas given — nothing written"] };
    },
  },
  "docs-set": {
    kind: "doc", produces: Object.keys(DOC_TITLES).map((d) => `docs/${d}.md`),
    render: (p) => {
      const files: CatalogFile[] = [];
      const notes: string[] = [];
      for (const d of strs(p, "docs")) {
        const title = DOC_TITLES[d];
        if (!title) { notes.push(`unknown doc "${d}" — skipped (known: ${Object.keys(DOC_TITLES).join(", ")})`); continue; }
        files.push({ path: `docs/${d}.md`, content: fill(template("docs/doc-skeleton.md"), { title }) });
      }
      notes.push(files.length ? "fill {{BODY}} of each from the diagnosis; cite files that exist" : "no known doc names given — nothing written");
      return { files, notes };
    },
  },
  "hot-dir-doc": {
    kind: "doc", produces: ["docs/architecture-<dir>.md"],
    render: (p) => {
      const dir = str(p, "dir") || ".";
      const content = fill(template("docs/hot-dir.md"), { dir, changes: str(p, "changes") || "many", authors: str(p, "authors") || "several" });
      return { files: [{ path: `docs/architecture-${slug(dir)}.md`, content }], notes: ["fill {{BODY}}: what is in the directory, what depends on what, what broke here before (from the history); cite files that exist"] };
    },
  },

  /* skills */
  "run-affected-tests": {
    kind: "skill", produces: [".claude/skills/run-affected-tests/SKILL.md"],
    render: (p, repo) => {
      const cmd = command(str(p, "command")) || command(repo.testCommand) || "<the test command>";
      const dirs = strs(p, "dirs");
      const frameworks = strs(p, "frameworks");
      const values = {
        command: cmd,
        dirs: dirs.length ? dirs.map(code).join(", ") : "next to the code they test",
        frameworks: yamlSafe(frameworks.join(", ")) || "the framework the manifest names",
        narrow: narrowHint(cmd, frameworks),
      };
      return { files: [skillFile("run-affected-tests", values)], notes: cmd.startsWith("<") ? ["no test command known: replace <the test command> in the skill"] : ["verify: ask Claude to run the tests and see it use the command"] };
    },
  },
  "verify-like-ci": {
    kind: "skill", produces: [".claude/skills/verify-like-ci/SKILL.md"],
    render: (p) => {
      const commands = strs(p, "commands");
      const systems = strs(p, "systems");
      const block = commands.length ? commands.map((c, i) => `# ${i + 1}\n${c}`).join("\n") : "# the workflow files name no commands DCC could read — open them and list the steps here";
      return { files: [skillFile("verify-like-ci", { systems: yamlSafe(systems.join(", ")) || "CI", commands: block })], notes: commands.length ? ["verify: the commands are the workflow files' own, in their order"] : ["no CI commands given: the skill asks to list them from the workflow files"] };
    },
  },
  "which-package": {
    kind: "skill", produces: [".claude/skills/which-package/SKILL.md"],
    render: (p) => {
      // Every package, or none: a list cut to a first few tells the agent the rest do not exist.
      const packages = strs(p, "packages");
      const count = Number(str(p, "count")) || packages.length;
      const workspaces = yamlSafe(str(p, "workspaces")) || "workspace";
      // Only the manifests this repository has — no pyproject.toml in a .NET repository.
      const manifests = strs(p, "manifests");
      const manifestText = manifests.length ? manifests.map(code).join(", ") : "its manifest";
      const globText = manifests.length ? manifests.map((m) => code(`**/${m}`)).join(", ") : "the manifest files";
      const own = (Array.isArray(p.own) ? p.own : []).filter((o): o is Params => !!o && typeof o === "object" && !Array.isArray(o));
      const rootBuild = command(str(p, "rootBuild"));
      const ownText = own.map((o) => `${code(`${str(o, "dir")}/`)} (${[str(o, "build"), str(o, "test")].filter(Boolean).map(code).join(", ")})`).join(", ");
      const buildStep = own.length
        ? `${rootBuild ? `Build and test from the root with ${code(rootBuild)}, except` : "Build and test from the root, except"} these packages, which build from their own folder: ${ownText}.`
        : rootBuild ? `Build and test from the root: ${code(rootBuild)} builds every package.` : "Build and test with the commands the root instructions (AGENTS.md) give.";
      const values = {
        workspaces,
        packages_intro: packages.length ? `The ${packages.length} packages:` : `The ${count} packages are too many to list here; find them with Glob on ${globText}.`,
        packages: packages.length ? bullets(packages) : "",
        pick_step: packages.length ? "Pick from the list the one or two packages whose names or paths match the request." : `Find the one or two packages whose names or paths match the request with Glob on ${globText}.`,
        manifests: manifestText,
        build_step: buildStep,
      };
      const notes = ["verify: ask 'where do I add X' and see the skill name a package before any search"];
      if (!packages.length) notes.push(`no package list: ${count} packages — the skill finds them with Glob instead`);
      return { files: [skillFile("which-package", values)], notes };
    },
  },
  "change-recipe": {
    kind: "skill", produces: [".claude/skills/change-recipe/SKILL.md"],
    render: (p) => {
      const shapes = (Array.isArray(p.shapes) ? p.shapes : [])
        .filter((s): s is Params => !!s && typeof s === "object" && !Array.isArray(s))
        .map((s) => ({ files: strs(s, "files"), times: Number(s.times) || 0 }))
        .filter((s) => s.files.length);
      const recipes = shapes.length
        ? shapes.map((s, i) => `## Recipe ${i + 1} — these ${s.files.length} files changed together ${s.times} times\n\n${s.files.map((f, j) => `${j + 1}. ${code(f)}`).join("\n")}`).join("\n\n")
        : "No recipe: the history showed no set of files that changes together often enough.";
      return { files: [skillFile("change-recipe", { recipes })], notes: shapes.length ? [`${shapes.length} recipe(s) from the history`] : ["no shapes given: the skill says so and applies to nothing"] };
    },
  },
  "build-on-runner": {
    kind: "skill", produces: [".claude/skills/build-on-runner/SKILL.md"],
    render: (p) => ({
      files: [skillFile("build-on-runner", { solution: yamlSafe(str(p, "solution")) || "the solution" })],
      notes: ["fill {{RUNNER}} with how the team reaches its Windows runner (a command, a pipeline, a URL), or the words 'none configured' — the skill then stops and says so instead of claiming a build"],
    }),
  },
  "terraform-docs": {
    kind: "skill", produces: [".claude/skills/terraform-docs/SKILL.md"],
    render: () => ({ files: [skillFile("terraform-docs", {})], notes: ["verify: change a variable description and see the README table regenerated, not hand-edited"] }),
  },
  "docs-sync": {
    kind: "skill", produces: [".claude/skills/docs-sync/SKILL.md"],
    render: (p) => ({ files: [skillFile("docs-sync", { pointer: yamlSafe(str(p, "pointer")) || "README.md" })], notes: ["verify: a change in a documented area ends with the document updated or 'docs: nothing to change'"] }),
  },
  "emulator-free-verify": {
    kind: "skill", produces: [".claude/skills/emulator-free-verify/SKILL.md"],
    render: (p) => {
      const raw = str(p, "screenshot");
      const screenshot = !raw || /^none/i.test(raw) ? "" : yamlSafe(raw);
      const values = {
        screenshot: screenshot || "none found",
        screenshot_steps: screenshot
          ? `run the ${screenshot} verify task for the changed screens; a new screen needs a recorded baseline, which a person captures on a device.`
          : "none were found in the repository, so there is no baseline to compare against — say so, and list the screens a person must look at on a device.",
      };
      return { files: [skillFile("emulator-free-verify", values)], notes: ["verify: a UI change ends with the three lists (verified / not verifiable here / assumptions)"] };
    },
  },
  "contribution-style": {
    kind: "skill", produces: [".claude/skills/contribution-style/SKILL.md"],
    render: (p) => {
      const contributing = strs(p, "contributing");
      const list = contributing.length ? contributing : ["CONTRIBUTING.md"];
      return { files: [skillFile("contribution-style", { contributing: yamlSafe(list.join(", ")), contributing_list: list.map(code).join(", ") })], notes: ["verify: a pull request ends with the list of rules followed and departures"] };
    },
  },

  /* agents */
  "scoped-reviewer": {
    kind: "agent", produces: [".claude/agents/reviewer-<dir>.md", "REVIEW.md (withReviewMd)"],
    render: (p, repo) => {
      const dir = str(p, "dir") || ".";
      const name = `reviewer-${slug(dir)}`;
      const values = { slug: slug(dir), dir: yamlSafe(dir), changes: str(p, "changes") || "many", authors: str(p, "authors") || "several", name: yamlSafe(repo.name) };
      const files = [agentFile(name, "scoped-reviewer", values)];
      if (p.withReviewMd === true) files.push(reviewMd(name));
      return { files, notes: [CHECKLIST_NOTE, "verify: run the reviewer on a change that plants a known bug under the directory and see it in the findings"] };
    },
  },
  "security-reviewer": {
    kind: "agent", produces: [".claude/agents/security-reviewer.md"],
    render: (p, repo) => {
      const languages = strs(p, "languages").length ? strs(p, "languages") : repo.languages;
      const notes = languages.map((l) => LANGUAGE_NOTES[l.toLowerCase()] ?? `**${l}** — the checklist above applies; the catalog has no language-specific notes for it yet.`);
      const values = { name: yamlSafe(repo.name), languages: yamlSafe(languages.join(", ")) || "this stack", language_notes: notes.length ? notes.map((n) => `- ${n}`).join("\n") : "- The checklist above applies." };
      return { files: [agentFile("security-reviewer", "security-reviewer", values)], notes: ["verify: run it on a change with a string-built query and see the finding"] };
    },
  },
  reviewer: {
    kind: "agent", produces: [".claude/agents/reviewer.md", "REVIEW.md"],
    render: (_p, repo) => ({
      files: [agentFile("reviewer", "reviewer", { name: yamlSafe(repo.name) }), reviewMd("reviewer")],
      notes: [CHECKLIST_NOTE, "verify: run the reviewer on a change that plants a known bug and see it in the findings"],
    }),
  },

  /* other */
  "pr-template": {
    kind: "pr_template", produces: [".github/pull_request_template.md"],
    render: () => ({ files: [{ path: ".github/pull_request_template.md", content: template("docs/pull_request_template.md") }], notes: ["skip when the repository already has a pull request template (.github/pull_request_template.md or .github/PULL_REQUEST_TEMPLATE/)"] }),
  },
  mcp: {
    kind: "mcp", produces: [".mcp.json (an mcpServers entry)", "notes: the ## MCP rule line"],
    render: (p) => {
      const server = str(p, "server") || "server";
      const url = str(p, "url");
      const cmd = str(p, "command");
      const args = strs(p, "args");
      const tools = strs(p, "tools");
      const readOnly = p.readOnly === true;
      const env = p.env && typeof p.env === "object" && !Array.isArray(p.env)
        ? Object.fromEntries(Object.entries(p.env as Record<string, unknown>).map(([k, v]) => [k, v == null ? "" : String(v)]))
        : null;
      const spec: Record<string, unknown> = url ? { type: "http", url } : { command: cmd || "<command>", args, ...(env ? { env } : {}) };
      const rule = `MCP ${code(server)}: use only these tools: ${tools.length ? tools.join(", ") : "(list the tools)"}${readOnly ? "; it is read-only — never write through it" : ""}.`;
      const notes = [
        `rule: ${rule}`,
        `keep only these tools: ${tools.length ? tools.join(", ") : "(none listed)"} — Claude Code does not filter tools in .mcp.json; the rule line above, under ## MCP in AGENTS.md, is what limits them`,
      ];
      if (!url && !cmd) notes.push("no url and no command given — fill `command` in .mcp.json before use");
      if (/\{[a-z_]+\}/i.test(url)) notes.push(`the url has a placeholder to fill from the client: ${url}`);
      if (p.placeholder === true || p.deliverable === false || /\{[a-z_]+\}/i.test(url)) notes.push("not deliverable as .mcp.json until the placeholder is filled: write it as an instruction in the pull request's report");
      const needs = strs(p, "needs");
      if (needs.length) notes.push(`needs from the client: ${needs.join(", ")}`);
      const onlyIf = str(p, "onlyIf");
      if (onlyIf) notes.push(`only if: ${onlyIf}`);
      const kinds = str(p, "kinds");
      if (kinds) notes.push(`for: ${kinds}`);
      if (readOnly) notes.push("read-only: run the server with a read-only credential; the rule line says so as well");
      return { files: [], mcp: { mcpServers: { [server]: spec } }, notes };
    },
  },
};

/* ── the API ────────────────────────────────────────────────────── */

/** Renders one template; throws on a name the catalog does not have. */
export function renderTemplate(template: string, params: Record<string, unknown>, repo: RepoFacts): Rendered {
  const t = TEMPLATES[template];
  if (!t) throw new Error(`unknown catalog template "${template}" (known: ${Object.keys(TEMPLATES).join(", ")})`);
  return t.render(params ?? {}, repo);
}

export function listTemplates(): { name: string; kind: string; produces: string[] }[] {
  return Object.entries(TEMPLATES).map(([name, t]) => ({ name, kind: t.kind, produces: [...t.produces] }));
}
