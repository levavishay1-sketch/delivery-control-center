import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Component, ComponentStatus, ComponentValidation, RepoProfile } from "./types.ts";

/**
 * Validation per kind of component, in the isolated copy: a hook is run
 * against a forbidden action and must block, and the settings must route the
 * event to it; a permission file must parse and every rule must have the
 * syntax Claude Code reads; a skill or an agent must carry the frontmatter
 * Claude Code triggers on and name only paths and commands that exist here;
 * a rule line, a doc or a scaffold must not name a path or a command this
 * repository and this machine do not have; a script is run. Every text kind
 * ends passed or failed — nothing is "not checked". A connection (MCP, LSP,
 * plugin) is checked as far as it can be here: the configuration parses and
 * holds the entry; the build calls that `configured`. Pure on the file system
 * (and `git check-attr`); no database, no model.
 */

const now = () => new Date().toISOString();
const result = (how: string, passed: boolean | null, detail: string): ComponentValidation => ({ how, passed, detail, at: now() });

/** What is installed on this machine, from the diagnosis (`profile.environment.tools`): a tool → where it was found, or null when it was looked for and is not there. */
export type HostTools = Readonly<Record<string, string | null>>;

export const toolsOf = (profile: RepoProfile | null | undefined): HostTools | undefined => profile?.environment?.tools ?? undefined;

/** The kinds whose check ends in `configured`: the configuration is written and parsed here, the connection is made at the client. */
export const CONNECTION_KINDS: readonly Component["kind"][] = ["mcp", "plugin", "lsp"];

/** The status a finished check gives a component. `null` is not a pass: what could not be checked is not delivered. */
export function statusAfter(c: Pick<Component, "kind">, v: ComponentValidation): ComponentStatus {
  if (v.passed !== true) return "failed";
  return CONNECTION_KINDS.includes(c.kind) ? "configured" : "verified";
}

/* ── hooks ─────────────────────────────────────────────────────────── */

type HookEvent = Record<string, unknown>;

function runHook(file: string, event: HookEvent, cwd: string): { code: number; stderr: string; stdout: string } {
  const r = spawnSync(process.execPath, [file], { input: JSON.stringify({ cwd, session_id: "dcc-verify", ...event }), cwd, encoding: "utf8", timeout: 60_000, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } });
  return { code: r.status ?? -1, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
}

/** A path the hook must refuse and one it must allow, from the component's own parameters. */
function forbiddenAndAllowed(params: Record<string, unknown>): { forbidden: string; allowed: string } {
  const paths = Array.isArray(params.paths) ? (params.paths as string[]) : [];
  const first = paths[0] ?? "generated";
  const forbidden = first.includes("*") ? first.replace(/\*\*?\/?/g, "x/") : first.endsWith("/") ? `${first}file.txt` : /\.[a-z0-9]+$/i.test(first) ? first : `${first}/file.txt`;
  return { forbidden, allowed: "README-dcc-verify-allowed.md" };
}

/** The event each hook template is registered under, and a tool its matcher must catch. */
const HOOK_ROUTE: Record<string, { event: string; tool?: string }> = {
  "block-paths": { event: "PreToolUse", tool: "Edit" },
  "block-commands": { event: "PreToolUse", tool: "Bash" },
  "secret-scan": { event: "PreToolUse", tool: "Write" },
  "build-gate": { event: "Stop" },
  "post-format": { event: "PostToolUse", tool: "Edit" },
  "post-validate": { event: "PostToolUse", tool: "Edit" },
};

function matcherCatches(matcher: unknown, tool: string): boolean {
  if (typeof matcher !== "string" || !matcher || matcher === "*") return true;
  try { return new RegExp(`^(?:${matcher})$`).test(tool); } catch { return matcher.split("|").includes(tool); }
}

/** Does `.claude/settings.json` send the hook's event to this hook's command, with a matcher that catches the tool it guards? `null` when it does; otherwise what is missing. */
export function hookRouting(c: Component, dir: string): string | null {
  const file = c.files.find((f) => f.endsWith(".mjs"));
  if (!file) return "לא נכתב קובץ hook";
  const settings = path.join(dir, ".claude", "settings.json");
  if (!existsSync(settings)) return ".claude/settings.json לא נכתב — שום אירוע לא מגיע ל-hook";
  let json: { hooks?: Record<string, unknown> };
  try { json = JSON.parse(readFileSync(settings, "utf8")) as typeof json; } catch (e) { return `.claude/settings.json לא תקין: ${(e as Error).message.slice(0, 120)}`; }
  const route = HOOK_ROUTE[String(c.params.template ?? "")];
  const events = route ? [route.event] : Object.keys(json.hooks ?? {});
  const entries = events.flatMap((ev) => {
    const list = json.hooks?.[ev];
    return Array.isArray(list) ? (list as { matcher?: unknown; hooks?: unknown }[]).map((e) => ({ ev, e })) : [];
  });
  const routed = entries.filter(({ e }) => Array.isArray(e.hooks) && (e.hooks as { command?: unknown }[]).some((h) => typeof h.command === "string" && h.command.replace(/\\/g, "/").includes(file)));
  if (!routed.length) return `.claude/settings.json לא מפנה את ${route?.event ?? "שום אירוע"} ל-${file}`;
  if (route?.tool && !routed.some(({ e }) => matcherCatches(e.matcher, route.tool!))) return `ה-matcher של ${route.event} ב-.claude/settings.json לא תופס את ${route.tool}`;
  return null;
}

