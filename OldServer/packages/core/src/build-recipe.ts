/**
 * The build check, without AI, for every task the same way: build the
 * projects that hold the files the task actually changed, and the compiled
 * components the breakdown named for it — with the real command, no model
 * call. A task that changed no compiled file has nothing to build, and says
 * so; a changed source file DCC does not know how to build is said plainly
 * too, rather than handed to a model to guess. Extend the detectors here,
 * not the mechanism, when a new ecosystem shows up.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type BuildRecipe = { tool: string; command: string; args: string[]; cwd: string; project: string };

export type BuildPlan =
  | { kind: "build"; recipes: BuildRecipe[]; notes: string[] }
  | { kind: "nothing"; reason: string }
  | { kind: "cannot"; reason: string };

const DOTNET_PROJECT = /\.(csproj|vbproj|fsproj)$/i;
/** Source that only means something once compiled — a change to it outside any known project cannot be shown to build. */
const MUST_COMPILE = /\.(cs|vb|fs|java|kt|scala|go|rs|c|cc|cpp|cxx|h|hpp|swift)$/i;
const dirOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

/**
 * SDK-style (`<Project Sdk="...">`, `dotnet build` works directly) vs legacy
 * (`ToolsVersion` attribute, or a `packages.config` beside it — needs the
 * classic desktop MSBuild, which `dotnet build` cannot load pre-.NET-Core
 * MSBuild tasks under, such as ILMerge-based CRM plugin builds).
 */
export function classifyCsproj(xml: string, hasPackagesConfig: boolean): "sdk" | "legacy" {
  if (/<Project\s+Sdk=/i.test(xml)) return "sdk";
  if (/ToolsVersion\s*=/i.test(xml) || hasPackagesConfig) return "legacy";
  return "sdk";
}

/** Where the classic desktop MSBuild lives — an env override first, then the common Build Tools / VS install paths. */
export function findClassicMsbuild(): string | null {
  if (process.env.DCC_MSBUILD_PATH && existsSync(process.env.DCC_MSBUILD_PATH)) return process.env.DCC_MSBUILD_PATH;
  const roots = [
    "C:\\Program Files\\Microsoft Visual Studio\\2022",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022",
  ];
  const editions = ["BuildTools", "Community", "Professional", "Enterprise"];
  for (const root of roots) for (const ed of editions) {
    const p = path.join(root, ed, "MSBuild", "Current", "Bin", "amd64", "MSBuild.exe");
    if (existsSync(p)) return p;
  }
  return null;
}

type PlanInput = {
  /** Where the branch is checked out when the build runs. */
  dir: string;
  /** Every tracked file on the task's branch, repository-relative with "/". */
  files: string[];
  /** What the task's own commits changed, same form. */
  changed: string[];
  /** The compiled components the breakdown named — the projects the change is shipped in (e.g. a plugin that merges a changed library). */
  declared: string[];
  /** A tracked file's content on the branch. */
  read: (rel: string) => Promise<string | null>;
  msbuild: string | null;
};

const buildScript = async (read: PlanInput["read"], rel: string) => {
  try { return !!(JSON.parse((await read(rel)) ?? "{}") as { scripts?: Record<string, string> }).scripts?.build; } catch { return false; }
};

/** The command that builds one project file — or why it cannot be built here. */
async function recipeFor(input: PlanInput, rel: string): Promise<BuildRecipe | string> {
  const abs = path.join(input.dir, rel);
  if (rel.toLowerCase().endsWith("package.json")) return { tool: "npm", command: "npm", args: ["run", "build"], cwd: path.dirname(abs), project: rel };
  const hasPackagesConfig = input.files.includes(`${dirOf(rel) ? `${dirOf(rel)}/` : ""}packages.config`);
  if (classifyCsproj((await input.read(rel)) ?? "", hasPackagesConfig) === "sdk") return { tool: "dotnet", command: "dotnet", args: ["build", abs], cwd: input.dir, project: rel };
  if (!input.msbuild) return `${rel} הוא פרויקט .NET ישן (ToolsVersion/packages.config) שצריך MSBuild קלאסי — לא נמצא במחשב הזה`;
  return { tool: "msbuild", command: input.msbuild, args: [abs, "-nologo", "-verbosity:quiet"], cwd: input.dir, project: rel };
}

/**
 * What building this task means. The project of each changed file is the
 * nearest folder above it with a project file (.csproj/.vbproj/.fsproj, or a
 * package.json with a build script); the named components are found by name.
 */
