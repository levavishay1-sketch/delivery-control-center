import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { runScc, SccNotAvailableError } from "./scc.ts";
import type { BuildSystemSignal, CiSignal, FrameworkSignal, IgnoredPathSignal, LanguageSignal, RepositoryProfile, TestSignal } from "./types.ts";

/**
 * Deterministic repository scanner (spec §9/§34 Phase 1) — pure
 * filesystem walk plus one `scc` subprocess call, NO Claude call, NOT
 * full comprehension. Produces just enough signal (languages/build
 * systems/tests/CI/frameworks/docs, plus the same junk-path detection the
 * old flow's step 2 used) for later stages to decide where to look, not
 * what everything means.
 *
 * Language stats come from `scc` (`scc.ts`, github.com/boyter/scc, MIT) —
 * real per-language lines-of-code and complexity, not a bare file tally.
 * `scc` is assumed ambient on PATH (same model as `gh` elsewhere in this
 * codebase); when it's missing, this falls back to the walk's own
 * extension-based file counting (`SOURCE_EXT_LANGUAGE` below) so a
 * machine without `scc` installed never fails onboarding over it — just
 * loses the lines/complexity detail and gets a warning saying so.
 *
 * Everything else (build-system manifests, CI config, docs/README,
 * test-dir detection, and the `package.json`/`*.csproj` content-sniffing
 * for framework signals) is still this file's own lightweight walk — scc
 * only counts code, it has no concept of any of that.
 *
 * The junk-dir/extension list is the one Read-deny suggestion source for
 * the pipeline (the retired `repo-ai/permissions.ts` copy is gone).
 */

export const KNOWN_JUNK_DIR_NAMES = [
  "bin", "obj", "dist", "build", "out", "target",
  "node_modules", "vendor", ".git", ".next", ".nuxt", "__pycache__",
  ".venv", "venv", ".gradle", ".terraform",
];
const KNOWN_JUNK_EXTENSIONS = ["dll", "pdb", "exe", "so", "dylib"];

/** Dot-directories we deliberately DO recurse into, despite the general
 *  "skip dot-dirs" rule below — both hold CI definitions worth detecting. */
const DOT_DIRS_TO_SCAN = new Set([".github", ".circleci"]);

const BUILD_MANIFEST_BY_NAME: Record<string, string> = {
  "package.json": "npm", "pom.xml": "maven", "requirements.txt": "pip", "Pipfile": "pipenv",
  "Gemfile": "bundler", "go.mod": "go", "build.gradle": "gradle", "build.gradle.kts": "gradle",
  "Dockerfile": "docker", "Cargo.toml": "cargo", "composer.json": "composer",
};
const BUILD_MANIFEST_BY_EXT: Record<string, string> = { sln: "dotnet-solution", csproj: "dotnet-project", fsproj: "dotnet-project", vbproj: "dotnet-project" };

const TEST_DIR_NAMES = new Set(["test", "tests", "__tests__", "spec"]);
/** Fallback-only now that `scc` (see module doc) owns language detection
 *  when it's available — this stays as the degraded path for a machine
 *  without `scc` on PATH, file-count-only, no lines/complexity. */
const SOURCE_EXT_LANGUAGE: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript", py: "Python", java: "Java",
  cs: "C#", go: "Go", php: "PHP", rb: "Ruby", rs: "Rust", kt: "Kotlin", swift: "Swift", c: "C", cpp: "C++",
};
const CI_FILE_SIGNALS: Record<string, string> = {
  "azure-pipelines.yml": "azure-devops", ".gitlab-ci.yml": "gitlab-ci", "Jenkinsfile": "jenkins",
};
const NPM_FRAMEWORK_DEPS: Record<string, string> = {
  next: "Next.js", react: "React", vue: "Vue", "@angular/core": "Angular", express: "Express",
  "@nestjs/core": "NestJS", svelte: "Svelte",
};

const MAX_DEPTH = 6;
/** Skip content-sniffing (package.json/*.csproj) past this size — a
 *  deterministic scan must never risk reading a huge file. */
