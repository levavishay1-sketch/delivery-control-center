import { spawnSync } from "node:child_process";
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { RepoProfile } from "./types.ts";

/**
 * The deterministic diagnosis of a repository — the "diagnose" step of an
 * onboarding run: what is in the repository, read from its files and its git
 * history, with no model. It is a port of the research script
 * (`docs/research/sources/onboarding-v2/repos/diagnose.py`) that produced the
 * eleven stored diagnoses, kept detector for detector — the same tables, the
 * same regular expressions, the same thresholds and cut-offs, the same
 * ordering of every list — so those diagnoses stay valid fixtures for the
 * rules (`rules.ts`), which read the profile by path.
 *
 * What is deliberately different from the script:
 *  - symbolic links are neither followed nor listed;
 *  - a `packages/` directory is skipped only when it is a NuGet package cache
 *    (the script skipped it for one repository by name);
 *  - `size.bytes_on_disk_excl_git` is the sum of the walked files' sizes, not
 *    `du -sb`, which also counted the directories the walk skips;
 *  - the git log is read up to 3000 commits, so a long history stays quick;
 *  - the read limits are in bytes where the script counted characters — the
 *    same for ASCII, a little shorter for other text;
 *  - `docs.pr_template` and `docs.codeowners` are new;
 *  - no list is cut to a first few where a consumer needs all of it: the
 *    secret and sensitive files, the packages (up to 400, and then it says so);
 *  - facts the research did not have: the tools on this machine, the test
 *    projects git tracks, a single large generated file, the sub-packages'
 *    linters, the packages the root command does not build, where the model
 *    folders and the sibling units are (`layout`), and hot spots only from a
 *    history long enough to have them (20 commits).
 */

/* ── the tables ─────────────────────────────────────────────────── */

/** Never walked: dependency caches, build output and IDE state say nothing about the code. */
const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "target", "bin", "obj", ".pgdata",
  "vendor", ".venv", "venv", "__pycache__", ".next", ".turbo", "out", ".gradle",
  ".idea", ".vs", "coverage", "site-packages",
]);

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".jar", ".dll", ".exe",
  ".so", ".dylib", ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".mp3", ".webp", ".svg",
  ".nupkg", ".pdb", ".bin", ".class", ".pyc", ".wasm", ".lock", ".sum", ".snk", ".pfx",
  ".gz", ".tar", ".7z", ".rar", ".bmp", ".psd", ".xlsx", ".docx", ".pptx", ".msi", ".cab",
]);

const LANG_EXT: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript",
  ".cjs": "JavaScript", ".py": "Python", ".go": "Go", ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin",
  ".cs": "C#", ".vb": "VB.NET", ".php": "PHP", ".rb": "Ruby", ".rs": "Rust", ".tf": "HCL/Terraform",
  ".hcl": "HCL/Terraform", ".ipynb": "Jupyter", ".dart": "Dart", ".swift": "Swift", ".m": "Objective-C",
  ".sql": "SQL", ".sh": "Shell", ".ps1": "PowerShell", ".yaml": "YAML", ".yml": "YAML", ".json": "JSON",
  ".html": "HTML", ".css": "CSS", ".scss": "SCSS", ".xml": "XML", ".md": "Markdown", ".twig": "Twig",
  ".c": "C", ".cpp": "C++", ".h": "C/C++ header", ".proto": "Protobuf", ".tpl": "Helm template",
};
const CODE_LANGS = new Set([
  "TypeScript", "JavaScript", "Python", "Go", "Java", "Kotlin", "C#", "VB.NET", "PHP", "Ruby",
  "Rust", "HCL/Terraform", "Jupyter", "Dart", "Swift", "Objective-C", "C", "C++", "SQL", "Twig",
]);

/** How much of a file is read, in bytes: a manifest or document, the secrets scan, the generated-code header, the external-systems scan. */
const READ_LIMIT = 200_000;
const SECRETS_LIMIT = 400_000;
const HEADER_LIMIT = 1200;
const EXTERNAL_LIMIT = 300_000;
/** The git log is enough at 3000 commits to find hot files and change shapes; a full history of a large repository would take minutes. */
const LOG_MAX_COMMITS = 3000;

/** `tools` — where to look for the build and test tools (a test hands in its own PATH); this machine's by default. */
export type DiagnoseOptions = { git?: boolean; log?: (line: string) => void; tools?: ToolProbe };

/* ── small helpers ──────────────────────────────────────────────── */

type Counter<K> = Map<K, number>;
const inc = <K>(c: Counter<K>, k: K, by = 1) => c.set(k, (c.get(k) ?? 0) + by);
/** Python's `Counter.most_common(n)`: by count, descending; ties keep first-seen order (both sorts are stable). */
const mostCommon = <K>(c: Counter<K>, n = Infinity): [K, number][] => [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
/** `dict.fromkeys(list)` — the list without repeats, first occurrence kept. */
const unique = <T>(xs: T[]): T[] => [...new Set(xs)];
const addTo = <K, V>(m: Map<K, Set<V>>, k: K, v: V) => { const s = m.get(k); if (s) s.add(v); else m.set(k, new Set([v])); };

/** The extension as Python's `os.path.splitext` gives it: the leading dots of a name are not an extension (`.env` → "", `..foo` → "", `foo.` → "."). */
function extOf(p: string): string {
  const sep = p.lastIndexOf("/");
  const dot = p.lastIndexOf(".");
  if (dot <= sep) return "";
  for (let i = sep + 1; i < dot; i++) if (p[i] !== ".") return p.slice(dot);
  return "";
}
const dirOf = (p: string): string => { const i = p.lastIndexOf("/"); return i === -1 ? "" : p.slice(0, i); };
const baseOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
/** Python's `len()` of a string counts code points, not UTF-16 units. */
function codePoints(s: string): number {
  let n = s.length;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 0xdc00 && c <= 0xdfff) n--; }
  return n;
}
/** Every non-overlapping match of a global pattern, as `re.findall` counts them. */
function countMatches(rx: RegExp, text: string): number {
  let n = 0;
  rx.lastIndex = 0;
  for (let m = rx.exec(text); m; m = rx.exec(text)) { n++; if (m[0].length === 0) rx.lastIndex++; }
  return n;
}

const DECODER = new TextDecoder("utf-8", { ignoreBOM: true });
/** Bytes as text the way the script read files (`errors="ignore"`): what does not decode is dropped, not replaced. */
const decode = (buf: Uint8Array): string => DECODER.decode(buf).replace(/�/g, "");

/** Reads into `buf` until it is full or the file ends; returns how much was read. */
function fillFrom(fd: number, buf: Buffer): number {
  let n = 0;
  while (n < buf.length) {
    const got = readSync(fd, buf, n, buf.length - n, null);
    if (got <= 0) break;
    n += got;
  }
  return n;
}
const closeQuietly = (fd: number) => { try { closeSync(fd); } catch { /* already closed, or never open */ } };

/** The first `limit` bytes of a file as text; "" when it cannot be read — a diagnosis never fails on one file. */
function readText(abs: string, limit = READ_LIMIT): string {
  let fd: number;
  try { fd = openSync(abs, "r"); } catch { return ""; }
  try {
    const buf = Buffer.allocUnsafe(Math.min(limit, fstatSync(fd).size));
    return decode(buf.subarray(0, fillFrom(fd, buf)));
  } catch { return ""; } finally { closeQuietly(fd); }
}

/* ── the walk ───────────────────────────────────────────────────── */

type Tree = { root: string; files: string[]; relset: Set<string>; bytes: Map<string, number> };

/** A `packages/` directory that holds NuGet package caches: `*.nupkg` files, or `<Id>.<version>/` folders with a `lib/` or a `.nupkg` inside. An npm monorepo's `packages/` holds real code and is walked. */
function isNuGetPackageCache(dir: string): boolean {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  const isNupkg = (name: string) => name.toLowerCase().endsWith(".nupkg");
  for (const e of entries) {
    if (e.isFile() && isNupkg(e.name)) return true;
    if (!e.isDirectory() || !/\.\d+(\.\d+)+(-[0-9A-Za-z.-]+)?$/.test(e.name)) continue;
    let inner;
    try { inner = readdirSync(path.join(dir, e.name), { withFileTypes: true }); } catch { continue; }
    if (inner.some((i) => i.isFile() && isNupkg(i.name))) return true;
    if (inner.some((i) => i.isDirectory() && i.name === "lib") && !inner.some((i) => i.name === "package.json")) return true;
  }
  return false;
}

/** Every regular file under `root`, as sorted relative paths with forward slashes, the way the script's `os.walk` + `files.sort()` listed them. */
function walkTree(root: string): Tree {
  const files: string[] = [];
  const bytes = new Map<string, number>();
  const visit = (rel: string) => {
    const abs = rel ? path.join(root, rel) : root;
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (e.name === "packages" && isNuGetPackageCache(path.join(abs, e.name))) continue;
        visit(childRel);
      } else if (e.isFile()) {
        let size: number;
        try { size = lstatSync(path.join(abs, e.name)).size; } catch { continue; }
        files.push(childRel);
        bytes.set(childRel, size);
      }
    }
  };
  visit("");
  files.sort();
  return { root, files, relset: new Set(files), bytes };
}

const exists = (t: Tree, ...names: string[]) => names.filter((n) => t.relset.has(n));
const anyGlob = (t: Tree, rx: RegExp) => t.files.filter((f) => rx.test(f));
const read = (t: Tree, rel: string, limit = READ_LIMIT) => readText(path.join(t.root, rel), limit);

/* ── one read per file: lines, generated headers, secrets ───────── */

/**
 * The script read a code file three times — to count its lines, to look at its
 * header, to scan it for secrets. One read serves all three: the head of the
 * file is kept for the text checks, the rest is only counted.
 */
type ContentScan = {
  langFiles: Counter<string>; langLines: Counter<string>; totalLines: number;
  headerHits: string[]; headerLines: Map<string, number>;
  secretsByKind: Counter<string>; secretFiles: Counter<string>; secretsInTests: number;
  /** Code files of 30–200 lines with a comment in words — candidates for a small, safe edit. */
  smallCommented: string[];
};

/** Newlines in a buffer; a last line without one still counts, as iterating a Python file does. */
function countLines(buf: Buffer, len: number): number {
  const v = buf.subarray(0, len);
  let n = 0;
  for (let i = v.indexOf(0x0a); i !== -1; i = v.indexOf(0x0a, i + 1)) n++;
  return n;
}

