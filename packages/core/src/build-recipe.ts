/**
 * A build check without AI, for the common case: given a component name
 * (from the breakdown's `compiledComponents`), find its project file in the
 * repository and run the real build command directly — no model call, no
 * guessing the tool from scratch on every run. Falls back to `null` for
 * anything it does not recognize; the caller keeps the existing AI-driven
 * check for that case. First step of the wishlist item "make the build
 * check deterministic" — small on purpose: extend the detector list, not
 * the mechanism, when a new ecosystem shows up.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type BuildRecipe = { tool: string; command: string; args: string[]; cwd: string };
export type ResolveResult = { component: string; recipe: BuildRecipe } | { component: string; recipe: null; reason: string };

const SKIP_DIRS = new Set(["node_modules", ".git", "bin", "obj", "dist", "build", ".vs"]);

/** Every file under `dir` whose name matches `fileName`, case-insensitively. Skips build output and VCS dirs. */
function findFiles(dir: string, fileName: string, depth = 8): string[] {
  const out: string[] = [];
  const want = fileName.toLowerCase();
  const walk = (d: string, left: number) => {
    if (left <= 0) return;
    let entries: import("node:fs").Dirent[];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(d, e.name), left - 1); }
      else if (e.name.toLowerCase() === want) out.push(path.join(d, e.name));
    }
  };
  walk(dir, depth);
  return out;
}

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

/** One component: find its project file and decide the real command to build it — or say why not. */
export function resolveBuildRecipe(dir: string, component: string): ResolveResult {
  const csprojes = findFiles(dir, `${component}.csproj`);
  if (csprojes.length === 1) {
    const file = csprojes[0]!;
    const xml = readFileSync(file, "utf8");
    const hasPackagesConfig = existsSync(path.join(path.dirname(file), "packages.config"));
    const kind = classifyCsproj(xml, hasPackagesConfig);
    if (kind === "sdk") return { component, recipe: { tool: "dotnet", command: "dotnet", args: ["build", file], cwd: dir } };
    const msbuild = findClassicMsbuild();
    if (!msbuild) return { component, recipe: null, reason: `${component} הוא פרויקט .NET ישן (ToolsVersion/packages.config) שצריך MSBuild קלאסי — לא נמצא במחשב הזה` };
    return { component, recipe: { tool: "msbuild", command: msbuild, args: [file, "-nologo", "-verbosity:quiet"], cwd: dir } };
  }
  if (csprojes.length > 1) return { component, recipe: null, reason: `כמה קבצי .csproj בשם ${component} — לא ברור איזה` };

  const pkgJson = findFiles(dir, "package.json").find((f) => JSON.parse(readFileSync(f, "utf8"))?.name === component);
  if (pkgJson) {
    const pkg = JSON.parse(readFileSync(pkgJson, "utf8")) as { scripts?: Record<string, string> };
    if (pkg.scripts?.build) return { component, recipe: { tool: "npm", command: "npm", args: ["run", "build"], cwd: path.dirname(pkgJson) } };
    return { component, recipe: null, reason: `${component} (package.json) אין לו script בשם build` };
  }
  return { component, recipe: null, reason: `לא נמצא קובץ פרויקט בשם ${component}` };
}

/** Runs one recipe directly — no AI, no shell. Captures combined output and the exit code. */
export function runBuildRecipe(recipe: BuildRecipe, timeoutMs = 600_000): Promise<{ passed: boolean; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(recipe.command, recipe.args, { cwd: recipe.cwd, windowsHide: true });
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

/** Every compiled component of a task — recipes for all of them, or null the moment one is not recognized (the caller falls back to the AI check for the whole build, not a mix). */
export function resolveAllBuildRecipes(dir: string, components: string[]): { recipes: BuildRecipe[] } | { recipes: null; reason: string } {
  if (!components.length) return { recipes: null, reason: "אין compiledComponents למשימה" };
  const results = components.map((c) => resolveBuildRecipe(dir, c));
  const missed = results.find((r): r is { component: string; recipe: null; reason: string } => r.recipe === null);
  if (missed) return { recipes: null, reason: missed.reason };
  return { recipes: results.map((r) => r.recipe!) };
}