/** The hook run for real against a forbidden action — without the routing check (the build checks the routing once the shared settings are composed). */
export function runHookCheck(c: Component, dir: string): ComponentValidation {
  const file = c.files.find((f) => f.endsWith(".mjs"));
  if (!file) return result("הרצת ה-hook", false, "לא נכתב קובץ hook");
  const abs = path.join(dir, file);
  const template = String(c.params.template ?? "");
  const secret = "Password=Sup3rS3cretDccVerify1;";
  if (template === "block-paths") {
    const { forbidden, allowed } = forbiddenAndAllowed(c.params);
    const deny = runHook(abs, { tool_name: "Edit", tool_input: { file_path: path.join(dir, forbidden) } }, dir);
    const allow = runHook(abs, { tool_name: "Edit", tool_input: { file_path: path.join(dir, allowed) } }, dir);
    if (deny.code !== 2) return result(`ניסיון עריכה של ${forbidden}`, false, `ה-hook לא חסם (קוד ${deny.code})`);
    if (allow.code !== 0) return result(`ניסיון עריכה של ${forbidden}`, false, `ה-hook חסם גם קובץ מותר (${allowed}, קוד ${allow.code})`);
    return result(`ניסיון עריכה של ${forbidden}`, true, "נחסם; קובץ מותר עבר");
  }
  if (template === "block-commands") {
    const patterns = Array.isArray(c.params.patterns) ? (c.params.patterns as string[]) : [];
    const bad = patterns[0] ?? "forbidden";
    const deny = runHook(abs, { tool_name: "Bash", tool_input: { command: `${bad} -auto-approve` } }, dir);
    const allow = runHook(abs, { tool_name: "Bash", tool_input: { command: "ls" } }, dir);
    return deny.code === 2 && allow.code === 0 ? result(`הפקודה "${bad}"`, true, "נחסמה; ls עבר") : result(`הפקודה "${bad}"`, false, `חסימה: קוד ${deny.code}; ls: קוד ${allow.code}`);
  }
  if (template === "secret-scan") {
    const deny = runHook(abs, { tool_name: "Write", tool_input: { file_path: path.join(dir, "src/dcc-verify.ts"), content: `const c = "${secret}";` } }, dir);
    const clean = runHook(abs, { tool_name: "Write", tool_input: { file_path: path.join(dir, "src/dcc-verify.ts"), content: "const c = 1;" } }, dir);
    if (deny.code !== 2) return result("כתיבת מחרוזת חיבור מזויפת", false, `ה-hook לא חסם (קוד ${deny.code})`);
    if ((deny.stderr + deny.stdout).includes("Sup3rS3cretDccVerify1")) return result("כתיבת מחרוזת חיבור מזויפת", false, "ה-hook הדפיס את הסוד עצמו");
    if (clean.code !== 0) return result("כתיבת מחרוזת חיבור מזויפת", false, `ה-hook חסם גם תוכן נקי (קוד ${clean.code})`);
    if (c.params.allowTests === true) {
      const test = runHook(abs, { tool_name: "Write", tool_input: { file_path: path.join(dir, "tests/dcc-verify.test.ts"), content: `const c = "${secret}";` } }, dir);
      if (test.code !== 0) return result("כתיבת מחרוזת חיבור מזויפת", false, "ה-hook חסם קובץ בדיקה למרות ה-allowlist");
    }
    return result("כתיבת מחרוזת חיבור מזויפת", true, "נחסמה בלי להדפיס את הערך; תוכן נקי עבר");
  }
  if (template === "build-gate") {
    const again = runHook(abs, { hook_event_name: "Stop", stop_hook_active: true }, dir);
    return again.code === 0 ? result("Stop hook שכבר המשיך תור", true, "לא נכנס ללולאה; ה-build עצמו נבדק בסקריפט האימות") : result("Stop hook שכבר המשיך תור", false, `קוד ${again.code}`);
  }
  if (template === "post-format" || template === "post-validate") {
    const tmp = path.join(dir, "dcc-verify-format.txt");
    writeFileSync(tmp, "x\n");
    try {
      const r = runHook(abs, { tool_name: "Edit", tool_input: { file_path: tmp } }, dir);
      return result("הרצה על קובץ שנערך", r.code === 0 || r.code === 2, r.code === 0 ? "רץ" : r.code === 2 ? "רץ והחזיר שגיאה (כצפוי לקובץ לא תקין)" : `קוד ${r.code}: ${r.stderr.slice(0, 200)}`);
    } finally {
      rmSync(tmp, { force: true });
    }
  }
  const generic = runHook(abs, { tool_name: "Edit", tool_input: { file_path: path.join(dir, "README.md") } }, dir);
  return result("הרצה עם אירוע לדוגמה", generic.code === 0 || generic.code === 2, `קוד ${generic.code}`);
}

/** The hook run for real, then its route in `.claude/settings.json` — a hook nobody calls blocks nothing. */
export function validateHook(c: Component, dir: string): ComponentValidation {
  const run = runHookCheck(c, dir);
  return withRouting(run, c, dir);
}

/** A hook whose run passed still fails when the settings do not send its event to it. */
export function withRouting(run: ComponentValidation, c: Component, dir: string): ComponentValidation {
  if (run.passed !== true) return run;
  const problem = hookRouting(c, dir);
  return problem ? result(run.how, false, problem) : result(run.how, true, `${run.detail}; .claude/settings.json מפנה אליו`);
}

/* ── settings, permissions, plugins ───────────────────────────────── */

const RULE_SYNTAX = /^(Read|Edit|Write|MultiEdit|Bash|PowerShell|Glob|Grep|WebFetch|WebSearch|NotebookEdit|Task|mcp__[\w-]+)(\(.*\))?$/;

export function validateSettings(dir: string, c: Component): ComponentValidation {
  const file = path.join(dir, ".claude", "settings.json");
  if (!existsSync(file)) return result("פענוח .claude/settings.json", false, "הקובץ לא נכתב");
  let json: { permissions?: { deny?: unknown; allow?: unknown }; hooks?: unknown; enabledPlugins?: unknown };
  try { json = JSON.parse(readFileSync(file, "utf8")) as typeof json; } catch (e) { return result("פענוח .claude/settings.json", false, `JSON לא תקין: ${(e as Error).message.slice(0, 120)}`); }
  if (c.kind === "permission") {
    const deny = Array.isArray(json.permissions?.deny) ? (json.permissions!.deny as string[]) : [];
    const mine = Array.isArray(c.params.deny) ? (c.params.deny as string[]) : [];
    const bad = deny.filter((d) => !RULE_SYNTAX.test(d));
    if (bad.length) return result("פענוח .claude/settings.json", false, `כללים בתחביר לא מוכר: ${bad.slice(0, 3).join(", ")}`);
    const missing = mine.filter((m) => !deny.some((d) => d.includes(m.replace(/^\w+\(|\)$/g, ""))));
    return missing.length ? result("פענוח .claude/settings.json", false, `חסרים בקובץ: ${missing.slice(0, 3).join(", ")}`) : result("פענוח .claude/settings.json", true, `${deny.length} כללי deny, כולם בתחביר של Claude Code`);
  }
  if (c.kind === "plugin" || c.kind === "lsp") {
    const enabled = json.enabledPlugins && typeof json.enabledPlugins === "object" ? (json.enabledPlugins as Record<string, unknown>) : {};
    const key = typeof c.params.pluginKey === "string" ? c.params.pluginKey : null;
    if (key ? enabled[key] !== true : !Object.values(enabled).includes(true)) return result("פענוח .claude/settings.json", false, `${key ?? "ה-plugin"} לא רשום ב-enabledPlugins`);
    return result("פענוח .claude/settings.json", true, `${key ?? "ה-plugin"} רשום ב-enabledPlugins; Claude Code מתקין אותו בסשן הראשון אצל הלקוח`);
  }
  return result("פענוח .claude/settings.json", true, "תקין");
}

/* ── claims: the paths and commands a text names ──────────────────── */