function scanFile(abs: string, keep: number, wantLines: boolean, chunk: Buffer): { head: Buffer; lines: number } {
  const nothing = { head: Buffer.alloc(0), lines: 0 };
  let fd: number;
  try { fd = openSync(abs, "r"); } catch { return nothing; }
  try {
    const head = Buffer.allocUnsafe(Math.min(keep, fstatSync(fd).size));
    const n = fillFrom(fd, head);
    let lines = 0;
    if (wantLines) {
      lines = countLines(head, n);
      let last = n > 0 ? head[n - 1] : -1;
      if (n === head.length) {
        for (let got = readSync(fd, chunk, 0, chunk.length, null); got > 0; got = readSync(fd, chunk, 0, chunk.length, null)) {
          lines += countLines(chunk, got);
          last = chunk[got - 1] ?? last;
        }
      }
      if (last !== -1 && last !== 0x0a) lines++;
    }
    return { head: head.subarray(0, n), lines };
  } catch { return nothing; } finally { closeQuietly(fd); }
}

/** A comment with a word in it, the way each language writes one; C-style `//` and `/*` for the rest. */
const COMMENT_HASH = /^\s*#(?!!)\s*[A-Za-z]{3,}/m;
const COMMENT_SLASH = /^\s*(\/\/|\/\*)[\s*/]*[A-Za-z]{3,}/m;
const COMMENT_BY_LANG: Record<string, RegExp | null> = {
  Python: COMMENT_HASH, Ruby: COMMENT_HASH, "HCL/Terraform": COMMENT_HASH, SQL: /^\s*--\s*[A-Za-z]{3,}/m, "VB.NET": /^\s*'\s*[A-Za-z]{3,}/m,
  Jupyter: null, Twig: null,
};
const hasComment = (lang: string, text: string): boolean => {
  const rx = Object.hasOwn(COMMENT_BY_LANG, lang) ? COMMENT_BY_LANG[lang] : COMMENT_SLASH;
  return !!rx && rx.test(text);
};

const GENERATED_HEADER = /(auto-?generated|automatically generated|do not edit|generated by|<auto-generated|code generated .* do not edit|This file was generated|DO NOT MODIFY)/i;

