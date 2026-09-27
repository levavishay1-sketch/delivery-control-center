import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
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

export type RuleComponent = {
  key: string; kind: ComponentKind; family: ComponentFamily; risk: ComponentRisk;
  title_he: string; what_he: string; verify_he: string; params: Record<string, unknown>; notRecommended?: boolean;
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
  return out.slice(0, 6);
}

export function hotMultiAuthor(d: RepoProfile): { dir: string; changes: number; authors: number } | null {
  if (!d.git.available) return null;
  return d.git.hot_dirs?.find((h) => h.dir !== "." && h.authors >= 10 && h.changes >= 100) ?? null;
}

export const shapes = (d: RepoProfile) => (d.git.repeated_change_shapes ?? []).filter((s) => s.times >= 3 && s.files.length >= 3);

const DEP_FILES = /(go\.mod|go\.sum|package\.json|pnpm-lock|yarn\.lock|uv\.lock|Cargo\.lock|Cargo\.toml|composer\.lock|libs\.versions\.toml|Directory\.Packages\.props|pyproject\.toml|\.csproj$|build\.gradle)/;
export const depBumpShape = (d: RepoProfile) => (d.git.cochange_pairs ?? []).find((p) => DEP_FILES.test(p.a) && DEP_FILES.test(p.b) && p.times >= 8) ?? null;

export const langFiles = (d: RepoProfile, lang: string) => d.languages.filter((l) => l.language === lang).reduce((a, l) => a + l.files, 0);

const BUILD_SYSTEMS = new Set(["maven", "gradle", "cargo", "dotnet", "msbuild", "go", "composer", "turborepo"]);
export const buildSystemsCount = (d: RepoProfile) => d.build.system.filter((s) => BUILD_SYSTEMS.has(s)).length;