/** The first word of a command a text tells Claude to run. */
const COMMAND_HEADS = new Set([
  "npm", "npx", "pnpm", "yarn", "bun", "node", "tsx", "deno", "tsc", "vitest", "jest", "eslint", "prettier", "biome",
  "dotnet", "msbuild", "vstest.console", "nuget", "csc", "pac", "sqlpackage", "func", "devenv",
  "python", "python3", "py", "pip", "pip3", "pytest", "uv", "poetry", "ruff", "black", "mypy", "tox",
  "go", "cargo", "rustc", "mvn", "mvnw", "gradle", "gradlew", "java", "javac", "make", "cmake", "composer", "php", "bundle", "rake", "ruby",
  "git", "gh", "az", "aws", "gcloud", "docker", "kubectl", "helm", "terraform", "pwsh", "powershell",
]);
/** The first word of a command that needs nothing beyond the repository's own tooling: git runs everything here, dotnet and npx are asked for by name. */
const ALWAYS_HERE = new Set(["git", "dotnet", "npx", "node"]);
/** A bare name is a file claim only with one of these extensions — `FakeXrmEasy.9` is a package, `console.log` a call. */
const FILE_EXT = new Set([
  "cs", "csproj", "sln", "slnx", "props", "targets", "vb", "vbproj", "fs", "fsproj", "nuspec", "config", "resx", "xaml", "cshtml", "razor", "snk", "pfx", "pem", "pubxml",
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonc", "md", "mdx", "yml", "yaml", "xml", "html", "htm", "css", "scss", "less", "svg", "png",
  "py", "pyi", "toml", "cfg", "ini", "txt", "lock", "sh", "bash", "ps1", "psm1", "cmd", "bat",
  "go", "mod", "rs", "java", "kt", "kts", "gradle", "groovy", "scala", "rb", "php", "swift", "c", "cc", "cpp", "hpp",
  "sql", "graphql", "proto", "tf", "tfvars", "hcl", "csv", "ipynb", "vue", "svelte",
]);
/** A missing `bin/` or `node_modules/` is build output, not a false claim. */
const OUTPUT_DIRS = new Set(["bin", "obj", "node_modules", "dist", "build", "out", "target", ".vs", "coverage", ".next", "__pycache__", ".venv", "venv", "testresults", ".pytest_cache", ".gradle"]);
const SHELL_FENCE = /^(sh|bash|shell|console|zsh|powershell|pwsh|ps1?|cmd|bat|bash-session|)$/i;
/** A clause that says not to, or that it is a person's to do — the thing it names is not an instruction for Claude to run here. */
const NEGATION = /\b(?:never|not|no|neither|nor|don't|doesn't|do not|cannot|can't|won't|avoid|instead of|rather than|without|unavailable|forbidden|isn't|aren't|a person|by hand|manually|human)\b|(?:^|[\s(])(?:לא|אל|אסור|בלי|אין|אף פעם|ידנית|אדם)(?=[\s,.:;)]|$)/i;

/** What a text's claims are checked against. */
export type ClaimContext = {
  /** The tools on this machine; a tool listed as null is known to be missing. Without it, the PATH decides. */
  tools?: HostTools;
  /** The file the text lives in, relative to the copy: a relative path or a script is looked up from its folder, then from the root. */
  file?: string;
};

export type ClaimResult = { checked: number; missing: string[]; /** Claims that were checked and hold — what makes a text specific to this repository. */ found: number };

const pathCache = new Map<string, boolean>();
function onPath(cmd: string): boolean {
  if (pathCache.has(cmd)) return pathCache.get(cmd)!;
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM;.PS1").split(";").filter(Boolean).map((e) => e.toLowerCase())] : [""];
  const found = dirs.some((d) => exts.some((e) => { try { return statSync(path.join(d, cmd + e)).isFile(); } catch { return false; } }));
  pathCache.set(cmd, found);
  return found;
}

/** Inside the copy, from the file's folder and then from the root; never above the copy. */
function existsFrom(dir: string, fromDir: string, rel: string): boolean {
  const clean = rel.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!clean) return false;
  for (const base of [...new Set([fromDir, "."])]) {
    const abs = path.resolve(dir, base, clean);
    const inside = path.relative(path.resolve(dir), abs);
    if (inside.startsWith("..") || path.isAbsolute(inside)) continue;
    if (existsSync(abs)) return true;
  }
  return false;
}

const SKIP_WALK = new Set([".git", "node_modules", "bin", "obj", "dist", ".vs", "target", "__pycache__", ".venv", "venv"]);

/** What is in the copy, walked once per text and only when a claim needs it: every folder and file (posix, relative; a folder ends in `/`). */
type RepoIndex = { paths: string[]; names: Set<string>; scripts: Record<string, string>[] };
function indexOf(dir: string): RepoIndex {
  const paths: string[] = [];
  const names = new Set<string>();
  const scripts: Record<string, string>[] = [];
  const stack = [""];
  while (stack.length && paths.length < 80_000) {
    const rel = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try { entries = readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_WALK.has(e.name.toLowerCase())) { paths.push(`${p}/`); stack.push(p); } continue; }
      paths.push(p);
      names.add(e.name.toLowerCase());
      if (e.name === "package.json") { try { scripts.push((JSON.parse(readFileSync(path.join(dir, p), "utf8")) as PackageJson).scripts ?? {}); } catch { /* not a claim's business */ } }
    }
  }
  return { paths, names, scripts };
}

