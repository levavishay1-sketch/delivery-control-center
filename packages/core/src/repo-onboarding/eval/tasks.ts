import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluate, fill, genDirs, ruleContext, shapes, type Condition } from "../rules.ts";
import type { ComponentFamily, ComponentKind, DiscoveredProcess, FailureKind, RepoProfile } from "../types.ts";

/**
 * The measurement bank (`tasks.json`) turned into the tasks one repository
 * gets: chosen by conditions on the profile, filled from it, every grader's
 * `…From` reference resolved to concrete paths and patterns — so the graders
 * (`graders.ts`) never see the profile, and a test can hand them a task as
 * data. Pure: no git, no model, no database.
 */

export type EvalArm = "with" | "without";
export const EVAL_ARMS: readonly EvalArm[] = ["without", "with"];

/** Which components a task measures: by key, key prefix, kind, family, or the files they wrote (globs, `*` and `**`). */
export type Exercises = { keys?: string[]; prefixes?: string[]; kinds?: ComponentKind[]; families?: ComponentFamily[]; files?: string[] };

/** One code grader, resolved (no `…From` left). `armOnly` — counted in that arm only; `when` — counted only when the flag held for this repository. */
export type GraderSpec = {
  type: "files_untouched" | "files_changed_within" | "no_secret_in_output" | "command_ran" | "claim_requires_evidence" | "tool_blocked" | "skill_used" | "diff_lines_max" | "must_mention" | "must_not_claim" | "diff_contains" | "new_files_under" | "commit_excludes";
  armOnly?: EvalArm;
  when?: { ctx: string; is: boolean };
  /** Recorded and shown, and a block it sees is the safety component's credit — but it never fails the task. */
  informative?: boolean;
  /** `command_ran` also passes when the answer says one of these instead — an honest "cannot run here" is as good as the run. */
  orMention?: string[];
  paths?: string[]; path?: string; pattern?: string; cwd?: string; negate?: boolean;
  claims?: string[]; evidence?: string; any?: string[]; max?: number; filesMax?: number; min?: number; patterns?: string[];
};

export type EvalTask = {
  key: string;
  kind: "knowledge" | "action";
  title_he: string;
  prompt: string;
  allowsEdits: boolean;
  exercises: Exercises;
  graders: GraderSpec[];
  /** A repository-grounded judge decides what the code cannot; `facts` are hints, never the truth. */
  judge: { expect: string; facts: string[] } | null;
  from: string;
};

type RawGrader = Record<string, unknown> & { type: GraderSpec["type"]; armOnly?: EvalArm; when?: { ctx: string; is: boolean } };
type Template = {
  key: string; kind: "knowledge" | "action"; priority: number; when?: Condition; title_he: string; prompt: string; allowsEdits?: boolean;
  exercises?: Exercises; graders: RawGrader[]; judge?: { expect: string; factsFrom?: string };
};

const FILE = fileURLToPath(new URL("./tasks.json", import.meta.url));
let templates: Template[] | null = null;
export const loadEvalTemplates = () => (templates ??= (JSON.parse(readFileSync(FILE, "utf8")) as { tasks: Template[] }).tasks);

export const MIN_EVAL_TASKS = 6;
/** The whole bank fits a rich repository (Trade fires 17); a cap only guards against a bank that grows. */
export const MAX_EVAL_TASKS = 18;

/* ── the context the bank is filled from ─────────────────────────── */

type Layout = { model_dirs?: string[]; node_packages?: string[]; unit_groups?: { parent: string; members: string[] }[]; small_source_files?: string[] };
type Tools = Record<string, string | null>;
type ProfilePlus = RepoProfile & { layout?: Layout; environment: RepoProfile["environment"] & { tools?: Tools }; tests: RepoProfile["tests"] & { projects?: string[] }; generated_code: RepoProfile["generated_code"] & { header_files?: { path: string; lines: number }[] } };

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
const base = (p: string) => norm(p).split("/").pop() ?? p;