const FN: Record<string, { run: (d: RepoProfile, arg?: string) => unknown; facts: string[] }> = {
  gen_dirs: { run: genDirs, facts: ["generated_code"] },
  hot_multi_author: { run: hotMultiAuthor, facts: ["git.hot_dirs"] },
  shapes: { run: shapes, facts: ["git.repeated_change_shapes"] },
  dep_bump_shape: { run: depBumpShape, facts: ["git.cochange_pairs"] },
  lang_files: { run: (d, arg) => langFiles(d, arg ?? ""), facts: ["languages"] },
  build_systems_count: { run: buildSystemsCount, facts: ["build.system"] },
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
  const testCmd = d.ci.commands.find((c) => /\b(test|verify|pytest|phpunit|vitest|jest)\b/.test(c)) ?? (d.tests.frameworks[0] ?? "-");
  const formatterPick = ["@biomejs/biome", "biome", "prettier", "ruff", "black", "spotless", "ktlint", "golangci-lint", "rustfmt/clippy (toolchain pinned)", "php-cs-fixer", "spring-javaformat", "terraform_fmt", "eslint"];
  const formatter = d.lint_format.find((l) => formatterPick.includes(l)) ?? d.lint_format[0] ?? "-";
  const docPointer = d.docs.architecture_docs[0] ?? (d.docs.docs_files ? "docs/" : d.docs.readme ?? "README");
  const envKind = [d.environment.devcontainer ? "devcontainer" : null, d.environment.dockerfile.length ? "Dockerfile" : null, d.environment.docker_compose.length ? "compose" : null].filter(Boolean).join(", ");
  const dbKinds = ["PostgreSQL", "MySQL/MariaDB", "SQL Server"].filter((k) => k in d.external_systems);
  const cloud = ["AWS SDK", "Azure SDK", "GCP SDK"].filter((k) => k in d.external_systems);
  const buildSystems = d.build.system.filter((s) => BUILD_SYSTEMS.has(s));
  const genList = genDirs(d);
  const mobile = d.frameworks.filter((f) => ["android", "flutter/dart", "jetpack-compose", "react-native (sub-package)"].includes(f));
  const pcfAreas = d.frameworks.includes("PowerApps PCF control")
    ? [{ dir: "Pcf", toolchain: "node", command: "npm run build" }, { dir: "CrmEntryPoints", toolchain: "msbuild", command: d.build.commands[0] ?? "msbuild" }]
    : [];
  return {
    gen_dirs: join(genList) || "-", gen_dirs_arr: genList,
    test_files: d.tests.test_files, test_frameworks: join(d.tests.frameworks.slice(0, 3)) || "-", test_frameworks_arr: d.tests.frameworks,
    test_cmd: testCmd, test_dirs: join(d.tests.test_dirs.map((t) => t[0])) || "-", test_dirs_arr: d.tests.test_dirs.map((t) => t[0]),
    ci_systems: join(d.ci.systems), ci_systems_arr: d.ci.systems, ci_n: d.ci.workflow_count ?? d.ci.workflows.length, ci_cmds: d.ci.commands.slice(0, 3).join("; "), ci_cmds_arr: d.ci.commands.slice(0, 10),
    mono_ws: d.monorepo.workspaces.slice(0, 2).map(String).join("; ") || "workspace", mono_n: d.monorepo.package_count ?? "?", mono_packages_arr: d.monorepo.packages.slice(0, 40),
    hot_dir: hot?.dir ?? "-", hot_changes: hot?.changes ?? 0, hot_authors: hot?.authors ?? 0,
    shape_n: sh.length, shape_example: sh[0] ? `${sh[0].files.slice(0, 4).map(base).join(" + ")} (${sh[0].times}x)` : "-", shapes_arr: sh.slice(0, 5),
    sec_outside: d.secrets.outside_tests, sec_total: d.secrets.total, sec_kinds: join(Object.keys(d.secrets.by_kind)), sec_files_outside: join(secOut.slice(0, 3)), sec_files_outside_arr: secOut.slice(0, 25),
    sens_n: d.secrets.sensitive_files.length, sens_sample: join(d.secrets.sensitive_files.slice(0, 3).map(base)), sens_files_arr: d.secrets.sensitive_files,
    sln_n: d.windows_build.sln, snk_n: d.windows_build.snk, tfm: join(tfms.slice(0, 2)) || "-", sln_first: d.build.commands.find((c) => /msbuild /.test(c))?.replace(/^msbuild\s+(\S+).*$/, "$1") ?? "",
    dv_n: d.external_systems["Dataverse/Dynamics 365"]?.count ?? 0,
    db_kinds: join(dbKinds), compose: d.environment.docker_compose.length ? "compose present" : "no compose - skip the MCP",
    cloud: join(cloud),
    ai_kinds: join(d.ai_config.kinds.filter((k) => ["cursor", "clinerules", "copilot", "windsurf", "kiro"].includes(k))), ai_n: d.ai_config.count,
    ai_files: join(aiMd) || join(d.ai_config.files.slice(0, 2)), ai_files_arr: d.ai_config.files.slice(0, 20), ai_md_arr: aiMd,
    ai_missing: "build/test commands, generated paths, external systems - whichever the file lacks",
    build_cmd: d.build.commands.slice(0, 2).join("; ") || "(none inferable)", build_cmd_raw: d.build.commands[0]?.replace(/\s+#.*$/, "") ?? "",
    lint: join(d.lint_format.slice(0, 4)) || "-", lint_arr: d.lint_format, formatter,
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
  };
}

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
      components: r.components.map((c) => ({
        key: c.key, kind: c.kind, family: c.family, risk: c.risk, source: "rule", sourceRef: r.id,
        title_he: fill(c.title_he, ctx), what_he: fill(c.what_he, ctx), why_he: c.notRecommended ? fill(c.what_he, ctx) : reason, verifyHow_he: fill(c.verify_he, ctx),
        params: fillParams(c.params, ctx), notRecommended: c.notRecommended,
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