/** The path a claim names, or null when the backticked text is not a path claim (a word, a package id, a MIME type, a glob). */
function pathClaim(raw: string, dir: string, fromDir: string): string | null {
  if (/^[a-z]+:\/\//i.test(raw) || raw.startsWith("@") || /[*<>{}$%\s|"'=,]/.test(raw)) return null;
  const p = (/^(\.\.\.[\\/])?[\w.@+-]+(\\[\w.@+-]+)+\\?$/.test(raw) ? raw.replace(/\\/g, "/") : raw).replace(/^\.\.\.\//, "");
  if (!/^[\w./@+-]+$/.test(p)) return null;
  if (/^(fix|task|project|feature|release|ai|claude|hotfix|origin)\/[\w.-]*$/i.test(p)) return null;
  const segs = p.replace(/^\.\//, "").replace(/^\/+/, "").split("/").filter(Boolean);
  if (!segs.length || (segs.includes("..") && !p.startsWith("../"))) return null;
  const last = segs.at(-1)!;
  const ext = last.match(/\.([a-z0-9]+)$/)?.[1];
  const hasExt = !!ext && FILE_EXT.has(ext) && !last.startsWith(".");
  if (segs.length === 1) return hasExt || (p.endsWith("/") && !last.startsWith(".")) ? p : null;
  if (hasExt || p.endsWith("/") || p.startsWith("./") || p.startsWith("../") || raw.startsWith("...")) return p;
  // Two words with a slash are a path only when the first one is here (`src/api`), not `application/json` or `owner/repo`.
  return existsFrom(dir, fromDir, segs[0]!) ? p : null;
}

/**
 * A path holds when it is there from the text's folder or from the root; a bare file name anywhere in the copy; a
 * path written from inside a project folder (`EBG/OptionSets.cs`, `Properties/x.json`) as the end of a real path.
 */
function pathHolds(p: string, dir: string, fromDir: string, index: () => RepoIndex): boolean {
  if (existsFrom(dir, fromDir, p)) return true;
  const segs = p.replace(/^\.\//, "").split("/").filter(Boolean);
  if (OUTPUT_DIRS.has(segs[0]!.toLowerCase())) return true;
  // A build output under a folder that exists (`Test/X/bin/Debug/X.dll`, `packages/a/dist/index.js`) is a real path once the
  // build ran — a clean copy cannot hold it, and the test command the diagnosis itself names points there.
  const outAt = segs.findIndex((s, i) => i > 0 && OUTPUT_DIRS.has(s.toLowerCase()));
  if (outAt > 0 && existsFrom(dir, fromDir, segs.slice(0, outAt).join("/"))) return true;
  if (p.startsWith("./") || p.startsWith("../")) return false;
  if (segs.length === 1 && !p.endsWith("/")) return index().names.has(segs[0]!.toLowerCase());
  const tail = `/${segs.join("/").toLowerCase()}${p.endsWith("/") ? "/" : ""}`;
  return index().paths.some((x) => `/${x.toLowerCase()}`.endsWith(tail));
}

const PACKAGE_RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const NOT_A_SCRIPT = new Set(["install", "i", "ci", "add", "remove", "rm", "uninstall", "exec", "dlx", "x", "why", "list", "ls", "init", "create", "upgrade", "up", "update", "outdated", "audit", "config", "link", "unlink", "publish", "pack", "store", "import", "dedupe", "rebuild", "workspace", "workspaces", "set", "info", "view", "global", "cache", "version", "help", "login", "logout", "whoami", "prune", "fund", "doctor", "explain", "query"]);
/** A tool a Node repository installs for itself (node_modules/.bin), known by the dependency that brings it. */
const NODE_LOCAL: Record<string, string> = { tsc: "typescript", vitest: "vitest", jest: "jest", eslint: "eslint", prettier: "prettier", biome: "@biomejs/biome", tsx: "tsx" };

/** The script a package-runner command runs — `npm run build`, `npm test`, `yarn lint` — or null for `npm install`, a flag, or a workspace we cannot resolve here. */
function scriptOf(toks: string[]): string | null {
  const [h, a, ...rest] = toks;
  if (!a || a.startsWith("-")) return null;
  if (a === "run" || a === "run-script") {
    if (rest.some((t) => /^(-w|--workspace|--workspaces|-ws|--filter|-F|--prefix|-C|--cwd)(=|$)/.test(t))) return null;
    return rest.find((t) => !t.startsWith("-")) ?? null;
  }
  if (h === "npm" || h === "bun") return ["test", "start", "stop", "restart"].includes(a) ? a : null;
  return NOT_A_SCRIPT.has(a) ? null : a;
}

type PackageJson = { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
/** The package.json files from the folder up to the root of the copy, nearest first — the runner reads the nearest; binaries resolve up the tree. */
function packagesUp(dir: string, fromDir: string): PackageJson[] {
  const out: PackageJson[] = [];
  const root = path.resolve(dir);
  let cur = path.resolve(dir, fromDir);
  if (!cur.startsWith(root)) cur = root;
  for (;;) {
    const pkg = path.join(cur, "package.json");
    if (existsSync(pkg)) { try { out.push(JSON.parse(readFileSync(pkg, "utf8")) as PackageJson); } catch { out.push({}); } }
    if (cur === root) return out;
    cur = path.dirname(cur);
  }
}

function lookupTool(tools: HostTools | undefined, name: string): string | null | undefined {
  if (!tools) return undefined;
  const want = name.toLowerCase().replace(/_/g, " ");
  for (const [k, v] of Object.entries(tools)) if (k.toLowerCase().replace(/_/g, " ") === want) return v;
  return undefined;
}

/** Where a command is said to run: a folder of the copy; or anywhere (`cd Pcf/<name>`, or a root text naming a sub-package's script). */
type Cwd = { dir: string; strict: boolean } | null;

/** A script of the repository's own run by its path — `./gradlew build`, `.\build.ps1` — not a relative path named in passing (`../../packages`). */
const scriptByPath = (toks: readonly string[]) => /^\.[\\/][\w.-]+([\\/][\w.-]+)*$/.test(toks[0] ?? "") && (toks.length > 1 || /\.(sh|ps1|cmd|bat|exe|py|mjs|js)$/i.test(toks[0]!) || /(^|[\\/])(gradlew|mvnw)$/i.test(toks[0]!));

/** One command (no `&&`): is it runnable here, from the folder it is said to run in? */
function commandHolds(toks: string[], dir: string, cwd: Cwd, ctx: ClaimContext, index: () => RepoIndex): boolean {
  const raw = toks[0]!;
  const from = cwd?.dir ?? ".";
  if (scriptByPath(toks)) {
    const known = lookupTool(ctx.tools, raw.replace(/^\.[\\/]/, "").replace(/\.(exe|cmd|bat)$/i, ""));
    return known === null ? false : existsFrom(dir, from, raw.replace(/\\/g, "/"));
  }
  const head = raw.toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
  const second = (toks[1] ?? "").toLowerCase();
  // What the diagnosis found on this machine decides first: `dotnet msbuild` is its own entry, then `dotnet`.
  const pair = second && !second.startsWith("-") ? lookupTool(ctx.tools, `${head} ${second}`) : undefined;
  const known = pair !== undefined ? pair : lookupTool(ctx.tools, head);
  // A tool this machine lacks is still the repository's own when its manifests say so: `cargo test` is true of a Cargo
  // workspace whether or not cargo is installed here (the first research round rejected every line of a Rust
  // repository, AGENTS.md included, on a machine without cargo). Only a command whose toolchain the repository does not
  // have is a false claim. Whether it can run *here* is the honesty line's business, not the claim's.
  if (known === null) return repoToolchainHas(head, index);
  if (PACKAGE_RUNNERS.has(head)) {
    const script = scriptOf([head, ...toks.slice(1)]);
    if (script && !/[<>{}]/.test(script)) {
      // `npm run build|lint` names several; a folder's own instructions mean its own package.json, a root text any package here.
      const wanted = script.split("|").filter(Boolean);
      const nearest = cwd ? packagesUp(dir, cwd.dir)[0]?.scripts : undefined;
      const has = (sc: Record<string, string> | undefined) => !!sc && wanted.every((w) => w in sc);
      if (!has(nearest) && (cwd?.strict || !index().scripts.some(has))) return false;
    }
  }
  if (head === "node" || head === "tsx" || head === "python" || head === "python3" || (head === "npx" && second === "tsx")) {
    const f = toks.slice(head === "npx" ? 2 : 1).find((t) => !t.startsWith("-"));
    if (f && !/[<>{}]/.test(f) && /[\\/]|\.(m?[jt]s|cjs|py)$/i.test(f) && !existsFrom(dir, from, f.replace(/\\/g, "/"))) return false;
  }
  if (known !== undefined) return true;
  if (ALWAYS_HERE.has(head)) return true;
  const dep = NODE_LOCAL[head];
  if (dep && (packagesUp(dir, from).some((p) => !!(p.dependencies?.[dep] ?? p.devDependencies?.[dep])) || existsSync(path.join(dir, "node_modules", ".bin", head)))) return true;
  return onPath(head);
}

/** The manifests that make a tool the repository's own toolchain — what the copy carries, not what this machine has. */
const TOOLCHAIN_MANIFESTS: Record<string, RegExp> = {
  cargo: /(^|\/)cargo\.toml$/i, rustc: /(^|\/)cargo\.toml$/i,
  go: /(^|\/)go\.mod$/i,
  mvn: /(^|\/)pom\.xml$/i, mvnw: /(^|\/)pom\.xml$/i, gradle: /(^|\/)(build|settings)\.gradle(\.kts)?$/i, gradlew: /(^|\/)(build|settings)\.gradle(\.kts)?$/i,
  java: /(^|\/)(pom\.xml|(build|settings)\.gradle(\.kts)?)$/i, javac: /(^|\/)(pom\.xml|(build|settings)\.gradle(\.kts)?)$/i,
  python: /(^|\/)(pyproject\.toml|setup\.py|setup\.cfg|requirements[^/]*\.txt|pytest\.ini|tox\.ini)$/i, python3: /(^|\/)(pyproject\.toml|setup\.py|setup\.cfg|requirements[^/]*\.txt)$/i, py: /(^|\/)(pyproject\.toml|setup\.py|setup\.cfg|requirements[^/]*\.txt)$/i,
  pip: /(^|\/)(pyproject\.toml|setup\.py|setup\.cfg|requirements[^/]*\.txt)$/i, pip3: /(^|\/)(pyproject\.toml|setup\.py|requirements[^/]*\.txt)$/i, pytest: /(^|\/)(pyproject\.toml|pytest\.ini|tox\.ini|setup\.cfg|conftest\.py)$/i,
  uv: /(^|\/)(pyproject\.toml|uv\.lock)$/i, poetry: /(^|\/)(pyproject\.toml|poetry\.lock)$/i, ruff: /(^|\/)(pyproject\.toml|ruff\.toml)$/i, black: /(^|\/)pyproject\.toml$/i, mypy: /(^|\/)(pyproject\.toml|mypy\.ini|setup\.cfg)$/i, tox: /(^|\/)(tox\.ini|pyproject\.toml)$/i,
  dotnet: /\.(sln|csproj|fsproj|vbproj|props)$/i, msbuild: /\.(sln|csproj|fsproj|vbproj|proj)$/i, "vstest.console": /\.(sln|csproj)$/i, nuget: /(^|\/)(packages\.config|nuget\.config)$|\.csproj$/i, csc: /\.csproj$/i,
  pac: /\.(pcfproj|cdsproj)$/i, sqlpackage: /\.sqlproj$/i, func: /(^|\/)host\.json$/i,
  make: /(^|\/)(gnu)?makefile$/i, cmake: /(^|\/)cmakelists\.txt$/i,
  composer: /(^|\/)composer\.json$/i, php: /(^|\/)composer\.json$/i, bundle: /(^|\/)gemfile$/i, rake: /(^|\/)(gemfile|rakefile)$/i, ruby: /(^|\/)gemfile$/i,
  docker: /(^|\/)(dockerfile|docker-compose[^/]*\.ya?ml|compose\.ya?ml)$/i, terraform: /\.tf$/i,
};
function repoToolchainHas(head: string, index: () => RepoIndex): boolean {
  const re = TOOLCHAIN_MANIFESTS[head];
  if (!re) return false;
  return index().paths.some((p) => re.test(p));
}

/** A text in a folder of its own (`Pcf/CLAUDE.md`) speaks from that folder; one at the root, in `.claude/` or `docs/` speaks for the whole repository. */
const speaksFromItsFolder = (file: string | undefined) => !!file && /(^|\/)(CLAUDE|AGENTS)\.md$/i.test(file) && file.includes("/");

/** The commands of one backticked text or one line of a shell block: `cd Pcf && npm run build` is `cd` then a command run from `Pcf`. Null when it names no command. */
function commandClaim(text: string, dir: string, ctx: ClaimContext, index: () => RepoIndex): boolean | null {
  const parts = text.replace(/^\$\s+/, "").split(/\s*(?:&&|\|\||;)\s*/).filter(Boolean);
  const fromDir = ctx.file ? path.posix.dirname(ctx.file.replace(/\\/g, "/")) : ".";
  let cwd: Cwd = { dir: fromDir, strict: speaksFromItsFolder(ctx.file) };
  if (!cwd.strict) cwd = null;
  let any = false;
  for (const part of parts) {
    const toks = part.split(/\s+/).filter(Boolean);
    while (toks.length > 1 && /^\w+=/.test(toks[0]!)) toks.shift(); // `CI=1 npm test`
    const head = (toks[0] ?? "").toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
    if (head === "cd" && toks[1]) {
      any = true;
      const to = toks[1].replace(/\\/g, "/");
      // `cd Pcf/<name>`: a folder chosen by the reader — nothing to check, and what follows runs in some folder of the copy.
      if (/[<>{}*$%]/.test(to)) { cwd = null; continue; }
      if (!existsFrom(dir, cwd?.dir ?? fromDir, to)) return false;
      const fromCwd = path.posix.join(cwd?.dir ?? fromDir, to);
      cwd = { dir: path.posix.normalize(existsSync(path.resolve(dir, fromCwd)) ? fromCwd : to), strict: true };
      continue;
    }
    if (!COMMAND_HEADS.has(head) && !scriptByPath(toks)) continue;
    any = true;
    if (!commandHolds(toks, dir, cwd, ctx, index)) return false;
  }
  return any ? true : null;
}

/** Is the claim at `index` of `text` said in the negative — "never edit `x`", "`msbuild` is not available here"? A negative mention is not a claim that the thing is there. */
function negated(text: string, index: number, length: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const end = text.indexOf("\n", index + length);
  const lineEnd = end < 0 ? text.length : end;
  const before = text.slice(lineStart, index).split(/[.!?;](?:\s|$)/).at(-1) ?? "";
  const after = (text.slice(index + length, lineEnd).split(/[.!?;](?:\s|$)/)[0] ?? "").slice(0, 40);
  return NEGATION.test(before) || NEGATION.test(after);
}

/**
 * Every path a text names in backticks must exist — from the text's own folder or from the root; a bare file name
 * anywhere in the copy; a path written from inside a project folder as the end of a real one. Every command it names,
 * inline or in a shell block, must be runnable on this machine: its first word a tool this machine has (`tools` from
 * the diagnosis, else the PATH), an `npm run <script>` a package.json has (a folder's own instructions: its own
 * package.json), a `node <file>` whose file exists. No tolerance: one missing claim fails the text. What the text says
 * in the negative ("never run `pac`", "a person registers it with `pac`") is not checked. An array in the third place
 * (the profile's commands, from earlier callers) is accepted and not needed: the machine decides what runs here.
 */
export function checkClaims(text: string, dir: string, ctxOrLegacy: ClaimContext | readonly string[] = {}): ClaimResult {
  const ctx: ClaimContext = Array.isArray(ctxOrLegacy) ? {} : (ctxOrLegacy as ClaimContext);
  const fromDir = ctx.file ? path.posix.dirname(ctx.file.replace(/\\/g, "/")) : ".";
  let built: RepoIndex | null = null;
  const index = () => (built ??= indexOf(dir));
  const missing: string[] = [];
  let checked = 0;
  let found = 0;
  const judge = (claim: string, holds: boolean | null) => {
    if (holds === null) return;
    checked++;
    if (holds) found++; else missing.push(claim);
  };
  // Shell blocks: each line is a command (the AGENTS.md template fences its Build/Test/Lint).
  const fenced: [number, number][] = [];
  for (const m of text.matchAll(/^([ \t]*)```([\w-]*)[^\n]*\n([\s\S]*?)^\1```[ \t]*$/gm)) {
    fenced.push([m.index, m.index + m[0].length]);
    if (!SHELL_FENCE.test(m[2] ?? "")) continue;
    for (const line of (m[3] ?? "").split("\n")) {
      const l = line.trim();
      if (!l || l.startsWith("#") || l.startsWith("//") || /^rem\s/i.test(l)) continue;
      judge(l, commandClaim(l.replace(/\s+#.*$/, ""), dir, ctx, index));
    }
  }
  const inFence = (i: number) => fenced.some(([a, b]) => i >= a && i < b);
  for (const m of text.matchAll(/`([^`\n]{2,200})`/g)) {
    if (inFence(m.index)) continue;
    const claim = m[1]!.trim();
    const neg = negated(text, m.index, m[0].length);
    const cmd = commandClaim(claim.replace(/\s+#.*$/, ""), dir, ctx, index);
    if (cmd !== null) { if (!neg) judge(claim, cmd); continue; }
    const p = pathClaim(claim, dir, fromDir);
    if (!p) continue;
    const holds = pathHolds(p, dir, fromDir, index);
    // "Never commit `.env.local`" names a thing that should not be there; a negative mention that holds still counts as specific.
    if (holds || !neg) judge(claim, holds);
  }
  return { checked, missing: [...new Set(missing)], found };
}

/* ── text kinds ────────────────────────────────────────────────────── */

export type VerifyContext = {
  tools?: HostTools;
  /** The text this build added to a file that existed before it — what a text's check reads, not what was already there. */
  appended?: ReadonlyMap<string, string>;
};

export function validateText(c: Component, dir: string, ctx: VerifyContext = {}): ComponentValidation {
  const how = "בדיקת טענות מול הקוד";
  // A rule line is judged on itself: the rest of AGENTS.md belongs to other cards.
  if (c.kind === "rule" && typeof c.params.text === "string" && c.params.text.trim()) {
    const r = checkClaims(c.params.text, dir, { tools: ctx.tools, file: "AGENTS.md" });
    if (r.missing.length) return result(how, false, `השורה מזכירה מה שאין כאן: ${r.missing.slice(0, 5).join(", ")}`);
    return result(how, true, r.checked ? `${r.checked} נתיבים ופקודות בשורה נבדקו, כולם קיימים` : "אין בשורה נתיב או פקודה שיכולים לסתור את הקוד");
  }
  const files = c.files.filter((f) => existsSync(path.join(dir, f)));
  if (!files.length) return result(how, false, "לא נכתב קובץ");
  let checked = 0;
  let found = 0;
  let prose = false;
  const missing: string[] = [];
  for (const f of files) {
    const text = ctx.appended?.get(f) ?? readFileSync(path.join(dir, f), "utf8");
    if (/\.(md|mdx|txt)$/i.test(f) && text.trim()) prose = true;
    const r = checkClaims(text, dir, { tools: ctx.tools, file: f });
    checked += r.checked;
    found += r.found;
    missing.push(...r.missing);
  }
  const uniq = [...new Set(missing)];
  if (uniq.length) return result(how, false, `${checked} טענות נבדקו; לא קיים כאן: ${uniq.slice(0, 5).join(", ")}`);
  // Instructions that name nothing of this repository are generic: they cost context and teach nothing.
  if ((c.kind === "scaffold" || c.kind === "doc") && prose && found === 0) return result(how, false, "אין טענה שאפשר לבדוק: הטקסט לא מזכיר אף נתיב או פקודה שקיימים בריפו");
  return result(how, true, checked ? `${checked} נתיבים ופקודות נבדקו, כולם קיימים` : "קובץ מתבנית, בלי נתיב או פקודה לבדוק");
}

function frontmatter(text: string): Record<string, string> | null {
  const m = text.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) out[kv[1]!] = kv[2]!.trim();
  }
  return out;
}

const bodyOf = (text: string) => { const t = text.replace(/^﻿/, ""); return t.slice(t.indexOf("---", 3) + 3).replace(/^\r?\n/, "").trim(); };
/** Claude Code's names: lower-case letters, digits and hyphens. */
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function validateSkill(c: Component, dir: string, ctx: VerifyContext = {}): ComponentValidation {
  const how = "frontmatter וגוף ה-skill, נתיבים ופקודות מול הקוד";
  const file = c.files.find((f) => f.endsWith("SKILL.md"));
  if (!file || !existsSync(path.join(dir, file))) return result(how, false, "לא נכתב SKILL.md");
  const text = readFileSync(path.join(dir, file), "utf8");
  const fm = frontmatter(text);
  if (!fm) return result(how, false, "הקובץ לא נפתח ב-frontmatter (שורה ראשונה ---) — Claude Code לא יטען אותו");
  if (!fm.name || !fm.description) return result(how, false, "חסר name או description — Claude Code לא יטען אותו");
  if (!NAME.test(fm.name)) return result(how, false, `השם "${fm.name}" לא בתחביר של Claude Code (אותיות קטנות, ספרות ומקפים)`);
  if (fm.description.length < 40) return result(how, false, "description קצר מדי כדי ש-Claude Code ידע מתי להפעיל אותו");
  const body = bodyOf(text);
  if (body.length < 200) return result(how, false, "הגוף קצר מדי (פחות מ-200 תווים)");
  const claims = checkClaims(body, dir, { tools: ctx.tools, file });
  if (claims.missing.length) return result(how, false, `לא קיים כאן: ${claims.missing.slice(0, 5).join(", ")}`);
  return result(how, true, `name, description ו-${body.length} תווים; ${claims.checked} נתיבים ופקודות נבדקו`);
}

export function validateAgent(c: Component, dir: string, ctx: VerifyContext = {}): ComponentValidation {
  const how = "frontmatter, כלים ורשימת בדיקה";
  const file = c.files.find((f) => /\.claude\/agents\/.+\.md$/.test(f));
  if (!file || !existsSync(path.join(dir, file))) return result(how, false, "לא נכתב קובץ סוכן");
  const text = readFileSync(path.join(dir, file), "utf8");
  const fm = frontmatter(text);
  if (!fm) return result(how, false, "הקובץ לא נפתח ב-frontmatter (שורה ראשונה ---) — Claude Code לא יטען אותו");
  if (!fm.name || !fm.description) return result(how, false, "חסר name או description");
  if (!NAME.test(fm.name)) return result(how, false, `השם "${fm.name}" לא בתחביר של Claude Code (אותיות קטנות, ספרות ומקפים)`);
  const tools = (fm.tools ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const writes = tools.filter((t) => /^(Edit|Write|MultiEdit)$/.test(t));
  if (writes.length) return result(how, false, `סוכן בודק עם כלי כתיבה (${writes.join(", ")}) — צריך להיות קריאה בלבד`);
  const body = bodyOf(text);
  // A checklist item is a bullet, a box or a numbered line: `- x`, `* [ ] x`, `1. x`, `2) x`.
  const checklist = (body.match(/^\s*(?:[-*]|\d+[.)])\s+\S/gm) ?? []).length;
  if (checklist < 3) return result(how, false, `רשימת הבדיקה קצרה מדי (${checklist} פריטים)`);
  const claims = checkClaims(body, dir, { tools: ctx.tools, file });
  if (claims.missing.length) return result(how, false, `לא קיים כאן: ${claims.missing.slice(0, 5).join(", ")}`);
  return result(how, true, `קריאה בלבד (${tools.join(", ") || "ברירת המחדל"}), ${checklist} פריטי בדיקה; ${claims.checked} נתיבים ופקודות נבדקו`);
}

/* ── connections ───────────────────────────────────────────────────── */

/** A server address with a slot to fill (`{org}`), or one the rule marked as not deliverable as it is — it cannot be written into `.mcp.json`. */
export const mcpPlaceholder = (c: Pick<Component, "params">): string | null => {
  const url = typeof c.params.url === "string" ? c.params.url : "";
  if (/\{[a-z_]+\}/i.test(url)) return url;
  return c.params.placeholder === true || c.params.deliverable === false ? url || String(c.params.server ?? c.params.name ?? "") : null;
};

export function validateMcp(c: Component, dir: string): ComponentValidation {
  const file = path.join(dir, ".mcp.json");
  if (!existsSync(file)) return result("פענוח .mcp.json", false, "הקובץ לא נכתב");
  let json: { mcpServers?: Record<string, { url?: string; command?: string }> };
  try { json = JSON.parse(readFileSync(file, "utf8")) as typeof json; } catch (e) { return result("פענוח .mcp.json", false, `JSON לא תקין: ${(e as Error).message.slice(0, 120)}`); }
  const name = String(c.params.server ?? c.params.name ?? "");
  if (!name) return result("פענוח .mcp.json", false, "לרכיב אין שם שרת");
  const entry = json.mcpServers?.[name];
  if (!entry) return result("פענוח .mcp.json", false, `השרת "${name}" לא נמצא בקובץ`);
  if (!entry.url && !entry.command) return result("פענוח .mcp.json", false, `לשרת "${name}" אין כתובת ואין פקודה`);
  if (entry.url && /\{[a-z_]+\}/i.test(entry.url)) return result("פענוח .mcp.json", false, `הכתובת עם מקום להשלמה (${entry.url}) — אסור שתיכתב כך`);
  return result("פענוח .mcp.json", true, `"${name}" רשום ותקין; החיבור עצמו נעשה בסשן הראשון עם ההרשאות של הלקוח`);
}

/* ── lines in a shared file ────────────────────────────────────────── */

export function validateFileLines(c: Component, dir: string, file: string): ComponentValidation {
  const abs = path.join(dir, file);
  if (!existsSync(abs)) return result(`הקובץ ${file}`, false, "לא נכתב");
  const text = readFileSync(abs, "utf8");
  const wanted = (Array.isArray(c.params.entries) ? c.params.entries : Array.isArray(c.params.paths) ? c.params.paths : []) as string[];
  const missing = wanted.filter((w) => !text.includes(w));
  return missing.length ? result(`הקובץ ${file}`, false, `חסרות שורות: ${missing.slice(0, 3).join(", ")}`) : result(`הקובץ ${file}`, true, `${wanted.length || "כל"} השורות נמצאות`);
}

function gitWorks(dir: string): boolean {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, encoding: "utf8", windowsHide: true, timeout: 20_000 });
  return r.status === 0 && r.stdout.trim() === "true";
}

/** A real file under a path of the card (a folder, `dir/**`, or the file itself), to ask git about. */
function fileUnder(dir: string, raw: string): string | null {
  const rel = raw.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/\*\*.*$/, "").replace(/\/+$/, "");
  if (!rel || rel.includes("*")) return null;
  const abs = path.join(dir, rel);
  if (!existsSync(abs)) return null;
  if (statSync(abs).isFile()) return rel;
  const stack = [rel];
  let guard = 0;
  while (stack.length && guard++ < 2000) {
    const d = stack.shift()!;
    let entries: import("node:fs").Dirent[];
    try { entries = readdirSync(path.join(dir, d), { withFileTypes: true }); } catch { continue; }
    const f = entries.find((e) => e.isFile());
    if (f) return `${d}/${f.name}`;
    for (const e of entries) if (e.isDirectory() && e.name !== ".git") stack.push(`${d}/${e.name}`);
  }
  return null;
}

/** `.gitattributes`: the lines are there, and git itself says they apply — `git check-attr` on a real file under each path. Without git, the lines. */
export function validateGitattributes(c: Component, dir: string): ComponentValidation {
  const lines = validateFileLines(c, dir, ".gitattributes");
  if (lines.passed !== true) return lines;
  if (!gitWorks(dir)) return result("הקובץ .gitattributes", true, `${lines.detail} (git לא זמין כאן — נבדקו השורות)`);
  const paths = (Array.isArray(c.params.paths) ? c.params.paths : Array.isArray(c.params.entries) ? c.params.entries : []) as string[];
  let asked = 0;
  for (const p of paths) {
    const f = fileUnder(dir, p);
    if (!f) continue;
    const r = spawnSync("git", ["check-attr", "linguist-generated", "--", f], { cwd: dir, encoding: "utf8", windowsHide: true, timeout: 20_000 });
    const value = (r.stdout ?? "").trim().split(": ").at(-1) ?? "";
    if (r.status !== 0 || !/^(true|set)$/.test(value)) return result("git check-attr", false, `השורה לא חלה על ${f} (linguist-generated: ${value || r.stderr.trim().slice(0, 80) || "?"})`);
    asked++;
  }
  return result(asked ? "git check-attr" : "הקובץ .gitattributes", true, asked ? `git מסמן ${asked} קבצים לדוגמה כמג'ונרטים` : `${lines.detail} (אין קובץ תחת הנתיבים לשאול עליו את git)`);
}

/* ── the local gate ────────────────────────────────────────────────── */

/** The local gate is run for real — that is the verification loop. A gate that cannot run here fails: what was not run is not delivered. */
/** A gate script builds the whole repository; a large .NET solution on a busy machine took more than 15 minutes in the Trade run. */
const SCRIPT_TIMEOUT_MS = 30 * 60_000;
export function validateScript(c: Component, dir: string): ComponentValidation {
  const file = c.files.find((f) => f.endsWith(".mjs") || f.endsWith(".sh"));
  if (!file) return result("הרצת הסקריפט", false, "לא נכתב");
  const r = spawnSync(process.execPath, [path.join(dir, file)], { cwd: dir, encoding: "utf8", timeout: SCRIPT_TIMEOUT_MS, env: { ...process.env, CI: "1" } });
  // Killed at the limit: the build did not finish here — said as that, not as a failed build.
  if (r.status === null && r.signal) return result("הרצת סקריפט האימות", false, `ה-build לא הסתיים תוך ${Math.round(SCRIPT_TIMEOUT_MS / 60_000)} דקות במכונה הזאת — הסקריפט לא אומת כאן; על מכונת פיתוח או על ה-runner הוא רץ בלי המגבלה`);
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const verdict = out.split("\n").reverse().find((l) => l.startsWith("VERIFY:")) ?? "";
  if (r.status === 0) return result("הרצת סקריפט האימות", true, verdict || "עבר");
  if (r.status === 3) return result("הרצת סקריפט האימות", false, `אי אפשר להריץ כאן: ${verdict || "הסקריפט יצא בקוד 3"}`);
  return result("הרצת סקריפט האימות", false, `${verdict || `קוד ${r.status}`}: ${out.trim().split("\n").slice(-3).join(" | ").slice(0, 300)}`);
}

/* ── one component ─────────────────────────────────────────────────── */

export function validateComponent(c: Component, dir: string, ctx: VerifyContext = {}): ComponentValidation {
  switch (c.kind) {
    case "hook": return validateHook(c, dir);
    case "permission": case "settings": return validateSettings(dir, c);
    case "plugin": case "lsp": return validateSettings(dir, c);
    case "gitignore": return validateFileLines(c, dir, ".gitignore");
    case "gitattributes": return validateGitattributes(c, dir);
    case "script": return validateScript(c, dir);
    case "skill": return validateSkill(c, dir, ctx);
    case "agent": return validateAgent(c, dir, ctx);
    case "mcp": return validateMcp(c, dir);
    case "rule": case "doc": case "scaffold": case "review": case "pr_template": case "devcontainer": return validateText(c, dir, ctx);
    case "runner": return result("—", null, "לא רכיב שמותקן: דרישה מהלקוח (ראו כרטיס הכנות)");
    case "report": return result("—", null, "דיווח, לא התקנה");
  }
}

/* ── the joint check over the whole set ───────────────────────────── */

const ALWAYS_LOADED = ["CLAUDE.md", "AGENTS.md"];

export function jointCheck(cards: readonly Component[], dir: string): { duplicates: string[]; contradictions: string[]; alwaysLoadedTokens: number } {
  const writers = new Map<string, string[]>();
  for (const c of cards) for (const f of c.files) writers.set(f, [...(writers.get(f) ?? []), c.key]);
  // Shared files (settings, AGENTS.md, .gitignore) are merged on purpose; a duplicate is two components owning one file of their own.
  const shared = /^(\.claude\/settings\.json|\.mcp\.json|AGENTS\.md|CLAUDE\.md|\.gitignore|\.gitattributes|package\.json)$/;
  const duplicates = [...writers].filter(([f, ks]) => ks.length > 1 && !shared.test(f)).map(([f, ks]) => `${f}: ${ks.join(", ")}`);
  const contradictions: string[] = [];
  const denied = cards.filter((c) => c.kind === "permission").flatMap((c) => (Array.isArray(c.params.deny) ? (c.params.deny as string[]) : []));
  for (const c of cards) {
    if (c.kind === "skill" || c.kind === "agent" || c.kind === "doc") for (const f of c.files) if (denied.some((d) => d.includes("Read(") && f.startsWith(d.replace(/^Read\(|\)$/g, "").replace(/\/\*\*$/, "")))) contradictions.push(`${c.key}: הקובץ ${f} נמצא תחת איסור קריאה (${c.kind} שאי אפשר לקרוא)`);
  }
  let chars = 0;
  for (const f of ALWAYS_LOADED) { const p = path.join(dir, f); if (existsSync(p)) chars += statSync(p).size; }
  const rulesDir = path.join(dir, ".claude", "rules");
  if (existsSync(rulesDir)) for (const f of readdirSync(rulesDir)) if (f.endsWith(".md")) chars += statSync(path.join(rulesDir, f)).size;
  // An MCP server loads its tools into every session once it is in .mcp.json; one that waits for the client's details is not there.
  const mcpTokens = cards.filter((c) => c.kind === "mcp" && (c.status === "verified" || c.status === "configured" || c.status === "installed") && c.files.includes(".mcp.json")).reduce((a, c) => a + (c.contextTokens ?? 0), 0);
  return { duplicates, contradictions, alwaysLoadedTokens: Math.round(chars / 4) + mcpTokens };
}

/** A scratch copy for tests of the validators, so nothing touches a real worktree. */
export const scratchDir = () => mkdtempSync(path.join(os.tmpdir(), "dcc-verify-"));