/** Which test runner the tools on this host offer for the frameworks found; null when none. */
function testRunnerHere(d: ProfilePlus): string | null {
  const tools = d.environment.tools ?? null;
  const fw = d.tests.frameworks.map((f) => f.toLowerCase());
  const has = (k: string) => (tools ? !!tools[k] : true);
  if (fw.some((f) => /mstest|xunit|nunit/.test(f))) return has("vstest.console") ? "vstest.console" : has("dotnet") ? "dotnet test" : null;
  if (fw.some((f) => /vitest|jest|mocha|playwright|cypress|ava|tap/.test(f))) return has("npm") ? "npm test" : null;
  if (fw.some((f) => /pytest|unittest/.test(f))) return has("pytest") || has("python") ? "pytest" : null;
  if (fw.some((f) => /junit|kotest|spock/.test(f))) return has("gradle") || has("gradlew") ? "gradle test" : has("mvn") ? "mvn test" : null;
  if (fw.some((f) => /go test|testing/.test(f))) return has("go") ? "go test" : null;
  if (fw.some((f) => /cargo/.test(f))) return has("cargo") ? "cargo test" : null;
  if (fw.some((f) => /phpunit/.test(f))) return "phpunit";
  return fw.length ? (tools ? null : "unknown") : null;
}

function dependencyProbe(d: ProfilePlus): { name: string; target: string; pattern: string } | null {
  const pm = d.package_managers.map((p) => p.toLowerCase());
  const pkgs = d.monorepo.packages.map(norm);
  const firstDotnet = pkgs.find((p) => !/test/i.test(p)) ?? pkgs[0];
  if (pm.some((p) => /nuget|dotnet|paket/.test(p))) return { name: "Newtonsoft.Json", target: firstDotnet ?? "the main project", pattern: "HintPath|PackageReference|packages\\.config|Newtonsoft" };
  if (pm.some((p) => /npm|pnpm|yarn|bun/.test(p))) return { name: "lodash", target: d.layout?.node_packages?.[0] ?? pkgs[0] ?? "the root package.json", pattern: "\"dependencies\"|\"devDependencies\"|lodash" };
  if (pm.some((p) => /pip|uv|poetry|pipenv|conda/.test(p))) return { name: "requests", target: "the project (pyproject.toml or requirements)", pattern: "requests" };
  if (pm.some((p) => /gradle|maven/.test(p))) return { name: "com.google.guava:guava", target: pkgs[0] ?? "the main module", pattern: "guava" };
  // `cargo` before `go`, and `go` anchored: "cargo" contains "go" (a Rust repository was asked for a Go module in the first research run).
  if (pm.some((p) => /cargo/.test(p))) return { name: "anyhow", target: pkgs.find((p) => /\bCargo\.toml$/i.test(p) || !/test|bench|example|stress/i.test(p)) ?? pkgs[0] ?? "the crate", pattern: "anyhow" };
  if (pm.some((p) => /^go(\s|$)|go modules|go\.mod/.test(p))) return { name: "github.com/google/uuid", target: "the module", pattern: "google/uuid" };
  if (pm.some((p) => /composer/.test(p))) return { name: "monolog/monolog", target: "the project", pattern: "monolog" };
  return null;
}