export async function planBuild(input: PlanInput): Promise<BuildPlan> {
  if (!input.changed.length) return { kind: "nothing", reason: "המשימה לא שינתה אף קובץ" };
  const byDir = new Map<string, string[]>();
  for (const f of input.files) {
    if (!DOTNET_PROJECT.test(f) && !/(^|\/)package\.json$/i.test(f)) continue;
    const d = dirOf(f);
    byDir.set(d, [...(byDir.get(d) ?? []), f]);
  }

  const projects: string[] = [];
  const notes: string[] = [];
  const add = (p: string) => { if (!projects.includes(p)) projects.push(p); };

  for (const file of input.changed) {
    let found: string | null = null;
    let settled = false;
    for (let d = dirOf(file); !settled; d = dirOf(d)) {
      const here = byDir.get(d) ?? [];
      const dotnet = here.filter((f) => DOTNET_PROJECT.test(f));
      if (dotnet.length > 1) return { kind: "cannot", reason: `בתיקייה ${d || "/"} יש כמה קבצי פרויקט (${dotnet.join(", ")}) — לא ברור לאיזה מהם ${file} שייך` };
      if (dotnet.length === 1) { found = dotnet[0]!; settled = true; break; }
      const pkg = here.find((f) => /package\.json$/i.test(f));
      // A package without a build script is not compiled — its files have nothing to build.
      if (pkg) { if (await buildScript(input.read, pkg)) found = pkg; settled = true; break; }
      if (!d) break;
    }
    if (found) add(found);
    else if (!settled && MUST_COMPILE.test(file)) return { kind: "cannot", reason: `DCC לא מזהה איך לבנות את ${file} — הוא לא בתוך פרויקט שהוא מכיר (.csproj / package.json)` };
  }

  for (const name of input.declared) {
    const dotnet = input.files.filter((f) => DOTNET_PROJECT.test(f) && path.posix.basename(f).replace(DOTNET_PROJECT, "").toLowerCase() === name.toLowerCase());
    if (dotnet.length > 1) return { kind: "cannot", reason: `כמה קבצי פרויקט בשם ${name} (${dotnet.join(", ")}) — לא ברור איזה לבנות` };
    if (dotnet.length === 1) { add(dotnet[0]!); continue; }
    let pkg: string | null = null;
    for (const f of input.files.filter((x) => /(^|\/)package\.json$/i.test(x))) {
      try { if ((JSON.parse((await input.read(f)) ?? "{}") as { name?: string }).name === name) { pkg = f; break; } } catch { /* not JSON */ }
    }
    if (pkg && (await buildScript(input.read, pkg))) add(pkg);
    else notes.push(`הרכיב ${name} שהוגדר למשימה לא נמצא במאגר כפרויקט שנבנה — לא נבנה`);
  }

  if (!projects.length) return { kind: "nothing", reason: "הקבצים שהשתנו לא שייכים לאף פרויקט שמתקמפל (למשל הגדרות או תיעוד)" };
  const recipes: BuildRecipe[] = [];
  for (const p of projects) {
    const r = await recipeFor(input, p);
    if (typeof r === "string") return { kind: "cannot", reason: r };
    recipes.push(r);
  }
  return { kind: "build", recipes, notes };
}

/** The plan as a person reads it before running it: the exact commands, or why there are none. */
export function describeBuildPlan(plan: BuildPlan): string {
  if (plan.kind === "nothing") return `אין מה לבנות: ${plan.reason}`;
  if (plan.kind === "cannot") return `אי אפשר לבנות כאן: ${plan.reason}`;
  return [...plan.recipes.map((r) => `${r.command} ${r.args.join(" ")}`), ...plan.notes.map((n) => `(${n})`)].join("\n");
}

/** Runs one recipe directly — no AI. Captures combined output and the exit code. */
export function runBuildRecipe(recipe: BuildRecipe, timeoutMs = 600_000): Promise<{ passed: boolean; out: string }> {
  return new Promise((resolve) => {
    // npm is a .cmd on Windows, which Node only starts through a shell; its arguments here are fixed words.
    const p = spawn(recipe.command, recipe.args, { cwd: recipe.cwd, windowsHide: true, shell: recipe.tool === "npm" && process.platform === "win32" });
    let out = "";
    let done = false;
    const finish = (r: { passed: boolean; out: string }) => { if (!done) { done = true; clearTimeout(killer); resolve(r); } };
    const killer = setTimeout(() => { p.kill("SIGKILL"); finish({ passed: false, out: `${out}\n\n(נעצר — לא הסתיים תוך ${Math.round(timeoutMs / 1000)}s)` }); }, timeoutMs);
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (out += d));
    p.on("error", (e) => finish({ passed: false, out: `${recipe.command} לא נמצא: ${e.message}` }));
    p.on("close", (code) => finish({ passed: code === 0, out: out.trim() }));
  });
}