const MAX_SNIFF_BYTES = 200_000;

export async function scanRepository(dir: string, scannedCommitSha: string): Promise<RepositoryProfile> {
  const ignoredDirs = new Set<string>();
  const ignoredExts = new Set<string>();
  const buildSystems: BuildSystemSignal[] = [];
  const testDirsSeen = new Set<string>();
  const testSignals: TestSignal[] = [];
  const ciSignals: CiSignal[] = [];
  const docsPaths: string[] = [];
  const languageCounts = new Map<string, number>();
  const frameworkSignals: FrameworkSignal[] = [];
  const seenFrameworks = new Set<string>();
  let fileCount = 0;
  let dirCount = 0;
  let maxDepthHit = false;

  const rel = (full: string) => path.relative(dir, full).split(path.sep).join("/");

  const sniffPackageJson = (full: string) => {
    try {
      if (statSync(full).size > MAX_SNIFF_BYTES) return;
      const pkg = JSON.parse(readFileSync(full, "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [depName, label] of Object.entries(NPM_FRAMEWORK_DEPS)) {
        if (depName in deps && !seenFrameworks.has(label)) { seenFrameworks.add(label); frameworkSignals.push({ name: label, evidence: rel(full) }); }
      }
    } catch { /* not valid/readable JSON — skip, deterministic scan must never throw */ }
  };

  const sniffCsproj = (full: string) => {
    try {
      if (statSync(full).size > MAX_SNIFF_BYTES) return;
      const text = readFileSync(full, "utf8");
      const add = (label: string) => { if (!seenFrameworks.has(label)) { seenFrameworks.add(label); frameworkSignals.push({ name: label, evidence: rel(full) }); } };
      if (/Microsoft\.Xrm\.Sdk/i.test(text)) add("Dynamics 365");
      if (/Microsoft\.AspNetCore/i.test(text)) add("ASP.NET Core");
      const netVer = text.match(/<TargetFramework>net(\d[\w.]*)</i);
      if (netVer) add(`.NET ${netVer[1]}`);
      else if (/<TargetFrameworkVersion>v4/i.test(text)) add(".NET Framework");
    } catch { /* skip */ }
  };

  const walk = (current: string, depth: number) => {
    if (depth > MAX_DEPTH) { maxDepthHit = true; return; }
    if (!existsSync(current)) return;
    let entries: string[];
    try { entries = readdirSync(current); } catch { return; }
    for (const name of entries) {
      const full = path.join(current, name);
      let isDir: boolean;
      try { isDir = statSync(full).isDirectory(); } catch { continue; }

      if (isDir) {
        dirCount++;
        if (KNOWN_JUNK_DIR_NAMES.includes(name)) { ignoredDirs.add(name); continue; }
        if (name.startsWith(".") && !DOT_DIRS_TO_SCAN.has(name)) continue;
        if (name === ".github") {
          const workflowsDir = path.join(full, "workflows");
          if (existsSync(workflowsDir)) {
            try {
              for (const wf of readdirSync(workflowsDir)) {
                if (/\.ya?ml$/i.test(wf)) ciSignals.push({ provider: "github-actions", path: rel(path.join(workflowsDir, wf)) });
              }
            } catch { /* skip */ }
          }
          continue;
        }
        if (name === ".circleci") {
          const cfg = path.join(full, "config.yml");
          if (existsSync(cfg)) ciSignals.push({ provider: "circleci", path: rel(cfg) });
          continue;
        }
        if (TEST_DIR_NAMES.has(name.toLowerCase()) && !testDirsSeen.has(full)) {
          testDirsSeen.add(full);
          testSignals.push({ path: rel(full) });
        }
        if (name.toLowerCase() === "docs") docsPaths.push(rel(full));
        walk(full, depth + 1);
        continue;
      }

      fileCount++;
      if (name in BUILD_MANIFEST_BY_NAME) buildSystems.push({ kind: BUILD_MANIFEST_BY_NAME[name]!, path: rel(full) });
      if (name in CI_FILE_SIGNALS) ciSignals.push({ provider: CI_FILE_SIGNALS[name]!, path: rel(full) });
      if (/^readme/i.test(name)) docsPaths.push(rel(full));

      const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
      if (KNOWN_JUNK_EXTENSIONS.includes(ext)) { ignoredExts.add(ext); continue; }
      if (ext in BUILD_MANIFEST_BY_EXT) buildSystems.push({ kind: BUILD_MANIFEST_BY_EXT[ext]!, path: rel(full) });
      if (ext in SOURCE_EXT_LANGUAGE) languageCounts.set(SOURCE_EXT_LANGUAGE[ext]!, (languageCounts.get(SOURCE_EXT_LANGUAGE[ext]!) ?? 0) + 1);
      if (/\.(test|spec)\.[jt]sx?$/i.test(name)) { const d = rel(path.dirname(full)); if (!testDirsSeen.has(d)) { testDirsSeen.add(d); testSignals.push({ path: d, framework: "jest/vitest (guessed)" }); } }
      if (/Tests?\.cs$/i.test(name)) { const d = rel(path.dirname(full)); if (!testDirsSeen.has(d)) { testDirsSeen.add(d); testSignals.push({ path: d, framework: "xunit/nunit/mstest (guessed)" }); } }

      if (name === "package.json") sniffPackageJson(full);
      if (ext === "csproj") sniffCsproj(full);
    }
  };

  walk(dir, 0);

  let topLevel: string[] = [];
  try {
    topLevel = readdirSync(dir)
      .filter((n) => n !== ".git")
      .map((n) => { try { return statSync(path.join(dir, n)).isDirectory() ? `${n}/` : n; } catch { return n; } })
      .sort()
      .slice(0, 80);
  } catch { /* unreadable root — leave empty */ }

  const ignoredPaths: IgnoredPathSignal[] = [
    ...Array.from(ignoredDirs).sort().map((name): IgnoredPathSignal => ({ pattern: `Read(./**/${name}/**/*)`, reason: "junk_dir" })),
    ...Array.from(ignoredExts).sort().map((ext): IgnoredPathSignal => ({ pattern: `Read(./**/*.${ext})`, reason: "junk_extension" })),
  ];
  const warnings = maxDepthHit ? [`עומק הסריקה הגיע למגבלה (${MAX_DEPTH}) — ייתכנו תיקיות עמוקות יותר שלא נסרקו`] : [];

  let languages: LanguageSignal[];
  let sccUsed: boolean;
  try {
    const sccLanguages = await runScc(dir);
    languages = sccLanguages
      .map((l): LanguageSignal => ({ name: l.name, fileCount: l.fileCount, lines: l.lines, code: l.code, comment: l.comment, blank: l.blank, complexity: l.complexity }))
      .sort((a, b) => b.fileCount - a.fileCount);
    sccUsed = true;
  } catch (e) {
    languages = Array.from(languageCounts.entries())
      .map(([name, fileCount]): LanguageSignal => ({ name, fileCount }))
      .sort((a, b) => b.fileCount - a.fileCount);
    sccUsed = false;
    if (!(e instanceof SccNotAvailableError)) warnings.push(`scc נכשל (${(e as Error).message}) — נעשה שימוש בספירת שפות בסיסית לפי סיומת קובץ בלבד`);
    else warnings.push("scc אינו מותקן — נעשה שימוש בספירת שפות בסיסית לפי סיומת קובץ בלבד, ללא שורות קוד או מדד מורכבות");
  }

  return {
    scannedCommitSha,
    languages,
    buildSystems,
    testSignals,
    ciSignals,
    frameworkSignals,
    docsSignals: Array.from(new Set(docsPaths)).map((p) => ({ path: p })),
    ignoredPaths,
    stats: { fileCount, dirCount, maxDepthHit, sccUsed, topLevel },
    warnings,
  };
}