/** Everything a prompt or a grader of the bank can be filled from — the rules' context plus the bank's own facts. */
export function evalContext(profile: RepoProfile, processes: readonly DiscoveredProcess[] = []): Record<string, unknown> {
  const d = profile as ProfilePlus;
  const ctx = ruleContext(profile);
  const genDirList = genDirs(profile);
  const headerFiles = (d.generated_code.header_files ?? []).map((h) => norm(h.path));
  const genPaths = [...genDirList.map(norm), ...headerFiles].filter((x, i, a) => a.indexOf(x) === i);
  const genFile = headerFiles[0] ?? d.generated_code.header_sample.map(norm).find((p) => /\.\w+$/.test(p)) ?? genDirList[0] ?? "";
  const secretFile = d.secrets.files.filter((f) => !/(test|spec|fixture|snapshot)/i.test(f.path)).map((f) => norm(f.path))[0] ?? d.secrets.files.map((f) => norm(f.path))[0] ?? "";
  const layout: Layout = d.layout ?? {};
  // "Add a field" needs a folder of contracts or models; a folder of enums or option sets has nothing to add a field to (Trade's first candidate was Enums, 108 enums).
  const modelCandidates = (layout.model_dirs ?? []).map(norm);
  const modelDir = modelCandidates.find((d) => !/(^|\/)(enums?|optionsets?|constants?)$/i.test(d)) ?? modelCandidates[0] ?? "";
  const nodePackage = layout.node_packages?.[0] ? norm(layout.node_packages[0]) : "";
  const group = layout.unit_groups?.find((g) => g.members.length >= 3) ?? null;
  const exampleUnit = group ? norm(group.members[0]!) : "";
  const typoFile = layout.small_source_files?.[0] ? norm(layout.small_source_files[0]) : "";
  const dep = dependencyProbe(d);
  const runner = testRunnerHere(d);
  const proc = [...processes].filter((p) => !p.impossible && p.steps.length >= 2).sort((a, b) => b.steps.length - a.steps.length)[0] ?? null;
  return {
    ...ctx,
    gen_file: genFile, gen_paths_arr: genPaths,
    model_dir: modelDir, model_dir_arr: modelDir ? [modelDir] : [],
    node_package: nodePackage, node_package_arr: nodePackage ? [nodePackage] : [],
    secret_file: secretFile,
    example_unit: exampleUnit, example_unit_parent: group ? norm(group.parent) : "",
    typo_file: typoFile, typo_file_arr: typoFile ? [typoFile] : [],
    dep_name: dep?.name ?? "", dep_target: dep?.target ?? "", dep_diff_pattern: dep?.pattern ?? "",
    test_runner: runner ?? "", test_runnable: !!runner && (d.tests.projects ? d.tests.projects.length > 0 : true),
    process_title: proc?.title ?? "", process_key: proc?.key ?? "",
    process_steps: proc ? proc.steps.map((s, i) => `Step ${i + 1}: ${s.title} — ${s.what}`) : [],
    has_processes: !!proc,
  };
}

/* ── choosing and filling ─────────────────────────────────────────── */

function holds(cond: Condition | undefined, profile: RepoProfile, ctx: Record<string, unknown>): boolean {
  if (!cond) return true;
  if ("fn" in cond && cond.fn === "has_processes") return !!ctx.has_processes === (cond.truthy ?? true);
  if ("path" in cond && cond.path.startsWith("layout.")) {
    // The layout block is the bank's own fact family; a diagnosis written before it existed simply has none.
    const layout = ((profile as ProfilePlus).layout ?? {}) as Record<string, unknown>;
    const val = layout[cond.path.slice("layout.".length)];
    const empty = val == null || (Array.isArray(val) && val.length === 0);
    if (cond.empty !== undefined) return empty === cond.empty;
    if (cond.truthy !== undefined) return !empty === cond.truthy;
    return !empty;
  }
  return evaluate(cond, profile);
}

const asStringArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === "string" && v ? [v] : []);

function resolveGrader(raw: RawGrader, ctx: Record<string, unknown>): GraderSpec {
  const g: GraderSpec = { type: raw.type };
  if (raw.armOnly) g.armOnly = raw.armOnly;
  if (raw.when) g.when = raw.when;
  if (raw.informative === true) g.informative = true;
  if (Array.isArray(raw.orMention)) g.orMention = raw.orMention.map(String);
  for (const k of ["negate", "claims", "evidence", "any", "max", "filesMax", "min", "patterns", "pattern", "path", "cwd", "paths"] as const) {
    if (raw[k] !== undefined) (g as Record<string, unknown>)[k] = raw[k];
  }
  if (typeof raw.pathsFrom === "string") g.paths = asStringArray(ctx[raw.pathsFrom]);
  if (typeof raw.pathFrom === "string") g.path = String(ctx[raw.pathFrom] ?? "");
  if (typeof raw.cwdFrom === "string") g.cwd = String(ctx[raw.cwdFrom] ?? "");
  if (typeof raw.patternFrom === "string") g.pattern = String(ctx[raw.patternFrom] ?? "");
  if (typeof g.pattern === "string" && g.pattern) g.pattern = fill(g.pattern, ctx);
  return g;
}

