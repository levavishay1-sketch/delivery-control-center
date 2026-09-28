import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { coveredByPattern, leaveReadable, sensitivePatterns } from "./diagnose.ts";
import type { ComponentFamily, ComponentKind, ComponentRisk, ComponentSeed, ProfileCorrection, RepoProfile } from "./types.ts";

/**
 * The decision rules (`rules.json`): a signal in the profile → the components
 * that answer it, each with the evidence in words. Pure — no database, no
 * model — so the eleven stored diagnoses are its unit test, and a person can
 * read from the screen exactly why a component is there ("כי ראיתי").
 *
 * A rule relies on facts (the profile paths its condition reads). When the
 * person marked one of them wrong, the rule does not fire and the plan says
 * which rule was held back by which correction.
 */

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { path: string; empty?: boolean; truthy?: boolean; eq?: unknown; gte?: number; gt?: number; lt?: number; includes?: string; includesAny?: string[]; hasKey?: string; hasAnyKey?: string[] }
  | { fn: string; arg?: string; truthy?: boolean; gte?: number };

/** `when` on a component: it is part of the rule's answer only when this holds too (one rule, two answers — "write it" or "not needed, because"). */
export type RuleComponent = {
  key: string; kind: ComponentKind; family: ComponentFamily; risk: ComponentRisk;
  title_he: string; what_he: string; verify_he: string; params: Record<string, unknown>; notRecommended?: boolean; when?: Condition;
};

export type Rule = { id: string; signal: string; when: Condition; reason_he: string; components: RuleComponent[] };

export type RuleFiring = { rule: string; signal: string; reason_he: string; components: ComponentSeed[] };
export type RuleSuppression = { rule: string; fact: string; note: string | null };
export type RulesOutcome = { fired: RuleFiring[]; suppressed: RuleSuppression[]; considered: number };

const RULES_PATH = fileURLToPath(new URL("./rules.json", import.meta.url));
let cached: Rule[] | null = null;
export function loadRules(): Rule[] {
  if (!cached) cached = (JSON.parse(readFileSync(RULES_PATH, "utf8")) as { rules: Rule[] }).rules;
  return cached;
}

/* ── reading the profile ──────────────────────────────────────────── */