const SECRET_PATTERNS: [string, RegExp][] = [
  ["aws_access_key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["private_key_block", /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g],
  ["connection_string_with_password", /(Password|Pwd)=[^;\s"']{3,};/gi],
  ["connection_string_uri_with_creds", /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp|mssql|sqlserver):\/\/[^/\s:]+:[^@\s]{3,}@/gi],
  ["password_assignment", /\b(password|passwd|secret|client_secret|api[_-]?key|token)\b\s*[:=]\s*["'][^"'\s${<]{8,}["']/gi],
  ["github_token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ["slack_token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ["stripe_key", /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}\b/g],
  ["openai_key", /\bsk-[A-Za-z0-9]{32,}\b/g],
  ["azure_sas_or_storage_key", /(AccountKey=[A-Za-z0-9+/=]{40,}|sig=[A-Za-z0-9%]{30,})/gi],
  ["jwt", /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g],
];
/** A password-looking hit on a line that says it is a placeholder is not a secret. Only these three kinds are that ambiguous. */
const PLACEHOLDER_KINDS = new Set(["password_assignment", "connection_string_with_password", "connection_string_uri_with_creds"]);
const PLACEHOLDER = /(changethis|example|placeholder|your[_-]?|xxx|dummy|<.*>|\$\{|%s|password123|secret123|\*\*\*|redacted|fake|sample|test)/i;
const TEST_PATH_FOR_SECRETS = /(^|\/)(tests?|__tests__|spec|fixtures?|testdata|snapshots)(\/|$)|[._-](test|spec|tests)\.[a-z]+$|_test\.(go|rs|py)$|Tests?\.(cs|java|kt|php)$|test_[^/]+\.py$/i;

function scanSecrets(f: string, text: string, s: ContentScan) {
  const isTest = TEST_PATH_FOR_SECRETS.test(f);
  for (const [kind, rx] of SECRET_PATTERNS) {
    for (const m of text.matchAll(rx)) {
      if (PLACEHOLDER_KINDS.has(kind)) {
        const start = Math.max(0, text.lastIndexOf("\n", m.index - 1));
        const nl = text.indexOf("\n", m.index + m[0].length);
        if (PLACEHOLDER.test(text.slice(start, nl === -1 ? text.length : nl))) continue;
      }
      inc(s.secretsByKind, kind);
      inc(s.secretFiles, f);
      if (isTest) s.secretsInTests++;
    }
  }
}

function scanContents(t: Tree): ContentScan {
  const s: ContentScan = { langFiles: new Map(), langLines: new Map(), totalLines: 0, headerHits: [], headerLines: new Map(), secretsByKind: new Map(), secretFiles: new Map(), secretsInTests: 0, smallCommented: [] };
  const chunk = Buffer.allocUnsafe(1 << 20);
  for (const f of t.files) {
    const ext = extOf(f).toLowerCase();
    if (BINARY_EXT.has(ext)) continue;
    const lang = LANG_EXT[ext];
    if (lang !== undefined) inc(s.langFiles, lang);
    const isCode = lang !== undefined && CODE_LANGS.has(lang);
    const forSecrets = !(f.endsWith(".md") || f.endsWith(".lock") || f.endsWith(".sum"));
    if (!isCode && !forSecrets) continue;
    const file = scanFile(path.join(t.root, f), forSecrets ? SECRETS_LIMIT : HEADER_LIMIT, isCode, chunk);
    if (isCode) { inc(s.langLines, lang, file.lines); s.totalLines += file.lines; }
    if (file.head.length === 0) continue;
    const text = decode(file.head);
    if (isCode && GENERATED_HEADER.test(text.slice(0, HEADER_LIMIT))) { s.headerHits.push(f); s.headerLines.set(f, file.lines); }
    else if (isCode && file.lines >= 30 && file.lines <= 200 && !GENERATED_PATH.test(f) && !TEST_PATH.test(f) && hasComment(lang, text)) s.smallCommented.push(f);
    if (forSecrets && text) scanSecrets(f, text, s);
  }
  return s;
}

/* ── languages ──────────────────────────────────────────────────── */

const languages = (s: ContentScan): RepoProfile["languages"] =>
  mostCommon(s.langFiles, 8).map(([language, files]) => ({ language, files, lines: s.langLines.get(language) ?? 0 }));

/* ── manifests: frameworks, package managers, build, tests, lint ── */

type Stack = {
  frameworks: Set<string>; packageManagers: Set<string>; build: RepoProfile["build"]; tests: RepoProfile["tests"]; lint: string[];
  /** The root package.json: null when there is none, `{}` when it does not parse — the script told the two apart. */
  rootPkg: Record<string, unknown> | null;
  slns: string[]; csprojs: string[];
  /** Projects importing Microsoft.WebApplication.targets. */
  webApps: number;
  /** The node package manager the root lock file names (npm when none does). */
  pm: string;
};

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}
const objectAt = (o: Record<string, unknown>, key: string): Record<string, unknown> => {
  const v = o[key];
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
};
/** `{**dependencies, **devDependencies}` — only membership is ever asked. */
const depNames = (pkg: Record<string, unknown>) => new Set([...Object.keys(objectAt(pkg, "dependencies")), ...Object.keys(objectAt(pkg, "devDependencies"))]);

const NODE_FRAMEWORKS = ["react", "next", "vue", "@angular/core", "svelte", "express", "fastify", "electron", "vite", "esbuild", "webpack", "turbo", "nx", "vitest", "jest", "mocha", "playwright", "@playwright/test", "cypress", "eslint", "prettier", "biome", "@biomejs/biome", "typescript", "react-native", "expo", "tailwindcss", "storybook"];
const SUB_PACKAGE_FRAMEWORKS = ["react", "next", "vue", "@angular/core", "svelte", "express", "fastify", "electron", "vite", "vitest", "jest", "mocha", "@playwright/test", "cypress", "react-native", "expo", "tailwindcss", "@tauri-apps/api", "ink"];
const PY_FRAMEWORKS = ["fastapi", "django", "flask", "sqlmodel", "sqlalchemy", "pydantic", "celery", "starlette", "torch", "tensorflow", "scikit-learn", "sklearn", "pandas", "numpy", "jupyter", "notebook", "streamlit"];
const SUB_PACKAGE_LINTERS = ["eslint", "prettier", "@biomejs/biome", "stylelint", "tslint"];
/** `a, b, c, d +3` — the first few of a list and how many more. */
const shortList = (xs: string[], n = 4) => `${xs.slice(0, n).join(", ")}${xs.length > n ? ` +${xs.length - n}` : ""}`;
const DOTNET_PACKAGES = ["Microsoft.AspNetCore", "Aspire", "xunit", "NUnit", "MSTest", "Microsoft.PowerPlatform.Dataverse.Client", "Microsoft.CrmSdk", "Microsoft.Xrm", "EntityFramework", "Microsoft.EntityFrameworkCore", "Dapper", "Moq", "FakeXrmEasy"];

function detectStack(t: Tree): Stack {
  const frameworks = new Set<string>();
  const packageManagers = new Set<string>();
  const build: RepoProfile["build"] = { system: [], commands: [] };
  const tests: RepoProfile["tests"] = { frameworks: [], test_files: 0, test_dirs: [] };
  const lint: string[] = [];
  const addBuild = (system: string, cmd?: string) => {
    if (!build.system.includes(system)) build.system.push(system);
    if (cmd && !build.commands.includes(cmd)) build.commands.push(cmd);
  };
  const slashes = (f: string) => f.split("/").length - 1;

  // Node
  const rootPkg = t.relset.has("package.json") ? (parseObject(read(t, "package.json")) ?? {}) : null;
  if (rootPkg !== null) {
    const deps = depNames(rootPkg);
    const scripts = objectAt(rootPkg, "scripts");
    for (const k of NODE_FRAMEWORKS) if (deps.has(k)) frameworks.add(k);
    if (t.relset.has("pnpm-lock.yaml")) packageManagers.add("pnpm");
    if (t.relset.has("yarn.lock")) packageManagers.add("yarn");
    if (t.relset.has("package-lock.json")) packageManagers.add("npm");
    if (t.relset.has("bun.lockb") || t.relset.has("bun.lock")) packageManagers.add("bun");
    const pm = packageManagers.has("pnpm") ? "pnpm" : packageManagers.has("yarn") ? "yarn" : packageManagers.has("bun") ? "bun" : "npm";
    addBuild("package.json scripts");
    for (const s of ["build", "compile", "package"]) if (s in scripts) { addBuild("package.json scripts", `${pm} run ${s}   # -> ${String(scripts[s]).slice(0, 80)}`); break; }
    for (const s of ["test", "test:unit", "test:ci"]) if (s in scripts) { tests.frameworks.push(`package.json:${s} -> ${String(scripts[s]).slice(0, 80)}`); break; }
    for (const k of ["vitest", "jest", "mocha", "@playwright/test", "playwright", "cypress"]) if (deps.has(k) && !tests.frameworks.includes(k)) tests.frameworks.push(k);
    for (const k of ["eslint", "prettier", "biome", "@biomejs/biome"]) if (deps.has(k)) lint.push(k);
  }
  const subPkgDeps = new Set<string>();
  // A linter only some sub-packages have is still a linter in the repository (PCF controls ship ESLint; the root has none).
  const subLint = new Map<string, string[]>();
  for (const pj of t.files.filter((f) => f.endsWith("package.json") && slashes(f) >= 1 && slashes(f) <= 3)) {
    const d = parseObject(read(t, pj));
    if (!d) continue;
    const deps = depNames(d);
    for (const k of deps) subPkgDeps.add(k);
    const linters = SUB_PACKAGE_LINTERS.filter((k) => deps.has(k));
    if (!linters.length && typeof objectAt(d, "scripts").lint === "string") linters.push("lint script");
    for (const l of linters) subLint.set(l, [...(subLint.get(l) ?? []), dirOf(pj)]);
  }
  for (const k of SUB_PACKAGE_FRAMEWORKS) if (subPkgDeps.has(k)) frameworks.add(`${k} (sub-package)`);
  if (exists(t, "turbo.json").length) { frameworks.add("turborepo"); addBuild("turborepo"); }
  if (exists(t, "nx.json").length) frameworks.add("nx");
  if (exists(t, "lerna.json").length) frameworks.add("lerna");

  // Python
  const pyManifests = exists(t, "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "environment.yml");
  const subPy = t.files.filter((f) => f.endsWith("pyproject.toml") && slashes(f) === 1);
  for (const m of [...pyManifests, ...subPy]) {
    const txt = read(t, m).toLowerCase();
    for (const k of PY_FRAMEWORKS) if (txt.includes(k)) frameworks.add(k);
    if (txt.includes("pytest") && !tests.frameworks.includes("pytest")) tests.frameworks.push("pytest");
    if (txt.includes("unittest") && !tests.frameworks.includes("unittest")) tests.frameworks.push("unittest");
    for (const k of ["ruff", "black", "flake8", "mypy", "isort", "pylint"]) if (txt.includes(k) && !lint.includes(k)) lint.push(k);
    if (txt.includes("[tool.uv]") || t.relset.has("uv.lock")) packageManagers.add("uv");
    if (txt.includes("[tool.poetry]") || t.relset.has("poetry.lock")) packageManagers.add("poetry");
    if (m.endsWith("requirements.txt") || m.endsWith("setup.py")) packageManagers.add("pip");
    if (m.endsWith("environment.yml")) packageManagers.add("conda");
    if (txt.includes("hatchling")) addBuild("hatch");
    if (txt.includes("setuptools")) addBuild("setuptools");
  }
  if (pyManifests.length || subPy.length) addBuild("python packaging");
  if (t.relset.has("uv.lock")) packageManagers.add("uv");

  // Go
  if (exists(t, "go.mod").length) {
    packageManagers.add("go modules");
    addBuild("go", "go build ./...");
    tests.frameworks.push("go test");
    const gm = read(t, "go.mod");
    for (const k of ["github.com/spf13/cobra", "github.com/gin-gonic/gin", "net/http", "github.com/labstack/echo", "google.golang.org/grpc"]) if (gm.includes(k)) frameworks.add(baseOf(k));
    if (exists(t, "Makefile").length) addBuild("make");
    if (exists(t, ".golangci.yml", ".golangci.yaml", ".golangci.toml").length) lint.push("golangci-lint");
  }

  // Java / Kotlin
  if (exists(t, "pom.xml").length) {
    packageManagers.add("maven");
    addBuild("maven", exists(t, "mvnw").length ? "./mvnw package" : "mvn package");
    const pom = read(t, "pom.xml");
    if (pom.includes("spring-boot")) frameworks.add("spring-boot");
    if (pom.includes("junit")) tests.frameworks.push("junit");
    for (const k of ["checkstyle", "spotless", "spring-javaformat"]) if (pom.includes(k)) lint.push(k);
  }
  if (exists(t, "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts").length) {
    packageManagers.add("gradle");
    addBuild("gradle", exists(t, "gradlew").length ? "./gradlew build" : "gradle build");
    const g = exists(t, "build.gradle", "build.gradle.kts", "settings.gradle.kts", "gradle/libs.versions.toml").map((x) => read(t, x)).join(" ");
    const gl = g.toLowerCase();
    if (g.includes("com.android") || gl.includes("android")) frameworks.add("android");
    if (gl.includes("androidx.compose")) frameworks.add("jetpack-compose");
    if (gl.includes("hilt")) frameworks.add("hilt");
    if (gl.includes("junit")) tests.frameworks.push("junit");
    if (gl.includes("spotless")) lint.push("spotless");
    if (gl.includes("detekt")) lint.push("detekt");
    if (gl.includes("ktlint")) lint.push("ktlint");
    if (gl.includes("roborazzi")) tests.frameworks.push("roborazzi-screenshot");
  }

  // .NET
  let webApps = 0;
  const slns = anyGlob(t, /\.(sln|slnx|slnf)$/);
  const csprojs = anyGlob(t, /\.(csproj|vbproj|fsproj)$/);
  if (slns.length || csprojs.length) {
    packageManagers.add("nuget");
    frameworks.add(".NET");
    const tfms: Counter<string> = new Map();
    const pkgs = new Set<string>();
    for (const c of [...csprojs.slice(0, 400), ...anyGlob(t, /packages\.config$/).slice(0, 400)]) {
      const x = read(t, c);
      if (/Microsoft\.WebApplication\.targets|349c5851-65df-11da-9384-00065b846f21/i.test(x) && !c.endsWith("packages.config")) webApps++;
      for (const m of x.matchAll(/<package id="([^"]+)"/g)) pkgs.add(m[1] ?? "");
      for (const m of x.matchAll(/<TargetFrameworks?>([^<]+)</g)) inc(tfms, (m[1] ?? "").trim());
      for (const m of x.matchAll(/PackageReference Include="([^"]+)"/g)) pkgs.add(m[1] ?? "");
      if (x.includes("ToolsVersion") && x.includes("<TargetFrameworkVersion>")) {
        for (const m of x.matchAll(/<TargetFrameworkVersion>([^<]+)</g)) inc(tfms, `netframework ${m[1] ?? ""}`);
      }
    }
    build.dotnet_target_frameworks = Object.fromEntries(mostCommon(tfms, 10));
    const legacy = [...tfms.keys()].some((k) => k.startsWith("netframework") || k.startsWith("v4"));
    if (legacy) {
      frameworks.add(".NET Framework (legacy, msbuild)");
      addBuild("msbuild", `${["msbuild", slns[0], "/t:Build"].filter(Boolean).join(" ")}   # requires Windows / Visual Studio build tools`);
    } else {
      addBuild("dotnet", `dotnet build ${slns[0] ?? ""}`.trim());
    }
    for (const k of DOTNET_PACKAGES) if ([...pkgs].some((p) => p.toLowerCase().includes(k.toLowerCase()))) frameworks.add(k);
    for (const k of ["xunit", "NUnit", "MSTest"]) if (frameworks.has(k)) tests.frameworks.push(k);
    if (exists(t, ".editorconfig").length) lint.push("editorconfig");
    if (exists(t, "Directory.Build.props").length) addBuild("Directory.Build.props");
  }

  // PHP
  if (exists(t, "composer.json").length) {
    packageManagers.add("composer");
    addBuild("composer", "composer install");
    const cj = read(t, "composer.json");
    if (cj.includes("phpunit")) tests.frameworks.push("phpunit");
    for (const k of ["phpstan", "psalm", "squizlabs/php_codesniffer", "php-cs-fixer"]) if (cj.includes(k)) lint.push(k);
    for (const k of ["twig/twig", "symfony", "laravel", "slim"]) if (cj.includes(k)) frameworks.add(k);
  }
  if (anyGlob(t, /jquery[^/]*\.js$/).length) frameworks.add("jQuery (vendored)");
  if (rootPkg && Object.keys(rootPkg).length && depNames(rootPkg).has("jquery")) frameworks.add("jquery");

  // Rust
  if (exists(t, "Cargo.toml").length) {
    packageManagers.add("cargo");
    addBuild("cargo", "cargo build");
    tests.frameworks.push("cargo test");
    if (exists(t, "codex-rs/Cargo.toml").length) addBuild("cargo", "cargo build (in codex-rs/)");
  }
  const subCargo = t.files.filter((f) => f.endsWith("Cargo.toml") && slashes(f) === 1);
  if (subCargo.length && !packageManagers.has("cargo")) {
    packageManagers.add("cargo");
    addBuild("cargo", `cargo build   # in ${dirOf(subCargo[0] ?? "")}/`);
    tests.frameworks.push("cargo test");
    if (exists(t, "rust-toolchain.toml").length || anyGlob(t, /rust-toolchain/).length) lint.push("rustfmt/clippy (toolchain pinned)");
  }

  // Terraform / Helm
  if (anyGlob(t, /\.tf$/).length) {
    frameworks.add("terraform");
    addBuild("terraform", "terraform init && terraform validate   # no compile; plan needs cloud creds");
    if (exists(t, ".pre-commit-config.yaml").length) lint.push("pre-commit");
    const pc = read(t, ".pre-commit-config.yaml");
    for (const k of ["terraform_fmt", "terraform_validate", "terraform_docs", "tflint", "terraform_tfsec", "trivy", "checkov"]) if (pc.includes(k)) lint.push(k);
    if (anyGlob(t, /\.tftest\.hcl$/).length) tests.frameworks.push("terraform test");
    const ex = anyGlob(t, /^examples\/[^/]+\/main\.tf$/);
    if (ex.length) tests.frameworks.push(`examples/ as integration checks (${ex.length})`);
  }
  if (anyGlob(t, /(^|\/)Chart\.yaml$/).length) frameworks.add("helm");

  // Flutter / React Native / mobile
  if (exists(t, "pubspec.yaml").length) { frameworks.add("flutter/dart"); packageManagers.add("pub"); }
  if (anyGlob(t, /^(android|ios)\//).length && rootPkg !== null) frameworks.add("react-native-shell");
  if (anyGlob(t, /AndroidManifest\.xml$/).length) frameworks.add("android-manifest");
  if (anyGlob(t, /\.xcodeproj\//).length) frameworks.add("xcode");

  // Dynamics / PCF
  if (anyGlob(t, /ControlManifest\.Input\.xml$/).length) frameworks.add("PowerApps PCF control");

  // Jupyter
  const nbs = anyGlob(t, /\.ipynb$/);
  if (nbs.length) frameworks.add(`jupyter notebooks (${nbs.length})`);

  for (const [l, dirs] of subLint) if (!lint.includes(l) && !(l === "@biomejs/biome" && lint.includes("biome"))) lint.push(`${l} (packages: ${shortList(dirs)})`);
  const pm = packageManagers.has("pnpm") ? "pnpm" : packageManagers.has("yarn") ? "yarn" : packageManagers.has("bun") ? "bun" : "npm";
  return { frameworks, packageManagers, build, tests, lint, rootPkg, slns, csprojs, webApps, pm };
}

/* ── tests count ────────────────────────────────────────────────── */

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|e2e|src\/test|Test|Tests)(\/|$)|[._-](test|spec|tests)\.[a-z]+$|_test\.go$|Tests?\.(cs|java|kt|php)$|test_[^/]+\.py$/;

function countTests(t: Tree, tests: RepoProfile["tests"]) {
  const isCodeFile = (f: string) => { const lang = LANG_EXT[extOf(f).toLowerCase()]; return lang !== undefined && CODE_LANGS.has(lang); };
  const testFiles = t.files.filter((f) => TEST_PATH.test(f) && isCodeFile(f));
  tests.test_files = testFiles.length;
  const dirs: Counter<string> = new Map();
  for (const f of testFiles) inc(dirs, f.includes("/") ? (f.split("/")[0] ?? ".") : ".");
  tests.test_dirs = mostCommon(dirs, 6).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  tests.frameworks = unique(tests.frameworks);
}

/* ── test projects git tracks ───────────────────────────────────── */

/** A .NET project is a test project when it references a test framework, or its name ends in Test / Tests (`Foo.Tests`, `IntegrationTests` — not `ParserTester`). */
const TEST_FRAMEWORK_REF = /(MSTest\.TestFramework|MSTest\.TestAdapter|Microsoft\.VisualStudio\.QualityTools\.UnitTestFramework|\bxunit\b|\bnunit\b|Microsoft\.NET\.Test\.Sdk|3AC096D0-A1C2-E12C-1390-A8335801FDAB)/i;
const TEST_PROJECT_NAME = /(Tests?|[._-]tests?)$/;
const JS_TEST_FILE = /(^|\/)__tests__\/.+\.[cm]?[jt]sx?$|[._](test|spec)\.[cm]?[jt]sx?$/;
const PY_TEST_FILE = /(^|\/)test_[^/]+\.py$|_test\.py$/;
const NO_TEST_SCRIPT = /no test specified/;

/** `dir/file`, or `file` at the root (`dir` is "" there). */
const at = (dir: string, file: string) => (dir ? `${dir}/${file}` : file);
/** A path with a space is quoted for the shell. */
const q = (p: string) => (/\s/.test(p) ? `"${p}"` : p);
/** The nearest folder from `dir` up to the root (inclusive) for which `has` holds; "" is the root, null when none does. */
function nearest(dir: string, has: (d: string) => boolean): string | null {
  for (let d = dir; ; d = dirOf(d)) {
    if (has(d)) return d;
    if (!d) return null;
  }
}
/** A package manager's "run this script in that folder", from the root. */
const inFolder = (pm: string, dir: string, script: string) =>
  pm === "pnpm" ? `pnpm --dir ${q(dir)} ${script}` : pm === "yarn" ? `yarn --cwd ${q(dir)} ${script}` : `npm --prefix ${q(dir)} ${script}`;

/**
 * The test projects — only files git tracks count, so a test project that
 * exists on one person's disk is not evidence — and one command for each,
 * runnable from the repository root.
 */
function testProjects(t: Tree, kept: readonly string[], keptSet: ReadonlySet<string>, stack: Stack): { projects: string[]; commands: string[] } {
  const projects = new Set<string>();
  const commands: string[] = [];
  const cmd = (c: string) => { if (!commands.includes(c)) commands.push(c); };
  const add = (d: string) => projects.add(d || ".");

  // .NET: SDK-style projects run under `dotnet test`; a legacy one is built by the solution and its DLL handed to vstest.
  for (const f of kept.filter((x) => /\.(csproj|vbproj|fsproj)$/i.test(x))) {
    const x = read(t, f);
    const stem = baseOf(f).replace(/\.[^.]+$/, "");
    if (!TEST_FRAMEWORK_REF.test(x) && !TEST_PROJECT_NAME.test(stem)) continue;
    add(dirOf(f));
    if (/<Project[^>]*\sSdk\s*=/i.test(x)) cmd(`dotnet test ${q(f)}`);
    else cmd(`vstest.console ${q(at(dirOf(f), `bin/Debug/${/<AssemblyName>([^<]+)</.exec(x)?.[1]?.trim() || stem}.dll`))}`);
  }

  // JavaScript / TypeScript: the package whose package.json is nearest to the test files.
  const rootTest = typeof objectAt(stack.rootPkg ?? {}, "scripts").test === "string" && !NO_TEST_SCRIPT.test(String(objectAt(stack.rootPkg ?? {}, "scripts").test));
  const jsDirs = new Set<string>();
  for (const f of kept) {
    if (!JS_TEST_FILE.test(f)) continue;
    const d = nearest(dirOf(f), (x) => keptSet.has(at(x, "package.json")));
    if (d !== null) jsDirs.add(d);
  }
  for (const d of [...jsDirs].sort()) {
    add(d);
    const scripts = d ? objectAt(parseObject(read(t, at(d, "package.json"))) ?? {}, "scripts") : objectAt(stack.rootPkg ?? {}, "scripts");
    const own = typeof scripts.test === "string" && !NO_TEST_SCRIPT.test(scripts.test);
    if (own) cmd(d ? inFolder(stack.pm, d, "test") : `${stack.pm} test`);
    else if (rootTest) cmd(`${stack.pm} test`);
  }

  // Python: the folder of the nearest project manifest; a test_*.py with no Python project around it (a template, a sample) is not a project.
  const pyManifest = (d: string) => ["pyproject.toml", "setup.py", "setup.cfg", "pytest.ini", "tox.ini", "requirements.txt", "Pipfile"].some((m) => keptSet.has(at(d, m)));
  const pytest = stack.tests.frameworks.includes("pytest") || kept.some((f) => /(^|\/)(conftest\.py|pytest\.ini)$/.test(f));
  const pyDirs = new Set<string>();
  for (const f of kept) {
    if (!PY_TEST_FILE.test(f)) continue;
    const d = nearest(dirOf(f), pyManifest);
    if (d !== null) pyDirs.add(d);
  }
  for (const d of [...pyDirs].sort()) {
    add(d);
    cmd(pytest ? `python -m pytest${d ? ` ${q(d)}` : ""}` : `python -m unittest discover${d ? ` -s ${q(d)}` : ""}`);
  }

  // Go: the module (go.mod) the _test.go files belong to.
  const goDirs = new Set<string>();
  for (const f of kept) {
    if (!f.endsWith("_test.go")) continue;
    const d = nearest(dirOf(f), (x) => keptSet.has(at(x, "go.mod")));
    if (d !== null) goDirs.add(d);
  }
  for (const d of [...goDirs].sort()) { add(d); cmd(d ? `cd ${q(d)} && go test ./...` : "go test ./..."); }

  // Java / Kotlin: a module with src/test/, run by the root build.
  const jvm = new Set<string>();
  for (const f of kept) {
    const i = f.indexOf("src/test/");
    if (i === 0 || (i > 0 && f[i - 1] === "/")) jvm.add(f.slice(0, Math.max(0, i - 1)));
  }
  if (jvm.size) {
    for (const d of [...jvm].sort()) add(d);
    const gradle = exists(t, "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts").length > 0;
    if (gradle) cmd(t.relset.has("gradlew") ? "./gradlew test" : "gradle test");
    else if (t.relset.has("pom.xml")) cmd(t.relset.has("mvnw") ? "./mvnw test" : "mvn test");
  }

  // Rust: integration tests under a crate's tests/.
  const crates = new Set<string>();
  for (const f of kept) {
    if (!/(^|\/)tests\/[^/]+\.rs$/.test(f)) continue;
    const d = nearest(dirOf(f), (x) => keptSet.has(at(x, "Cargo.toml")));
    if (d !== null) crates.add(d);
  }
  for (const d of [...crates].sort()) { add(d); cmd(d && !t.relset.has("Cargo.toml") ? `cargo test --manifest-path ${q(at(d, "Cargo.toml"))}` : "cargo test"); }

  return { projects: [...projects].sort(), commands };
}

/* ── lint / format config files ─────────────────────────────────── */

const LINT_CONFIGS = [
  ".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.cjs", "eslint.config.js", "eslint.config.mjs", "eslint.config.ts",
  ".prettierrc", ".prettierrc.json", "prettier.config.js", "biome.json", "biome.jsonc", ".editorconfig", "ruff.toml", ".flake8",
  "mypy.ini", ".pre-commit-config.yaml", "phpstan.neon", "phpstan.neon.dist", "psalm.xml", "phpcs.xml", "phpcs.xml.dist",
  ".php-cs-fixer.dist.php", ".golangci.yml", "rustfmt.toml", ".rustfmt.toml", "clippy.toml", "detekt.yml", "checkstyle.xml",
  ".stylelintrc", ".stylelintrc.json", "stylelint.config.js",
];
const lintFormat = (t: Tree, lint: string[]): string[] => unique([...lint, ...LINT_CONFIGS.filter((c) => t.relset.has(c))]);

/* ── CI ─────────────────────────────────────────────────────────── */

const CI_COMMAND = /\b(test|build|lint|check|vet|verify|mvnw|gradlew|dotnet|pytest|npm|pnpm|yarn|cargo|go |make|composer|phpunit|terraform|pre-commit|ruff|mypy|tsc|vitest|jest|playwright)\b/;

/**
 * A `run:` line of a workflow as a command worth repeating: not a comment, not an environment line
 * (`. $HOME/.cargo/env`, `export`, `source`), not a line that depends on the workflow's matrix
 * (`${{ matrix.target }}`), and not one the 100-character cut left hanging on `-` or `/`
 * (the tokio run wrote `valgrind … ./target/debug/` into AGENTS.md).
 */
export function cleanCiCommand(raw: string): string | null {
  const cmd = raw.trim().replace(/\s+/g, " ");
  if (!cmd || /^(#|\.\s|source\s|export\s|set\s|echo\s|cd\s|if\s|fi$|then$|else$|done$|do$)/.test(cmd)) return null;
  if (/\$\{\{/.test(cmd)) return null;
  const cut = cmd.slice(0, 100);
  if (cut.length < cmd.length && /[-/\\|,:]$|\s-\S*$/.test(cut)) return null;
  return cut;
}

/** The linters and formatters a CI runs — a repository without a lint config file can still lint on every push. */
const CI_LINTERS: [RegExp, string][] = [
  [/\bcargo\s+fmt\b/, "rustfmt"], [/\bcargo\s+clippy\b/, "clippy"], [/\bcargo\s+deny\b/, "cargo-deny"],
  [/\beslint\b/, "eslint"], [/\bprettier\b/, "prettier"], [/\bbiome\b/, "biome"], [/\btsc\b.*--noEmit/, "tsc --noEmit"],
  [/\bruff\b/, "ruff"], [/\bblack\b/, "black"], [/\bflake8\b/, "flake8"], [/\bmypy\b/, "mypy"], [/\bpylint\b/, "pylint"], [/\bisort\b/, "isort"],
  [/\bgolangci-lint\b/, "golangci-lint"], [/\bgo\s+vet\b/, "go vet"], [/\bgofmt\b/, "gofmt"], [/\bstaticcheck\b/, "staticcheck"],
  [/\bdotnet\s+format\b/, "dotnet format"], [/\bktlint\b/, "ktlint"], [/\bdetekt\b/, "detekt"], [/\bcheckstyle\b/, "checkstyle"], [/\bspotless\b/, "spotless"],
  [/\brubocop\b/, "rubocop"], [/\bphpcs\b/, "phpcs"], [/\bphp-cs-fixer\b/, "php-cs-fixer"], [/\bpre-commit\b/, "pre-commit"], [/\bshellcheck\b/, "shellcheck"],
];
export function lintersFromCi(commands: readonly string[]): string[] {
  const out = new Set<string>();
  for (const c of commands) for (const [re, name] of CI_LINTERS) if (re.test(c)) out.add(`${name} (CI)`);
  return [...out];
}
const CI_FILES: [string, string][] = [
  [".gitlab-ci.yml", "gitlab-ci"], ["azure-pipelines.yml", "azure-pipelines"], ["Jenkinsfile", "jenkins"],
  [".circleci/config.yml", "circleci"], [".travis.yml", "travis"], ["bitbucket-pipelines.yml", "bitbucket"],
];

function detectCi(t: Tree): RepoProfile["ci"] {
  const ci: RepoProfile["ci"] = { present: false, systems: [], workflows: [], commands: [] };
  const wf = t.files.filter((f) => f.startsWith(".github/workflows/") && (f.endsWith(".yml") || f.endsWith(".yaml")));
  if (wf.length) {
    ci.present = true;
    ci.systems.push("github-actions");
    const cmds: Counter<string> = new Map();
    for (const w of wf) {
      const x = read(t, w);
      const name = /^name:\s*(.+)$/m.exec(x);
      ci.workflows.push({ file: w, name: name ? (name[1] ?? "").trim().replace(/^["']+|["']+$/g, "") : baseOf(w) });
      for (const m of x.matchAll(/^\s*(?:-\s*)?run:\s*\|?\s*(.+)$/gm)) {
        const cmd = cleanCiCommand((m[1] ?? "").trim());
        if (cmd && CI_COMMAND.test(cmd)) inc(cmds, cmd);
      }
    }
    ci.commands = mostCommon(cmds, 15).map(([c]) => c);
    ci.workflow_count = wf.length;
  }
  for (const [file, system] of CI_FILES) if (t.relset.has(file)) { ci.present = true; ci.systems.push(system); }
  const azp = anyGlob(t, /azure-pipelines.*\.ya?ml$|(^|\/)\.azure(-pipelines|devops)\//);
  if (azp.length && !ci.systems.includes("azure-pipelines")) {
    ci.present = true;
    ci.systems.push("azure-pipelines");
    ci.workflows.push(...azp.slice(0, 5).map((file) => ({ file })));
  }
  return ci;
}

/* ── monorepo ───────────────────────────────────────────────────── */

function detectMonorepo(t: Tree, stack: Stack): RepoProfile["monorepo"] {
  const mono: RepoProfile["monorepo"] = { is_monorepo: false, workspaces: [], packages: [] };
  const slashes = (f: string) => f.split("/").length - 1;
  const ws = stack.rootPkg && Object.keys(stack.rootPkg).length ? stack.rootPkg.workspaces : undefined;
  if (ws) {
    const list = Array.isArray(ws) ? ws : ws !== null && typeof ws === "object" && Array.isArray((ws as { packages?: unknown }).packages) ? ((ws as { packages: unknown[] }).packages) : [ws];
    mono.is_monorepo = true;
    mono.workspaces = list;
  }
  if (t.relset.has("pnpm-workspace.yaml")) { mono.is_monorepo = true; mono.workspaces.push("pnpm-workspace.yaml"); }
  if (exists(t, "turbo.json", "nx.json", "lerna.json").length) mono.is_monorepo = true;
  const cargoWs = t.files.filter((f) => f.endsWith("Cargo.toml") && read(t, f).includes("[workspace]"));
  if (cargoWs.length) { mono.is_monorepo = true; mono.workspaces.push(`cargo workspace: ${cargoWs[0]}`); }
  if (stack.slns.length > 1 || stack.csprojs.length > 8) {
    mono.is_monorepo = true;
    mono.workspaces.push(`${stack.csprojs.length} .NET projects in ${stack.slns.length} solution(s)`);
  }
  const gradleSubs = t.files.filter((f) => (f.endsWith("build.gradle.kts") || f.endsWith("build.gradle")) && slashes(f) >= 1);
  if (gradleSubs.length > 5) { mono.is_monorepo = true; mono.workspaces.push(`${gradleSubs.length} gradle modules`); }
  if (mono.is_monorepo) {
    const manifests = ["package.json", "Cargo.toml", "pyproject.toml", "build.gradle.kts", ".csproj", "go.mod"];
    const pkgs: Counter<string> = new Map();
    const kinds = new Set<string>();
    for (const f of t.files) {
      const m = manifests.find((x) => f.endsWith(x));
      if (!m || slashes(f) < 1 || slashes(f) > 3) continue;
      inc(pkgs, dirOf(f));
      kinds.add(m === ".csproj" ? "*.csproj" : m);
    }
    const all = [...pkgs.keys()].sort();
    mono.packages = all.slice(0, PACKAGES_CAP);
    mono.package_count = pkgs.size;
    mono.packages_truncated = all.length > PACKAGES_CAP;
    mono.manifest_kinds = [...kinds].sort();
    mono.own_commands = ownCommands(t, stack, all);
  }
  return mono;
}

/** Enough for any repository seen so far (Trade: 67, codex: 164); past it the list says it was cut. */
const PACKAGES_CAP = 400;

/** A workspace glob (`packages/*`, `apps/**`) as a test on a folder path. */
function workspaceGlob(glob: string): RegExp {
  let src = "";
  const g = glob.replace(/^\.\//, "").replace(/\/+$/, "");
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === "*") { if (g[i + 1] === "*") { src += ".*"; i++; } else src += "[^/]+"; }
    else src += c.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  }
  return new RegExp(`^${src}$`);
}

/**
 * The packages the root command does not build, each with the command it
 * needs, run from its own folder. A workspace member is built by the root, a
 * .NET project by the solution, a crate by the cargo workspace, a gradle
 * module by the root settings — those are left out, so an empty list means
 * one command builds everything.
 */
function ownCommands(t: Tree, stack: Stack, dirs: readonly string[]): { dir: string; build: string | null; test: string | null }[] {
  const out: { dir: string; build: string | null; test: string | null }[] = [];
  const ws: string[] = [];
  const rootWs = stack.rootPkg?.workspaces;
  const wsList = Array.isArray(rootWs) ? rootWs : rootWs && typeof rootWs === "object" && Array.isArray((rootWs as { packages?: unknown }).packages) ? (rootWs as { packages: unknown[] }).packages : [];
  for (const w of wsList) if (typeof w === "string" && !w.startsWith("!")) ws.push(w);
  if (t.relset.has("pnpm-workspace.yaml")) for (const m of read(t, "pnpm-workspace.yaml").matchAll(/^\s*-\s*["']?([^"'\s#]+)["']?/gm)) if (!(m[1] ?? "").startsWith("!")) ws.push(m[1] ?? "");
  const inWorkspace = (d: string) => ws.some((w) => workspaceGlob(w).test(d));
  const dotnetDirs = new Set(stack.csprojs.map(dirOf));
  const cargoWs = t.relset.has("Cargo.toml") && read(t, "Cargo.toml").includes("[workspace]");
  const rootGradle = exists(t, "settings.gradle", "settings.gradle.kts").length > 0;
  for (const dir of dirs) {
    const has = (f: string) => t.relset.has(`${dir}/${f}`);
    if (has("package.json")) {
      if (inWorkspace(dir)) continue;
      const scripts = objectAt(parseObject(read(t, `${dir}/package.json`)) ?? {}, "scripts");
      const build = typeof scripts.build === "string" ? `${stack.pm} run build` : null;
      const test = typeof scripts.test === "string" && !NO_TEST_SCRIPT.test(scripts.test) ? `${stack.pm} test` : null;
      if (build || test) out.push({ dir, build, test });
    } else if (dotnetDirs.has(dir)) {
      if (!stack.slns.length) out.push({ dir, build: "dotnet build", test: null });
    } else if (has("Cargo.toml")) {
      if (!cargoWs) out.push({ dir, build: "cargo build", test: "cargo test" });
    } else if (has("go.mod")) {
      out.push({ dir, build: "go build ./...", test: "go test ./..." });
    } else if (has("pyproject.toml")) {
      if (!t.relset.has("pyproject.toml")) out.push({ dir, build: null, test: "python -m pytest" });
    } else if (has("build.gradle.kts") && !rootGradle) {
      out.push({ dir, build: "gradle build", test: "gradle test" });
    }
  }
  return out;
}

/* ── generated code ─────────────────────────────────────────────── */

const GENERATED_PATH = /(__generated__|\.g\.cs$|\.pb\.go$|\.pb\.cc$|_pb2\.py$|\.generated\.|\.designer\.cs$|\.Designer\.cs$|\/generated\/|\/gen\/|\.min\.js$|\.min\.css$|_generated\.|\.d\.ts$|\/dist\/|\.snap$|Reference\.cs$|\/migrations?\/.*\.cs$|\.tf\.json$|\.xrm\.cs$|\/Model\/.*Entities\.cs$)/;

/** One generated file this long is a fact on its own — a folder with two such files is not needed to see it. */
const LARGE_GENERATED_LINES = 2000;

function generatedCode(t: Tree, s: ContentScan, keptSet: ReadonlySet<string>): RepoProfile["generated_code"] {
  const dirs: Counter<string> = new Map();
  for (const f of t.files) if (GENERATED_PATH.test(f)) inc(dirs, dirOf(f) || ".");
  const headerDirs: Counter<string> = new Map();
  for (const f of s.headerHits) inc(headerDirs, dirOf(f) || ".");
  return {
    paths: mostCommon(dirs, 15).map(([dir, files]) => ({ dir, files })),
    header_marked_files: s.headerHits.length,
    header_sample: s.headerHits.slice(0, 10),
    header_dirs: mostCommon(headerDirs, 10).map(([dir, files]) => ({ dir, files })),
    header_files: s.headerHits
      .filter((f) => keptSet.has(f) && (s.headerLines.get(f) ?? 0) > LARGE_GENERATED_LINES)
      .map((f) => ({ path: f, lines: s.headerLines.get(f) ?? 0 }))
      .sort((a, b) => b.lines - a.lines || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .slice(0, 10),
  };
}

/* ── secrets (where, never what) ────────────────────────────────── */

const SENSITIVE_FILE = /(^|\/)(\.env(\.[a-z]+)?|.*\.pfx|.*\.snk|.*\.pem|.*\.p12|.*\.key|.*\.keystore|.*\.jks|.*\.user|secrets?\.(json|ya?ml)|appsettings\.(Production|Staging|Development)\.json|web\.config|app\.config|credentials|\.npmrc|\.pypirc)$/i;
/** Configuration a change legitimately edits (binding redirects, settings): never denied — what is written into it is guarded by the secret-scan hook. */
const EDITABLE_CONFIG = /(^|\/)(web|app)\.config$/i;
/** A dotenv template documents the settings; it is meant to be read. */
const DOTENV_TEMPLATE = /(^|\/)\.env\.(example|sample|template|dist|defaults)$/i;

/** Is this file one a deny list must leave alone — an app/web.config, or a dotenv template? */
export const leaveReadable = (f: string): boolean => EDITABLE_CONFIG.test(f) || DOTENV_TEMPLATE.test(f);

/**
 * Glob deny patterns for the kinds of sensitive file present: `**\/*.snk`
 * covers 58 signing keys in one line, and the next key added is covered too.
 * Named files that no pattern covers (`.npmrc`, `appsettings.Development.json`)
 * stay in the list by name.
 */
export function sensitivePatterns(files: readonly string[]): string[] {
  const out = new Set<string>();
  const names = files.map((f) => baseOf(f).toLowerCase());
  const plainUser = names.some((n) => n.endsWith(".user") && !n.endsWith(".pubxml.user"));
  for (const n of names) {
    if (n.endsWith(".pubxml.user")) out.add(plainUser ? "**/*.user" : "**/*.pubxml.user");
    else if (n.endsWith(".user")) out.add("**/*.user");
    else if (/\.(snk|pfx|pem|p12|jks|keystore|key)$/.test(n)) out.add(`**/*${n.slice(n.lastIndexOf("."))}`);
    else if (n === ".env") out.add("**/.env");
    else if (/^\.env\.[a-z]+$/.test(n) && !DOTENV_TEMPLATE.test(n)) out.add(`**/${n}`);
  }
  return [...out].sort();
}

/** Does one of the `**\/<name glob>` patterns cover this file? */
export function coveredByPattern(file: string, patterns: readonly string[]): boolean {
  const name = baseOf(file).toLowerCase();
  return patterns.some((p) => {
    const g = p.replace(/^\*\*\//, "").toLowerCase();
    return new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")}$`).test(name);
  });
}

function secrets(t: Tree, s: ContentScan): RepoProfile["secrets"] {
  const total = [...s.secretsByKind.values()].reduce((a, b) => a + b, 0);
  const sensitive = t.files.filter((f) => SENSITIVE_FILE.test(f));
  return {
    total,
    by_kind: Object.fromEntries(s.secretsByKind),
    files: mostCommon(s.secretFiles).map(([p, hits]) => ({ path: p, hits })),
    sensitive_files: sensitive,
    in_test_files: s.secretsInTests,
    outside_tests: total - s.secretsInTests,
    dotenv_examples: t.files.filter((f) => /\.env\.(example|sample|template)$/.test(f)),
    patterns: sensitivePatterns(sensitive),
  };
}

/* ── external systems ───────────────────────────────────────────── */

const EXTERNAL_SYSTEMS: [string, RegExp][] = [
  ["PostgreSQL", /\b(postgres(ql)?|psycopg|pg_|npgsql|asyncpg)\b/gim],
  ["MySQL/MariaDB", /\b(mysqli?|mariadb)\b/gim],
  ["SQL Server", /(System\.Data\.SqlClient|Microsoft\.Data\.SqlClient|SqlConnection|Data Source=|Initial Catalog=)/gim],
  ["MongoDB", /\bmongo(db|ose)?\b/gim],
  ["Redis", /\bredis\b/gim],
  // `Microsoft.Azure.Amqp` and `Azure.Core.Amqp` are Azure Service Bus's transport, not a broker of their own.
  ["RabbitMQ/AMQP", /(\brabbitmq\b|\bamqplib\b|(?<![.\w-])amqps?(?![.\w-]))/gim],
  ["Azure Service Bus", /(Microsoft\.Azure\.ServiceBus|Azure\.Messaging\.ServiceBus|WindowsAzure\.ServiceBus|Microsoft\.Azure\.Amqp|Azure\.Core\.Amqp|servicebus\.windows\.net)/gim],
  ["Kafka", /\bkafka\b/gim],
  ["AWS SDK", /(boto3|aws-sdk|github\.com\/aws\/aws-sdk-go|AWSSDK\.|software\.amazon\.awssdk|hashicorp\/aws)/gm],
  ["Azure SDK", /(azure-identity|@azure\/|Azure\.Identity|Microsoft\.Azure\.|azure-sdk-for-go|Azure\.Messaging)/gm],
  ["GCP SDK", /(google-cloud-|@google-cloud\/|cloud\.google\.com\/go)/gm],
  ["Dataverse/Dynamics 365", /(Microsoft\.Xrm\.Sdk|Microsoft\.Crm\.Sdk|Microsoft\.CrmSdk\.|Dataverse|IOrganizationService|Microsoft\.PowerPlatform|CrmSvcUtil|xrm\.|Xrm\.WebApi)/gm],
  ["Azure DevOps", /(dev\.azure\.com|visualstudio\.com|azure-devops|vsts|azure-pipelines)/gim],
  ["Jira", /\b(atlassian\.net|jira)\b/gim],
  ["Stripe", /\bstripe\b/gim],
  ["SMTP/email", /\b(smtp|sendgrid|mailgun|ses\b)/gim],
  ["OpenAI API", /(api\.openai\.com|openai\b)/gim],
  ["Anthropic API", /(anthropic|api\.anthropic\.com)/gim],
  ["Sentry", /\bsentry\b/gim],
  ["Docker", /^(FROM |docker-compose|services:)/gim],
  ["Kubernetes/Helm", /(apiVersion: apps\/v1|kind: Deployment|helm)/gim],
  ["OAuth/OIDC/Identity", /(oauth2?|openid|oidc|keycloak|identityserver|Auth0|azure ?ad\b|entra)/gim],
  ["Elasticsearch/OpenSearch", /\b(elasticsearch|opensearch)\b/gim],
  ["GraphQL", /\bgraphql\b/gim],
  ["gRPC/Protobuf", /\b(grpc|protobuf)\b/gim],
  // `AuthType=Office365` in a Dataverse connection string is how it signs in, not a SharePoint integration.
  ["SharePoint/Office365", /(sharepoint|Microsoft\.Graph|(?<!auth\s*type\s*=\s*)office365)/gim],
  ["SOAP/WCF web services", /(System\.ServiceModel|\.svc\b|wsdl|SoapClient)/gim],
  ["SAP", /\bsap\b(?!i)/gim],
];
const MANIFEST_LIKE = /(package\.json|pyproject\.toml|requirements.*\.txt|go\.mod|pom\.xml|build\.gradle(\.kts)?|\.csproj|packages\.config|composer\.json|Cargo\.toml|docker-compose.*\.ya?ml|Dockerfile|\.tf|appsettings.*\.json|web\.config|app\.config|\.env\.example|libs\.versions\.toml)$/;

/** Manifests only — a dependency named is a system used; code mentioning one may be a comment. Ordered by count, most first. */
function externalSystems(t: Tree): RepoProfile["external_systems"] {
  const hits = new Map<string, { count: number; files: Counter<string> }>();
  for (const f of t.files.filter((x) => MANIFEST_LIKE.test(x)).slice(0, 600)) {
    const x = read(t, f, EXTERNAL_LIMIT);
    for (const [name, rx] of EXTERNAL_SYSTEMS) {
      const n = countMatches(rx, x);
      if (!n) continue;
      const h = hits.get(name) ?? { count: 0, files: new Map() };
      h.count += n;
      inc(h.files, f, n);
      hits.set(name, h);
    }
  }
  const out: RepoProfile["external_systems"] = {};
  for (const [name, h] of [...hits.entries()].sort((a, b) => b[1].count - a[1].count)) out[name] = { count: h.count, sample_files: mostCommon(h.files, 4).map(([p]) => p) };
  return out;
}

/* ── AI configuration already there ─────────────────────────────── */

const AI_FILE = /(^|\/)(CLAUDE\.md|AGENTS\.md|GEMINI\.md|\.cursorrules|\.cursor\/rules(\/|$)|\.github\/copilot-instructions\.md|\.github\/instructions\/|\.mcp\.json|\.claude\/|\.clinerules|\.kiro\/|\.windsurf|\.windsurfrules|\.aider|\.agents\/|\.codex\/|copilot-instructions\.md|llms\.txt)/i;

function aiKind(f: string): string {
  const lower = f.toLowerCase();
  if (f.includes("CLAUDE.md")) return "CLAUDE.md";
  if (f.includes("AGENTS.md")) return "AGENTS.md";
  if (lower.includes("cursor")) return "cursor";
  if (lower.includes("copilot")) return "copilot";
  if (f.includes("clinerules")) return "clinerules";
  if (`/${f}`.includes("/.claude/")) return ".claude/";
  if (f.includes(".agents/")) return ".agents/";
  if (f.includes("mcp.json")) return "mcp.json";
  if (f.includes(".kiro")) return "kiro";
  if (lower.includes("windsurf")) return "windsurf";
  return "other";
}

function aiConfig(t: Tree): RepoProfile["ai_config"] {
  const files = t.files.filter((f) => AI_FILE.test(f));
  return {
    present: files.length > 0,
    files: files.slice(0, 60),
    count: files.length,
    kinds: [...new Set(files.map(aiKind))].sort(),
    sizes: Object.fromEntries(files.filter((f) => f.endsWith(".md")).map((f) => [f, codePoints(read(t, f))])),
  };
}

/* ── documentation ──────────────────────────────────────────────── */

function docs(t: Tree): RepoProfile["docs"] {
  const inDocs = (f: string) => f.startsWith("docs/") || f.startsWith("doc/") || f.startsWith("documentation/");
  const readme = t.files.find((f) => /^README(\.md|\.rst|\.txt)?$/i.test(f)) ?? null;
  const license = exists(t, "LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE.rst", "COPYING", "LICENCE");
  let licenseKind = "none";
  if (license.length) {
    const lt = read(t, license[0] ?? "", 3000);
    licenseKind = lt.includes("MIT License") || lt.includes("Permission is hereby granted, free of charge") ? "MIT"
      : lt.includes("Apache License") ? "Apache-2.0"
        : lt.includes("GNU GENERAL PUBLIC") ? "GPL"
          : lt.includes("Redistribution and use in source and binary") ? "BSD"
            : lt.includes("Mozilla Public") ? "MPL" : "unknown";
  }
  return {
    readme,
    readme_bytes: readme ? codePoints(read(t, readme)) : 0,
    docs_dir: t.files.some(inDocs),
    docs_files: t.files.filter(inDocs).length,
    adrs: t.files.filter((f) => /(^|\/)(adr|adrs|decisions|architecture-decisions)\//i.test(f)).slice(0, 10),
    contributing: exists(t, "CONTRIBUTING.md", ".github/CONTRIBUTING.md", "CONTRIBUTING.rst", "docs/CONTRIBUTING.md"),
    architecture_docs: t.files.filter((f) => /architecture|design[-_]?doc|ARCHITECTURE/i.test(f) && (f.endsWith(".md") || f.endsWith(".rst") || f.endsWith(".txt"))).slice(0, 10),
    license,
    changelog: exists(t, "CHANGELOG.md", "CHANGELOG", "CHANGES.md", "ChangeLog.md"),
    license_kind: licenseKind,
    // Where GitHub looks for them: the root, `.github/` or `docs/` (a template may also be a folder of several).
    pr_template: t.files.filter((f) => /^(\.github\/|docs\/)?PULL_REQUEST_TEMPLATE(\.md|\/[^/]+\.md)$/i.test(f)),
    codeowners: t.files.filter((f) => /^(\.github\/|docs\/)?CODEOWNERS$/.test(f)),
  };
}

/* ── Windows-only build, environment, size ──────────────────────── */

function windowsBuild(t: Tree, stack: Stack): RepoProfile["windows_build"] {
  const count = (rx: RegExp) => anyGlob(t, rx).length;
  const win = {
    sln: stack.slns.length, csproj: stack.csprojs.length, snk: count(/\.snk$/), vbproj: count(/\.vbproj$/),
    packages_config: count(/packages\.config$/), ps1: count(/\.ps1$/), bat_cmd: count(/\.(bat|cmd)$/),
    legacy_netframework: stack.frameworks.has(".NET Framework (legacy, msbuild)"),
    dll_checked_in: count(/\.dll$/), exe_checked_in: count(/\.exe$/),
  };
  return {
    ...win,
    windows_only_build: win.legacy_netframework || (win.sln > 0 && win.packages_config > 0 && stack.frameworks.has(".NET") && !stack.build.system.includes("dotnet")),
    web_app_projects: stack.webApps,
  };
}

/* ── the tools on this machine ──────────────────────────────────── */

/** Where to look: `env` for PATH and PATHEXT, `platform`, and the Visual Studio install roots (Windows). The machine's own by default. */
export type ToolProbe = { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; vsRoots?: string[] };

const envVar = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const k = Object.keys(env).find((x) => x.toUpperCase() === name);
  return k === undefined ? undefined : env[k];
};
const isFile = (p: string): boolean => { try { return statSync(p).isFile(); } catch { return false; } };

/** The first `name` on PATH (with PATHEXT on Windows). The Microsoft Store's `python.exe` stub under WindowsApps is not Python. */
function onPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  const win = platform === "win32";
  const dirs = (envVar(env, "PATH") ?? "").split(win ? ";" : ":").filter(Boolean);
  const exts = win ? [...(envVar(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((e) => e.toLowerCase()), ""] : [""];
  for (const d of dirs) {
    if (win && /^py/.test(name) && /[\\/]WindowsApps[\\/]?$/i.test(d)) continue;
    for (const e of exts) {
      const p = path.join(d, name + e);
      if (isFile(p)) return p;
    }
  }
  return null;
}

const MSBUILD_IN_VS = [["MSBuild", "Current", "Bin", "MSBuild.exe"], ["MSBuild", "Current", "Bin", "amd64", "MSBuild.exe"], ["MSBuild", "15.0", "Bin", "MSBuild.exe"]];
const VSTEST_IN_VS = [["Common7", "IDE", "Extensions", "TestPlatform", "vstest.console.exe"], ["Common7", "IDE", "CommonExtensions", "Microsoft", "TestWindow", "vstest.console.exe"]];
/** A Visual Studio folder name → its major version: `2022` → 17, `18` → 18; anything else sorts last. */
const vsVersion = (y: string): number => { const n = Number(y); return !Number.isInteger(n) ? -1 : n < 100 ? n : ({ 2017: 15, 2019: 16, 2022: 17 } as Record<number, number>)[n] ?? n - 2005; };

/** `<root>/<version>/<edition>/<tail>` — the newest Visual Studio first (Enterprise, Professional, Community, BuildTools alike). */
function inVisualStudio(roots: readonly string[], tails: readonly string[][]): string | null {
  for (const root of roots) {
    let versions: string[];
    try { versions = readdirSync(root); } catch { continue; }
    for (const v of versions.sort((a, b) => vsVersion(b) - vsVersion(a))) {
      let editions: string[];
      try { editions = readdirSync(path.join(root, v)).sort(); } catch { continue; }
      for (const ed of editions) for (const tail of tails) { const p = path.join(root, v, ed, ...tail); if (isFile(p)) return p; }
    }
  }
  return null;
}

/**
 * The build and test tools the machine that runs the diagnosis has — the
 * machine the trial and the build steps run on. A value is the resolved path,
 * or null. On Windows, MSBuild and vstest are also looked for where Visual
 * Studio installs them, since neither is on PATH outside a developer prompt.
 */
export function detectTools(root: string, probe: ToolProbe = {}): Record<string, string | null> {
  const env = probe.env ?? process.env;
  const platform = probe.platform ?? process.platform;
  const win = platform === "win32";
  const vs = win ? (probe.vsRoots ?? [envVar(env, "PROGRAMFILES") ?? "C:\\Program Files", envVar(env, "PROGRAMFILES(X86)") ?? "C:\\Program Files (x86)"].map((r) => path.join(r, "Microsoft Visual Studio"))) : [];
  const find = (...names: string[]): string | null => { for (const n of names) { const p = onPath(n, env, platform); if (p) return p; } return null; };
  const wrapper = (name: string): string | null => { for (const f of win ? [`${name}.bat`, `${name}.cmd`, name] : [name]) { const p = path.join(root, f); if (isFile(p)) return p; } return null; };
  const dotnet = find("dotnet");
  return {
    msbuild: find("msbuild") ?? (win ? inVisualStudio(vs, MSBUILD_IN_VS) : null),
    dotnet,
    dotnet_msbuild: dotnet,
    "vstest.console": find("vstest.console") ?? (win ? inVisualStudio(vs, VSTEST_IN_VS) : null),
    npm: find("npm"),
    node: find("node"),
    pac: find("pac"),
    python: win ? find("python", "py") : find("python3", "python"),
    pytest: find("pytest"),
    gradle: find("gradle"),
    gradlew: wrapper("gradlew"),
    mvn: find("mvn"),
    mvnw: wrapper("mvnw"),
    go: find("go"),
    cargo: find("cargo"),
  };
}

const environment = (t: Tree, tools: Record<string, string | null>): RepoProfile["environment"] => ({
  devcontainer: exists(t, ".devcontainer/devcontainer.json", ".devcontainer.json").length > 0 || anyGlob(t, /^\.devcontainer\//).length > 0,
  dockerfile: t.files.filter((f) => /(^|\/)Dockerfile[^/]*$/.test(f)).slice(0, 10),
  docker_compose: t.files.filter((f) => /(^|\/)(docker-)?compose[^/]*\.ya?ml$/.test(f)).slice(0, 10),
  makefile: exists(t, "Makefile", "makefile", "justfile", "Taskfile.yml").length > 0,
  nix_flake: exists(t, "flake.nix").length > 0,
  editorconfig: exists(t, ".editorconfig").length > 0,
  tool_versions: exists(t, ".tool-versions", ".nvmrc", ".node-version", ".python-version", "rust-toolchain.toml", ".java-version", "global.json"),
  tools,
});

function size(t: Tree, s: ContentScan): RepoProfile["size"] {
  let bytes = 0;
  for (const b of t.bytes.values()) bytes += b;
  // The script sorted (size, path) tuples in reverse: the larger size first, and for one size the later path first.
  const largest = t.files.map((f) => ({ path: f, bytes: t.bytes.get(f) ?? 0 }))
    .sort((a, b) => b.bytes - a.bytes || (a.path > b.path ? -1 : a.path < b.path ? 1 : 0)).slice(0, 8);
  return {
    files: t.files.length,
    code_lines: s.totalLines,
    bytes_on_disk_excl_git: bytes,
    largest_files: largest,
    top_level_dirs: [...new Set(t.files.filter((f) => f.includes("/")).map((f) => f.split("/")[0] ?? ""))].sort().slice(0, 40),
  };
}

/* ── layout: where things are ───────────────────────────────────── */

const MODEL_DIR = /^(Contracts|Models?|Entities|Enums|schema|types|dto)$/i;
const UNIT_MANIFEST = /(^|\/)(package\.json|pyproject\.toml|go\.mod|build\.gradle(\.kts)?|Cargo\.toml|pom\.xml|[^/]+\.(csproj|vbproj|fsproj))$/;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The facts a task about "where does X go" needs: model folders, node packages that build, groups of sibling units, small commented files. Tracked files only when git is there. */
function layoutOf(t: Tree, kept: readonly string[], keptSet: ReadonlySet<string>, s: ContentScan): NonNullable<RepoProfile["layout"]> {
  const isCodeFile = (f: string) => { const lang = LANG_EXT[extOf(f).toLowerCase()]; return lang !== undefined && CODE_LANGS.has(lang); };
  const models: Counter<string> = new Map();
  for (const f of kept) {
    if (!isCodeFile(f)) continue;
    const parts = f.split("/");
    for (let i = 0; i < parts.length - 1; i++) if (MODEL_DIR.test(parts[i] ?? "")) inc(models, parts.slice(0, i + 1).join("/"));
  }
  const nodePackages: string[] = [];
  for (const f of kept) {
    if (!f.endsWith("/package.json") || /(^|\/)node_modules\//.test(f)) continue;
    if (typeof objectAt(parseObject(read(t, f)) ?? {}, "scripts").build === "string") nodePackages.push(dirOf(f));
  }
  const unitDirs = unique(kept.filter((f) => f.includes("/") && UNIT_MANIFEST.test(f) && !/(^|\/)node_modules\//.test(f)).map(dirOf));
  const byParent = new Map<string, string[]>();
  for (const d of unitDirs) { const p = dirOf(d) || "."; byParent.set(p, [...(byParent.get(p) ?? []), d]); }
  const groups = [...byParent.entries()].filter(([, m]) => m.length >= 3)
    .sort((a, b) => b[1].length - a[1].length || cmp(a[0], b[0])).slice(0, 5)
    .map(([parent, members]) => ({ parent, members: [...members].sort() }));
  // Small commented files, one per folder, so a "fix a comment" task has a spread to pick from.
  const small: string[] = [];
  const seen = new Set<string>();
  for (const f of [...s.smallCommented].sort()) {
    if (!keptSet.has(f) || seen.has(dirOf(f))) continue;
    seen.add(dirOf(f));
    small.push(f);
    if (small.length === 5) break;
  }
  return {
    model_dirs: mostCommon(models).filter(([, n]) => n >= 10).map(([d]) => d).slice(0, 10),
    node_packages: nodePackages,
    unit_groups: groups,
    small_source_files: small,
  };
}

/* ── git history ────────────────────────────────────────────────── */

/** Every file git tracks (NUL-separated, so a name with spaces or non-ASCII comes back as it is); null when git cannot say. */
function gitLsFiles(root: string): string[] | null {
  const r = spawnSync("git", ["-c", "core.quotepath=off", "ls-files", "-z"], {
    cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });
  return r.error || r.status !== 0 || typeof r.stdout !== "string" ? null : r.stdout.split("\0").filter(Boolean);
}

/** Below this many commits, "the most changed files" is the shape of one import, not a hot spot. */
const HOT_MIN_COMMITS = 20;

function gitFacts(root: string, trackedList: string[] | null): RepoProfile["git"] {
  const run = (args: string[]): string => {
    const r = spawnSync("git", args, {
      cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    });
    return r.error || typeof r.stdout !== "string" ? "" : r.stdout;
  };
  const g: RepoProfile["git"] = { available: true };
  g.head = run(["rev-parse", "HEAD"]).trim();
  const tracked = trackedList ?? run(["ls-files"]).split("\n").filter((x) => x);
  g.tracked_files = tracked.length;
  g.tracked_binaries_dll_exe_pdb = tracked.filter((x) => /\.(dll|exe|pdb|nupkg)$/i.test(x)).length;
  g.tracked_dll = tracked.filter((x) => /\.dll$/i.test(x)).length;
  g.tracked_exe = tracked.filter((x) => /\.exe$/i.test(x)).length;
  g.tracked_ide_junk = tracked.filter((x) => /(^|\/)(\.vs|\.idea|obj)\/|\.(suo|user)$/.test(x)).length;
  // `packages/` counts as a cache only when it is one (NuGet's `<Id>.<version>/` layout or `.nupkg` files); an npm
  // monorepo's `packages/` is the code itself, and counting it would deny the agent the repository it works on.
  const cache = /^(node_modules|vendor)\//;
  const nuget = /^packages\/([^/]+\.\d+(\.\d+)*[^/]*\/|[^/]+\.nupkg$)/i;
  g.tracked_package_dirs = tracked.filter((x) => cache.test(x) || nuget.test(x)).length;
  // Kept in git on purpose (a NuGet cache the build restores from, or a monorepo's own packages/): never to be gitignored.
  g.packages_committed = tracked.some((x) => /^(packages|node_modules|vendor)\//.test(x));
  g.commits_in_clone = parseInt(run(["rev-list", "--count", "HEAD"]).trim(), 10) || 0;
  // A worktree's `.git` is a file, so the shallow marker is asked of git instead of looked for on disk.
  const dotGit = path.join(root, ".git");
  g.shallow = statSync(dotGit).isDirectory() ? existsSync(path.join(dotGit, "shallow")) : run(["rev-parse", "--is-shallow-repository"]).trim() === "true";
  g.last_commit_date = run(["log", "-1", "--format=%cs"]).trim();
  g.first_commit_date_in_clone = run(["log", "--reverse", "--format=%cs"]).trim().split("\n")[0] ?? "";
  g.authors_in_clone = run(["shortlog", "-sn", "--no-merges", "HEAD"]).trim().split("\n").filter((a) => a.trim()).length;

  const log = run(["log", "--no-merges", "--name-only", "--format=__C__%h|%an|%cs", `--max-count=${LOG_MAX_COMMITS}`, "HEAD"]);
  const fileChanges: Counter<string> = new Map();
  const dirChanges: Counter<string> = new Map();
  const fileAuthors = new Map<string, Set<string>>();
  const dirAuthors = new Map<string, Set<string>>();
  const commitSets: string[][] = [];
  let author: string | null = null;
  let cur: string[] = [];
  const flush = () => { if (author !== null && cur.length) commitSets.push([...cur].sort()); };
  for (const line of log.split("\n")) {
    if (line.startsWith("__C__")) {
      flush();
      author = line.slice(5).split("|")[1] ?? "";
      cur = [];
    } else if (line.trim()) {
      const f = line.trim();
      cur.push(f);
      inc(fileChanges, f);
      addTo(fileAuthors, f, author ?? "");
      const parts = f.split("/");
      const d = parts.length > 1 ? (parts[0] ?? ".") : ".";
      const d2 = parts.length > 2 ? parts.slice(0, 2).join("/") : d;
      inc(dirChanges, d2);
      addTo(dirAuthors, d2, author ?? "");
    }
  }
  flush();
  const enough = commitSets.length >= HOT_MIN_COMMITS;
  g.hot_files = enough ? mostCommon(fileChanges, 15).map(([p, changes]) => ({ path: p, changes, authors: fileAuthors.get(p)?.size ?? 0 })) : [];
  g.hot_dirs = enough ? mostCommon(dirChanges, 12).map(([dir, changes]) => ({ dir, changes, authors: dirAuthors.get(dir)?.size ?? 0 })) : [];
  // Repeated change shapes: the same set of 3–12 files in two or more commits — a process the code does not state.
  const shapes = new Map<string, { files: string[]; times: number }>();
  for (const fs of commitSets) {
    if (fs.length < 3 || fs.length > 12) continue;
    const key = fs.join("\n");
    const e = shapes.get(key);
    if (e) e.times++; else shapes.set(key, { files: fs, times: 1 });
  }
  g.repeated_change_shapes = [...shapes.values()].sort((a, b) => b.times - a.times).slice(0, 8).filter((x) => x.times >= 2);
  // Co-change pairs (files changed together four times or more) as a softer signal.
  const pairs = new Map<string, { a: string; b: string; times: number }>();
  for (const fs of commitSets) {
    if (fs.length > 12) continue;
    for (const [i, a] of fs.entries()) {
      for (const b of fs.slice(i + 1)) {
        const key = `${a}\n${b}`;
        const e = pairs.get(key);
        if (e) e.times++; else pairs.set(key, { a, b, times: 1 });
      }
    }
  }
  g.cochange_pairs = [...pairs.values()].sort((a, b) => b.times - a.times).slice(0, 8).filter((x) => x.times >= 4);
  g.commits_analyzed = commitSets.length;
  const byExt: Counter<string> = new Map();
  for (const [f, n] of fileChanges) inc(byExt, extOf(f), n);
  g.churn_by_ext = Object.fromEntries(mostCommon(byExt, 8));
  return g;
}

/* ── the diagnosis ──────────────────────────────────────────────── */

/** Lets the event loop run between the phases, so a long diagnosis inside the API does not hold every other request. */
const breathe = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Diagnoses the repository at `root` and returns its profile. Nothing is
 * written anywhere; git is read with plain commands and only when the
 * repository has a `.git` (a directory, or a worktree's file) and `opts.git`
 * is not false.
 */
export async function diagnoseRepository(root: string, name: string, opts: DiagnoseOptions = {}): Promise<RepoProfile> {
  const abs = path.resolve(root);
  const log = opts.log ?? (() => {});
  const t = walkTree(abs);
  log(`walked ${t.files.length} files under ${abs}`);
  await breathe();
  const scan = scanContents(t);
  log(`read ${scan.langFiles.size} languages, ${scan.totalLines} code lines, ${scan.headerHits.length} generated headers`);
  await breathe();
  const stack = detectStack(t);
  countTests(t, stack.tests);
  // What git tracks decides what counts as evidence; without git, what is on disk is all there is.
  const useGit = opts.git !== false && existsSync(path.join(abs, ".git"));
  const tracked = useGit ? gitLsFiles(abs) : null;
  const keptSet: ReadonlySet<string> = tracked ? new Set(tracked) : t.relset;
  const kept = t.files.filter((f) => keptSet.has(f));
  Object.assign(stack.tests, testProjects(t, kept, keptSet, stack));
  const tools = detectTools(abs, opts.tools);
  log(`tools here: ${Object.entries(tools).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"}`);
  const ci = detectCi(t);
  const profile: RepoProfile = {
    name,
    path: abs,
    languages: languages(scan),
    frameworks: [...stack.frameworks].sort(),
    package_managers: [...stack.packageManagers].sort(),
    build: stack.build,
    tests: stack.tests,
    lint_format: [...new Set([...lintFormat(t, stack.lint), ...lintersFromCi(ci.commands)])],
    ci,
    monorepo: detectMonorepo(t, stack),
    generated_code: generatedCode(t, scan, keptSet),
    secrets: secrets(t, scan),
    external_systems: externalSystems(t),
    ai_config: aiConfig(t),
    docs: docs(t),
    windows_build: windowsBuild(t, stack),
    environment: environment(t, tools),
    size: size(t, scan),
    git: { available: false },
    layout: layoutOf(t, kept, keptSet, scan),
  };
  await breathe();
  if (useGit) {
    profile.git = gitFacts(abs, tracked);
    log(`git: ${profile.git.commits_analyzed} commits analyzed, ${profile.git.tracked_files} tracked files`);
  }
  // The walk skips bin/ and obj/, so "checked-in binaries" comes from git's list, not the walk (Trade tracks 3,064 and the walk said 0).
  if (profile.git.tracked_dll !== undefined) profile.windows_build.dll_checked_in = Math.max(profile.windows_build.dll_checked_in, profile.git.tracked_dll);
  if (profile.git.tracked_exe !== undefined) profile.windows_build.exe_checked_in = Math.max(profile.windows_build.exe_checked_in, profile.git.tracked_exe);
  return profile;
}