/** A grader that resolved to nothing to check (no generated paths, no pattern) is dropped, never a free pass or a sure failure. */
const usable = (g: GraderSpec): boolean => {
  switch (g.type) {
    case "files_untouched": case "files_changed_within": return (g.paths?.length ?? 0) > 0;
    case "new_files_under": return !!g.path;
    case "diff_contains": return !!g.pattern;
    case "command_ran": return !!g.pattern && (g.cwd === undefined || g.cwd !== "");
    default: return true;
  }
};

/** The tasks this repository gets: the bank filtered by the profile, filled, and capped. */
export function evalTasksFor(profile: RepoProfile, processes: readonly DiscoveredProcess[] = [], opts: { max?: number } = {}): EvalTask[] {
  const ctx = evalContext(profile, processes);
  const out: EvalTask[] = [];
  for (const t of [...loadEvalTemplates()].sort((a, b) => a.priority - b.priority)) {
    if (!holds(t.when, profile, ctx)) continue;
    const prompt = fill(t.prompt, ctx);
    // A prompt still holding a `{name}` had no fact to fill it — the task cannot be asked honestly here.
    if (/\{[a-z_0-9]+\}/.test(prompt)) continue;
    const graders = t.graders.map((g) => resolveGrader(g, ctx)).filter(usable);
    const judge = t.judge ? { expect: t.judge.expect, facts: t.judge.factsFrom ? asStringArray(ctx[t.judge.factsFrom]) : [] } : null;
    if (!graders.length && !judge) continue;
    out.push({
      key: t.key, kind: t.kind, title_he: fill(t.title_he, ctx), prompt, allowsEdits: !!t.allowsEdits,
      exercises: { ...(t.exercises ?? {}), files: (t.exercises?.files ?? []).map((f) => fill(f, ctx)).filter((f) => !/\{[a-z_0-9]+\}/.test(f)) },
      graders, judge, from: "bank",
    });
  }
  return out.slice(0, opts.max ?? MAX_EVAL_TASKS);
}

/** The failure a grader points at when it fails — each kind names a kind of component (see `FAILURE_TO_KIND`). */
export const GRADER_FAILURE: Record<GraderSpec["type"], FailureKind> = {
  files_untouched: "rule_violated", files_changed_within: "missing_fact", no_secret_in_output: "rule_violated",
  command_ran: "missing_fact", claim_requires_evidence: "cannot_verify", tool_blocked: "rule_violated", skill_used: "missing_fact",
  diff_lines_max: "rule_violated", must_mention: "missing_fact", must_not_claim: "cannot_verify", diff_contains: "missing_fact",
  new_files_under: "bad_judgment", commit_excludes: "rule_violated",
};

/** Does a component fall under a task's `exercises`? */
export function exercised(task: Pick<EvalTask, "exercises">, c: { key: string; kind: ComponentKind; family: ComponentFamily; files: readonly string[] }): boolean {
  const e = task.exercises;
  if (e.keys?.includes(c.key)) return true;
  if (e.prefixes?.some((p) => c.key.startsWith(p))) return true;
  if (e.kinds?.includes(c.kind)) return true;
  if (e.families?.includes(c.family)) return true;
  if (e.files?.length && c.files.some((f) => e.files!.some((g) => globMatch(g, f)))) return true;
  return false;
}

/** `*` = within one segment, `**` = across segments; case-insensitive, slashes normalised. */
export function globMatch(glob: string, file: string): boolean {
  let re = "";
  const g = norm(glob);
  for (let i = 0; i < g.length; i++) {
    const ch = g[i]!;
    if (ch === "*") {
      if (g[i + 1] === "*") { i++; if (g[i + 1] === "/") { i++; re += "(?:.*/)?"; } else re += ".*"; }
      else re += "[^/]*";
    } else re += /[.+^${}()|[\]\\?]/.test(ch) ? `\\${ch}` : ch;
  }
  return new RegExp(`^${re}$`, "i").test(norm(file));
}

export { base as baseName, norm as normPath };
export const isKnowledge = (t: EvalTask) => t.kind === "knowledge";
export const shapesFor = shapes;