function at(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const part of dotted.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const isEmpty = (v: unknown) => v == null || v === false || v === 0 || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

/* ── the helpers the rules name by `fn` ───────────────────────────── */

export function genDirs(d: RepoProfile): string[] {
  const out = d.generated_code.paths.filter((p) => p.files >= 2 && !p.dir.endsWith("__tests__")).map((p) => p.dir);
  for (const h of d.generated_code.header_dirs) if (h.files >= 2 && !out.includes(h.dir)) out.push(h.dir);
  const dirs = out.slice(0, 6);
  // One large generated file is enough (a 98K-line Entities.cs) — named as the file, so hand-written code beside it stays editable.
  for (const f of d.generated_code.header_files ?? []) if (!dirs.some((x) => f.path === x || f.path.startsWith(`${x}/`))) dirs.push(f.path);
  return dirs.slice(0, 10);
}

/** Below this many commits there is no hot spot to speak of (one squashed import makes every folder "hot"). */
const HOT_MIN_COMMITS = 20;

export function hotMultiAuthor(d: RepoProfile): { dir: string; changes: number; authors: number } | null {
  if (!d.git.available || (d.git.commits_analyzed ?? 0) < HOT_MIN_COMMITS) return null;
  return d.git.hot_dirs?.find((h) => h.dir !== "." && h.authors >= 10 && h.changes >= 100) ?? null;
}

export const shapes = (d: RepoProfile) => (d.git.repeated_change_shapes ?? []).filter((s) => s.times >= 3 && s.files.length >= 3);

const DEP_FILES = /(go\.mod|go\.sum|package\.json|pnpm-lock|yarn\.lock|uv\.lock|Cargo\.lock|Cargo\.toml|composer\.lock|libs\.versions\.toml|Directory\.Packages\.props|pyproject\.toml|\.csproj$|build\.gradle)/;
export const depBumpShape = (d: RepoProfile) => (d.git.cochange_pairs ?? []).find((p) => DEP_FILES.test(p.a) && DEP_FILES.test(p.b) && p.times >= 8) ?? null;

export const langFiles = (d: RepoProfile, lang: string) => d.languages.filter((l) => l.language === lang).reduce((a, l) => a + l.files, 0);

const BUILD_SYSTEMS = new Set(["maven", "gradle", "cargo", "dotnet", "msbuild", "go", "composer", "turborepo"]);
export const buildSystemsCount = (d: RepoProfile) => d.build.system.filter((s) => BUILD_SYSTEMS.has(s)).length;

/** The linters the root has — a linter only some sub-packages carry (`eslint (packages: …)`) is theirs, not a root formatter. */
export const rootLint = (d: RepoProfile) => d.lint_format.filter((l) => !/\(packages: /.test(l));

/** The first solution file the build commands name. */
export const slnFirst = (d: RepoProfile): string => d.build.commands.map((c) => /(\S+\.(?:sln|slnx|slnf))\b/.exec(c)?.[1]).find(Boolean) ?? "";

/** How the machine that ran the diagnosis builds a Windows-only solution: Visual Studio's MSBuild first (it builds Web Application projects too), then `dotnet msbuild`; null when it has neither, or the tools were not looked for. */
export function winBuildTool(d: RepoProfile): { tool: "msbuild" | "dotnet_msbuild"; command: string } | null {
  const tools = d.environment.tools;
  if (!tools || !d.windows_build.windows_only_build) return null;
  const target = slnFirst(d) || "<the solution>.sln";
  if (tools.msbuild) return { tool: "msbuild", command: `msbuild ${target}` };
  if (tools.dotnet_msbuild ?? tools.dotnet) return { tool: "dotnet_msbuild", command: `dotnet msbuild ${target}` };
  return null;
}

/**
 * The deny list for sensitive files: one pattern per kind (`**\/*.snk`), then
 * every sensitive or secret-holding file no pattern covers — all of them,
 * never a first few. An app/web.config stays editable (a change legitimately
 * edits it; the secret-scan hook guards what is written into it), and a
 * dotenv template stays readable.
 */
export function sensitiveDeny(d: RepoProfile): { entries: string[]; files: number; patterns: string[] } {
  const patterns = d.secrets.patterns ?? sensitivePatterns(d.secrets.sensitive_files);
  const files = [...new Set([...d.secrets.sensitive_files, ...d.secrets.files.map((f) => f.path)])].filter((f) => !leaveReadable(f));
  return { entries: [...patterns, ...files.filter((f) => !coveredByPattern(f, patterns))], files: files.length, patterns };
}

const FN: Record<string, { run: (d: RepoProfile, arg?: string) => unknown; facts: string[] }> = {
  gen_dirs: { run: genDirs, facts: ["generated_code"] },
  hot_multi_author: { run: hotMultiAuthor, facts: ["git.hot_dirs"] },
  shapes: { run: shapes, facts: ["git.repeated_change_shapes"] },
  dep_bump_shape: { run: depBumpShape, facts: ["git.cochange_pairs"] },
  lang_files: { run: (d, arg) => langFiles(d, arg ?? ""), facts: ["languages"] },
  build_systems_count: { run: buildSystemsCount, facts: ["build.system"] },
  root_lint: { run: rootLint, facts: ["lint_format"] },
  win_build_tool: { run: winBuildTool, facts: ["environment.tools"] },
  deny_sensitive: { run: (d) => sensitiveDeny(d).entries, facts: ["secrets.sensitive_files", "secrets.files"] },
  mono_own: { run: (d) => d.monorepo.own_commands ?? [], facts: ["monorepo.own_commands"] },
  node_packages: { run: (d) => d.layout?.node_packages ?? [], facts: ["layout.node_packages"] },
};

/* ── evaluating a condition ───────────────────────────────────────── */

function compare(v: unknown, c: { empty?: boolean; truthy?: boolean; eq?: unknown; gte?: number; gt?: number; lt?: number; includes?: string; includesAny?: string[]; hasKey?: string; hasAnyKey?: string[] }): boolean {
  if (c.empty !== undefined) return isEmpty(v) === c.empty;
  if (c.truthy !== undefined) return !isEmpty(v) === c.truthy;
  if (c.eq !== undefined) return v === c.eq;
  if (c.gte !== undefined) return typeof v === "number" && v >= c.gte;
  if (c.gt !== undefined) return typeof v === "number" && v > c.gt;
  if (c.lt !== undefined) return typeof v === "number" && v < c.lt;
  if (c.includes !== undefined) return Array.isArray(v) && v.includes(c.includes);
  if (c.includesAny !== undefined) return Array.isArray(v) && c.includesAny.some((x) => v.includes(x));
  if (c.hasKey !== undefined) return !!v && typeof v === "object" && c.hasKey in (v as object);
  if (c.hasAnyKey !== undefined) return !!v && typeof v === "object" && c.hasAnyKey.some((k) => k in (v as object));
  return !isEmpty(v);
}

export function evaluate(cond: Condition, d: RepoProfile): boolean {
  if ("all" in cond) return cond.all.every((c) => evaluate(c, d));
  if ("any" in cond) return cond.any.some((c) => evaluate(c, d));
  if ("not" in cond) return !evaluate(cond.not, d);
  if ("fn" in cond) {
    const f = FN[cond.fn];
    if (!f) throw new Error(`rules.json names an unknown helper: ${cond.fn}`);
    const v = f.run(d, cond.arg);
    if (cond.gte !== undefined) return typeof v === "number" && v >= cond.gte;
    return !isEmpty(v) === (cond.truthy ?? true);
  }
  return compare(at(d, cond.path), cond);
}

/** The profile paths a condition reads — what a correction can hold back. */
export function factsOf(cond: Condition): string[] {
  if ("all" in cond) return cond.all.flatMap(factsOf);
  if ("any" in cond) return cond.any.flatMap(factsOf);
  if ("not" in cond) return factsOf(cond.not);
  if ("fn" in cond) return FN[cond.fn]?.facts ?? [];
  if (cond.hasKey) return [`${cond.path}.${cond.hasKey}`];
  if (cond.hasAnyKey) return cond.hasAnyKey.map((k) => `${cond.path}.${k}`);
  return [cond.path];
}

/** A correction on `tests` holds back a rule on `tests.frameworks`, and one on `tests.frameworks` holds back a rule on `tests`. */
const touches = (fact: string, correction: string) => fact === correction || fact.startsWith(`${correction}.`) || correction.startsWith(`${fact}.`);

/* ── the context the Hebrew texts are filled from ─────────────────── */

const base = (p: string) => p.split("/").pop() ?? p;
const join = (xs: unknown[], sep = ", ") => xs.map(String).join(sep);
/** The CI commands "done" is measured by: the test, build, check and lint runs first, at most three — not the CI's environment lines. */
export const doneCommands = (cmds: readonly string[]): string[] => {
  const gate = cmds.filter((c) => /\b(test|nextest|build|check|clippy|fmt|lint|vet|verify|tsc|vitest|jest|pytest|phpunit)\b/.test(c) && !/\$\{\{|\$[A-Z_]{4,}/.test(c));
  return (gate.length ? gate : [...cmds]).slice(0, 3);
};

export function ruleContext(d: RepoProfile): Record<string, unknown> {
  const g = d.git;
  const hot = hotMultiAuthor(d);
  const sh = shapes(d);
  const dep = depBumpShape(d);
  const i18n = (g.hot_dirs ?? []).find((h) => /(^|\/)(po|locale|locales|i18n|lang|translations?)$/.test(h.dir)) ?? null;
  const secOut = d.secrets.files.filter((f) => !/(test|spec|fixture|snapshot)/i.test(f.path)).map((f) => f.path);
  const aiMd = d.ai_config.files.filter((f) => (f.endsWith("AGENTS.md") || f.endsWith("CLAUDE.md")) && !f.includes("/"));
  const tfPair = (g.cochange_pairs ?? []).find((p) => p.a.includes("variables.tf") || p.b.includes("variables.tf"))?.times ?? 0;
  const buildFiles = new Set(["pom.xml", "build.gradle", "build.gradle.kts", "Cargo.toml", "package.json"]);
  const bp = (g.cochange_pairs ?? []).find((p) => buildFiles.has(base(p.a)) && buildFiles.has(base(p.b))) ?? null;
  const tfms = Object.keys(d.build.dotnet_target_frameworks ?? {});
  const testCmd = d.ci.commands.find((c) => /\b(test|verify|pytest|phpunit|vitest|jest)\b/.test(c)) ?? d.tests.commands?.[0] ?? (d.tests.frameworks[0] ?? "-");
  const formatterPick = ["@biomejs/biome", "biome", "prettier", "ruff", "black", "spotless", "ktlint", "golangci-lint", "rustfmt/clippy (toolchain pinned)", "php-cs-fixer", "spring-javaformat", "terraform_fmt", "eslint"];
  const rootLinters = rootLint(d);
  const formatter = rootLinters.find((l) => formatterPick.includes(l)) ?? rootLinters[0] ?? "-";
  const docPointer = d.docs.architecture_docs[0] ?? (d.docs.docs_files ? "docs/" : d.docs.readme ?? "README");
  const envKind = [d.environment.devcontainer ? "devcontainer" : null, d.environment.dockerfile.length ? "Dockerfile" : null, d.environment.docker_compose.length ? "compose" : null].filter(Boolean).join(", ");
  const dbKinds = ["PostgreSQL", "MySQL/MariaDB", "SQL Server"].filter((k) => k in d.external_systems);
  const cloud = ["AWS SDK", "Azure SDK", "GCP SDK"].filter((k) => k in d.external_systems);
  const buildSystems = d.build.system.filter((s) => BUILD_SYSTEMS.has(s));
  const genList = genDirs(d);
  const mobile = d.frameworks.filter((f) => ["android", "flutter/dart", "jetpack-compose", "react-native (sub-package)"].includes(f));
  // PCF: every control builds from the folder that holds its package.json; controls side by side share one file in their parent.
  const nodePkgs = d.layout?.node_packages ?? [];
  const byParent = new Map<string, string[]>();
  for (const p of nodePkgs) { const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : p; byParent.set(parent, [...(byParent.get(parent) ?? []), p]); }
  const pcfAreas = d.frameworks.includes("PowerApps PCF control")
    ? [...byParent.entries()].map(([parent, members]) => (members.length > 1 ? { dir: parent, toolchain: "node", command: "npm run build", cwds: members } : { dir: members[0]!, toolchain: "node", command: "npm run build" }))
    : [];
  const tick = (c: string) => `\`${c}\``;
  const win = winBuildTool(d);
  const webApps = d.windows_build.web_app_projects;
  const tfmText = join(tfms.slice(0, 2)) || "-";
  const dotnetToo = d.environment.tools?.dotnet ? ` ${tick("dotnet msbuild")} builds the class libraries${webApps ? "; the Web Application projects need Visual Studio's MSBuild" : ""}.` : "";
  // Never "cannot build here" when a tool exists: the line says how.
  const winLine = !win
    ? `This repository builds only on Windows (msbuild, ${tfmText}, signed assemblies). If you are not on a Windows build runner, say so: do not claim a build or a test run.`
    : win.tool === "msbuild"
      ? `This repository targets .NET Framework (${tfmText}) and builds on Windows with Visual Studio's MSBuild: ${tick(win.command)} (msbuild is often not on PATH: use a Developer PowerShell, or MSBuild.exe by its full path).${dotnetToo}`
      : `This repository targets .NET Framework (${tfmText}). Class libraries build with ${tick(win.command)}${webApps === 0 ? "" : "; Web Application projects need Visual Studio's MSBuild"}.`;
  const own = d.monorepo.own_commands ?? [];
  const ownText = own.map((o) => `${o.dir} (${[o.build, o.test].filter((c): c is string => !!c).map(tick).join(", ")})`).join("; ");
  const rootBuild = win?.command ?? d.build.commands[0]?.replace(/\s+#.*$/, "") ?? "";
  const monoWs = d.monorepo.workspaces.slice(0, 2).map(String).join("; ") || "workspace";
  const monoN = d.monorepo.package_count ?? d.monorepo.packages.length;
  const monoLine = own.length
    ? `This is a multi-package repository (${monoWs}, ${monoN} packages).${rootBuild ? ` The rest build from the root with ${tick(rootBuild)}.` : ""} These build with their own command, from their own folder: ${ownText}.`
    : `This is a multi-package repository (${monoWs}, ${monoN} packages); one command builds them all, from the root${rootBuild ? `: ${tick(rootBuild)}` : ""}.`;
  const deny = sensitiveDeny(d);
  const pkgCommitted = d.git.packages_committed ?? (d.git.tracked_package_dirs ?? 0) > 0;
  const gitignore = ["bin/", "obj/", ...(pkgCommitted ? [] : ["packages/"]), ".vs/", "*.user", "*.suo"];
  // A deny rule makes a folder look absent to the agent ("packages/ is empty, so NuGet was never restored") — the line beside it says it is there.
  const hiddenDirs = ["packages", "bin", "obj", ".vs"];
  const denyDirs = [...hiddenDirs.map((x) => `Read(**/${x}/**)`), ...hiddenDirs.filter((x) => x !== ".vs").map((x) => `Edit(**/${x}/**)`)];
  const dirList = hiddenDirs.map((x) => tick(`${x}/`));
  const denyDirsLine = `${dirList.slice(0, -1).join(", ")} and ${dirList[dirList.length - 1]} are hidden from you by a deny rule — they exist here (${pkgCommitted ? "a committed NuGet cache and build outputs" : "build outputs and IDE state"}), you just cannot read them. Never conclude they are missing or that packages were not restored; ask a person if you need something inside them.`;
  const pcfDirs = nodePkgs.length ? nodePkgs.map((x) => tick(`${x}/`)).join(", ") : "their own folder";
  const tests = d.tests.commands;
  return {
    gen_dirs: join(genList) || "-", gen_dirs_arr: genList,
    test_files: d.tests.test_files, test_frameworks: join(d.tests.frameworks.slice(0, 3)) || "-", test_frameworks_arr: d.tests.frameworks,
    test_cmd: testCmd, test_dirs: join(d.tests.test_dirs.map((t) => t[0])) || "-", test_dirs_arr: d.tests.test_dirs.map((t) => t[0]),
    ci_systems: join(d.ci.systems), ci_systems_arr: d.ci.systems, ci_n: d.ci.workflow_count ?? d.ci.workflows.length, ci_cmds: doneCommands(d.ci.commands).join("; "), ci_cmds_arr: d.ci.commands.slice(0, 10),
    mono_ws: monoWs, mono_n: d.monorepo.package_count ?? "?", mono_packages_arr: d.monorepo.packages,
    // All the packages or none: a list cut to a first few tells the agent the rest do not exist.
    which_packages_arr: d.monorepo.packages_truncated || monoN > WHICH_PACKAGE_MAX ? [] : d.monorepo.packages,
    mono_manifests_arr: d.monorepo.manifest_kinds ?? [], mono_own_arr: own, mono_own_dirs_arr: own.map((o) => o.dir), mono_own_n: own.length, mono_rule_text: monoLine,
    mono_own_he: own.length ? `ל-${own.length} מהן פקודה משלהן (${join(own.slice(0, 3).map((o) => o.dir))}${own.length > 3 ? " ועוד" : ""})` : d.monorepo.own_commands ? "פקודה אחת מהשורש בונה את כולן" : "לא נבדק אם לחבילה כלשהי פקודה משלה",
    hot_dir: hot?.dir ?? "-", hot_changes: hot?.changes ?? 0, hot_authors: hot?.authors ?? 0,
    shape_n: sh.length, shape_example: sh[0] ? `${sh[0].files.slice(0, 4).map(base).join(" + ")} (${sh[0].times}x)` : "-", shapes_arr: sh.slice(0, 5),
    sec_outside: d.secrets.outside_tests, sec_total: d.secrets.total, sec_kinds: join(Object.keys(d.secrets.by_kind)), sec_files_outside: join(secOut.slice(0, 3)), sec_files_outside_arr: secOut.slice(0, 25),
    sens_n: d.secrets.sensitive_files.length, sens_sample: join(d.secrets.sensitive_files.slice(0, 3).map(base)), sens_files_arr: d.secrets.sensitive_files,
    deny_sensitive_arr: deny.entries, sens_cover_n: deny.files, sens_patterns: join(deny.patterns) || "לפי שם הקובץ",
    deny_sensitive_line: `Sensitive files exist here but are not readable to you (a deny rule): ${deny.patterns.length ? `${deny.patterns.map(tick).join(", ")}${deny.entries.length > deny.patterns.length ? `, and ${deny.entries.length - deny.patterns.length} more by name` : ""}` : `${deny.entries.length} files by name`}. Never conclude one is missing; ask a person for what you need from it.`,
    deny_binary_arr: denyDirs, deny_binary_line: denyDirsLine,
    sln_n: d.windows_build.sln, snk_n: d.windows_build.snk, tfm: tfmText, sln_first: slnFirst(d),
    win_build_cmd: win?.command ?? "", win_build_line: winLine,
    win_here_he: win ? `במכונה שנבדקה נמצא ${win.tool === "msbuild" ? "MSBuild של Visual Studio" : "dotnet msbuild"} — ההנחיה אומרת איך בונים, לא ש"אי אפשר".` : "msbuild רק ב-Windows; סוכן על Linux חייב לומר זאת במקום לנחש.",
    tools: d.environment.tools ?? null, tests_projects_arr: d.tests.projects ?? null, test_cmds_arr: tests ?? null, web_apps: d.windows_build.web_app_projects ?? null,
    tests_here_he: tests ? (tests.length ? join(tests.slice(0, 2)) : "אין פרויקט בדיקות ב-git") : testCmd,
    build_here_he: rootBuild || "(none inferable)", root_build: rootBuild,
    layout_map: d.layout ? { top: d.size.top_level_dirs, groups: d.layout.unit_groups, nodePackages: d.layout.node_packages } : null,
    gitignore_arr: gitignore, gitignore_list: gitignore.join(", "), pkg_kept_he: pkgCommitted ? " packages/ לא נכנס: הוא נשמר ב-git בכוונה." : "",
    dv_n: d.external_systems["Dataverse/Dynamics 365"]?.count ?? 0,
    db_kinds: join(dbKinds), compose: d.environment.docker_compose.length ? "compose present" : "no compose - skip the MCP",
    cloud: join(cloud),
    ai_kinds: join(d.ai_config.kinds.filter((k) => ["cursor", "clinerules", "copilot", "windsurf", "kiro"].includes(k))), ai_n: d.ai_config.count,
    ai_files: join(aiMd) || join(d.ai_config.files.slice(0, 2)), ai_files_arr: d.ai_config.files.slice(0, 20), ai_md_arr: aiMd,
    ai_missing: "build/test commands, generated paths, external systems - whichever the file lacks",
    build_cmd: d.build.commands.slice(0, 2).join("; ") || "(none inferable)", build_cmd_raw: d.build.commands[0]?.replace(/\s+#.*$/, "") ?? "",
    lint: join((rootLinters.length ? rootLinters : d.lint_format).slice(0, 4)) || "-", lint_arr: d.lint_format, formatter,
    nb_n: langFiles(d, "Jupyter"),
    tf_n: langFiles(d, "HCL/Terraform"), tf_lint: join(d.lint_format.filter((l) => l.startsWith("terraform") || l.startsWith("tflint"))), tf_pair: tfPair,
    doc_pointer: docPointer, readme_kb: Math.round(d.docs.readme_bytes / 102.4) / 10, docs_files: d.docs.docs_files, arch: join(d.docs.architecture_docs.slice(0, 2)) || "none",
    env_kind: envKind,
    php_files: langFiles(d, "PHP"), i18n_dir: i18n?.dir ?? "-", i18n_changes: i18n?.changes ?? 0,
    bin_n: g.tracked_binaries_dll_exe_pdb ?? 0, pkg_n: g.tracked_package_dirs ?? 0, ide_n: g.tracked_ide_junk ?? 0,
    screenshot: join(d.tests.frameworks.filter((t) => t.includes("screenshot"))) || "none found",
    mobile: join(mobile),
    build_systems: buildSystems.join(" + "), build_pair_times: bp?.times ?? 0,
    authors: g.authors_in_clone ?? 0, contrib: join(d.docs.contributing) || "no CONTRIBUTING", contrib_arr: d.docs.contributing,
    llm: join(["OpenAI API", "Anthropic API"].filter((k) => k in d.external_systems)),
    dep_files: dep ? `${base(dep.a)} + ${base(dep.b)}` : "-", dep_times: dep?.times ?? 0,
    containers: join(["PostgreSQL", "Redis", "RabbitMQ/AMQP"].filter((k) => k in d.external_systems)),
    top_langs_arr: d.languages.slice(0, 3).map((l) => l.language),
    pcf_areas_arr: pcfAreas,
    pcf_rule_text: `PCF controls build with ${tick("npm run build")} inside their own folder (${pcfDirs}; run ${tick("npm install")} there first when node_modules is missing); the .NET projects build from the root${win ? ` with ${tick(win.command)}` : " with msbuild"}. Do not mix the two toolchains.`,
  };
}

/** Past this many packages a list in a skill costs more than a Glob for the manifests. */
const WHICH_PACKAGE_MAX = 100;

/** `{name}` → the context's value; an unknown name stays visible, never silently blank. */
export const fill = (text: string, ctx: Record<string, unknown>) => text.replace(/\{([a-z_0-9]+)\}/g, (m, k: string) => (k in ctx ? String(ctx[k]) : m));

function fillParams(params: Record<string, unknown>, ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v && typeof v === "object" && !Array.isArray(v) && "$ctx" in (v as object)) out[k] = ctx[(v as { $ctx: string }).$ctx] ?? null;
    else if (typeof v === "string") out[k] = fill(v, ctx);
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === "string" ? fill(x, ctx) : x));
    else out[k] = v;
  }
  return out;
}

/**
 * An MCP address still holding a `{placeholder}` (the client's org, its
 * region) cannot be delivered as `.mcp.json`: the card says so in its params
 * (`placeholder: true`, `deliverable: false`), and the build writes it as an
 * instruction in the pull request's report instead.
 */
function markPlaceholder(kind: ComponentKind, params: Record<string, unknown>): Record<string, unknown> {
  if (kind !== "mcp" || typeof params.url !== "string" || !/\{[a-z_]+\}/i.test(params.url)) return params;
  return { ...params, placeholder: true, deliverable: false };
}

/* ── applying the rules ───────────────────────────────────────────── */

export function applyRules(profile: RepoProfile, corrections: readonly ProfileCorrection[] = [], rules: Rule[] = loadRules()): RulesOutcome {
  const ctx = ruleContext(profile);
  const fired: RuleFiring[] = [];
  const suppressed: RuleSuppression[] = [];
  for (const r of rules) {
    const facts = factsOf(r.when);
    const hit = corrections.find((c) => facts.some((f) => touches(f, c.path)));
    if (hit) { suppressed.push({ rule: r.id, fact: hit.path, note: hit.note }); continue; }
    let ok: boolean;
    try { ok = evaluate(r.when, profile); } catch (e) { throw new Error(`rule ${r.id}: ${(e as Error).message}`, { cause: e }); }
    if (!ok) continue;
    const reason = fill(r.reason_he, ctx);
    fired.push({
      rule: r.id, signal: r.signal, reason_he: reason,
      components: r.components.filter((c) => !c.when || evaluate(c.when, profile)).map((c) => ({
        key: c.key, kind: c.kind, family: c.family, risk: c.risk, source: "rule", sourceRef: r.id,
        title_he: fill(c.title_he, ctx), what_he: fill(c.what_he, ctx), why_he: c.notRecommended ? fill(c.what_he, ctx) : reason, verifyHow_he: fill(c.verify_he, ctx),
        params: markPlaceholder(c.kind, fillParams(c.params, ctx)), notRecommended: c.notRecommended,
      })),
    });
  }
  return { fired, suppressed, considered: rules.length };
}

/** The stack tags the open marketplace search is keyed by — derived, never a fixed list. */
export function stackTags(d: RepoProfile): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/\s*\(.*\)$/, "").replace(/[^a-z0-9#+.]+/g, "-").replace(/^-|-$/g, "");
  const tags: string[] = [];
  const add = (t: string) => { if (t && !tags.includes(t)) tags.push(t); };
  // What the search is really for comes first: the systems the code talks to, then the frameworks, then how it is built.
  for (const k of Object.keys(d.external_systems)) add(norm(k));
  for (const f of d.frameworks) add(norm(f));
  for (const pm of d.package_managers) add(norm(pm));
  for (const s of d.ci.systems) add(norm(s));
  for (const l of d.languages.slice(0, 3)) add(norm(l.language));
  return tags.filter((t) => !["json", "yaml", "xml", "markdown", "html", "css", "shell", "docker", "oauth-oidc-identity"].includes(t)).slice(0, 16);
}

export const rulesFile = () => path.basename(RULES_PATH);
