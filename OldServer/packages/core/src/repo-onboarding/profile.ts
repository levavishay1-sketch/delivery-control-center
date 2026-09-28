import type { ProfileCorrection, RepoProfile } from "./types.ts";

/**
 * The profile as a person reads it: the facts of the diagnosis as a list of
 * lines, each with the dotted path a correction ("זה לא נכון") is recorded
 * against, and a one-paragraph summary the prompts hand to the model. Pure.
 */

export type ProfileFact = {
  /** The dotted path in the profile — what a correction names. */
  path: string;
  /** The concept the "i" opens (a glossary key). */
  concept: string;
  label_he: string;
  value_he: string;
  /** warn — something the plan will have to work around; bad — something the owner must know. */
  tone: "plain" | "warn" | "bad";
  corrected: boolean;
};

const n = (x: number) => x.toLocaleString("en-US");
const list = (xs: readonly unknown[], max = 4) => (xs.length ? xs.slice(0, max).map(String).join(", ") + (xs.length > max ? ` ועוד ${xs.length - max}` : "") : "—");
const base = (p: string) => p.split("/").pop() ?? p;

export function profileFacts(d: RepoProfile, corrections: readonly ProfileCorrection[] = []): ProfileFact[] {
  const corrected = (path: string) => corrections.some((c) => c.path === path || path.startsWith(`${c.path}.`) || c.path.startsWith(`${path}.`));
  const f = (path: string, concept: string, label_he: string, value_he: string, tone: ProfileFact["tone"] = "plain"): ProfileFact => ({ path, concept, label_he, value_he, tone, corrected: corrected(path) });
  const out: ProfileFact[] = [];
  out.push(f("languages", "profile_languages", "שפות", d.languages.slice(0, 5).map((l) => `${l.language} (${n(l.files)} קבצים${l.lines ? `, ${n(l.lines)} שורות` : ""})`).join(" · ") || "—"));
  out.push(f("frameworks", "profile_frameworks", "מסגרות וספריות", list(d.frameworks, 8)));
  out.push(f("build", "profile_build", "build", d.build.commands.length ? d.build.commands.map((c) => c.replace(/\s+#.*$/, "")).join(" · ") : (d.build.system.length ? `${list(d.build.system)} — לא נמצאה פקודה` : "לא זוהתה מערכת build"), d.windows_build.windows_only_build ? "warn" : d.build.commands.length ? "plain" : "warn"));
  if (d.windows_build.windows_only_build) out.push(f("windows_build.windows_only_build", "profile_windows_only", "build רק ב-Windows", `${d.windows_build.sln} .sln · ${d.windows_build.csproj} csproj · ${d.windows_build.snk} .snk · ${Object.keys(d.build.dotnet_target_frameworks ?? {}).slice(0, 2).join(", ") || "msbuild"}`, "warn"));
  out.push(f("tests", "profile_tests", "בדיקות", d.tests.frameworks.length ? `${list(d.tests.frameworks, 3)} · ${n(d.tests.test_files)} קובצי בדיקה${d.tests.test_dirs.length ? ` ב-${list(d.tests.test_dirs.map((t) => t[0]), 3)}` : ""}` : `לא נמצאה מסגרת בדיקות (${n(d.tests.test_files)} קבצים שנראים כמו בדיקות)`, d.tests.frameworks.length ? "plain" : "warn"));
  out.push(f("lint_format", "profile_lint", "lint ופורמט", d.lint_format.length ? list(d.lint_format, 6) : "אין", d.lint_format.length ? "plain" : "warn"));
  out.push(f("ci", "profile_ci", "CI", d.ci.present ? `${list(d.ci.systems)} · ${d.ci.workflow_count ?? d.ci.workflows.length} workflows${d.ci.commands.length ? ` · מריץ: ${list(d.ci.commands, 3)}` : ""}` : "אין CI — שום דבר לא מגדיר \"ירוק\"", d.ci.present ? "plain" : "warn"));
  out.push(f("monorepo", "profile_monorepo", "מבנה", d.monorepo.is_monorepo ? `ריפו רב-חבילות: ${d.monorepo.workspaces.slice(0, 2).map(String).join("; ") || "workspace"} · ${d.monorepo.package_count ?? d.monorepo.packages.length} חבילות` : `חבילה אחת · תיקיות ראשיות: ${list(d.size.top_level_dirs, 8)}`));
  const gen = d.generated_code.paths.filter((p) => p.files >= 2).slice(0, 4);
  out.push(f("generated_code", "profile_generated", "קוד מג'ונרט", gen.length || d.generated_code.header_marked_files ? `${gen.map((p) => `${p.dir} (${p.files})`).join(", ") || "—"}${d.generated_code.header_marked_files ? ` · ${d.generated_code.header_marked_files} קבצים עם כותרת auto-generated` : ""}` : "לא נמצא"));
  out.push(f("secrets", "profile_secrets", "סודות", d.secrets.total || d.secrets.sensitive_files.length
    ? `${d.secrets.outside_tests ? `${d.secrets.outside_tests} מחרוזות בצורת סוד מחוץ לבדיקות (${list(Object.keys(d.secrets.by_kind), 3)}) ב-${list(d.secrets.files.filter((x) => !/(test|spec|fixture|snapshot)/i.test(x.path)).map((x) => x.path), 3)}` : d.secrets.total ? `${d.secrets.total} מחרוזות בצורת סוד, כולן בקובצי בדיקה (מזויפות)` : "אין מחרוזות בצורת סוד"} · ${d.secrets.sensitive_files.length} קבצים רגישים לפי השם (${list(d.secrets.sensitive_files.map(base), 3)}). רק מיקום נרשם, לעולם לא הערך.`
    : "לא נמצאו מחרוזות בצורת סוד ולא קבצים רגישים", d.secrets.outside_tests ? "bad" : d.secrets.sensitive_files.length ? "warn" : "plain"));
  const ext = Object.entries(d.external_systems).slice(0, 8);
  out.push(f("external_systems", "profile_external", "מערכות חיצוניות", ext.length ? ext.map(([k, v]) => `${k} (${v.count})`).join(" · ") : "לא זוהו"));
  out.push(f("ai_config", "profile_ai_config", "הגדרות AI קיימות", d.ai_config.present ? `${list(d.ai_config.kinds, 5)} · ${d.ai_config.count} קבצים${Object.keys(d.ai_config.sizes).length ? ` (${Object.entries(d.ai_config.sizes).slice(0, 3).map(([k, v]) => `${base(k)} ${Math.round(v / 100) / 10}KB`).join(", ")})` : ""}` : "אין — הסוכן מתחיל מאפס עובדות"));
  out.push(f("docs", "profile_docs", "תיעוד", `${d.docs.readme ? `README ${Math.round(d.docs.readme_bytes / 102.4) / 10}KB` : "אין README"} · ${d.docs.docs_files ? `${d.docs.docs_files} קבצים ב-docs/` : "אין docs/"}${d.docs.architecture_docs.length ? ` · ארכיטקטורה: ${list(d.docs.architecture_docs, 2)}` : ""}${d.docs.contributing.length ? ` · ${base(d.docs.contributing[0]!)}` : ""}${d.docs.pr_template?.length ? " · תבנית PR" : ""}`, d.docs.readme_bytes < 2000 && !d.docs.docs_files ? "warn" : "plain"));
  out.push(f("environment", "profile_environment", "סביבה", [d.environment.devcontainer ? "devcontainer" : null, d.environment.dockerfile.length ? "Dockerfile" : null, d.environment.docker_compose.length ? "compose" : null, d.environment.makefile ? "Makefile" : null, ...d.environment.tool_versions.map(base)].filter(Boolean).join(" · ") || "לא נמצאה הגדרת סביבה"));
  const g = d.git;
  out.push(f("git", "profile_history", "היסטוריית git", g.available
    ? `${n(g.commits_in_clone ?? 0)} commits${g.shallow ? " (עותק רדוד)" : ""} · ${g.authors_in_clone ?? 0} מחברים · ${g.first_commit_date_in_clone ?? "?"} עד ${g.last_commit_date ?? "?"}${(g.hot_dirs?.length ?? 0) > 0 ? ` · נקודה חמה: ${g.hot_dirs![0]!.dir} (${g.hot_dirs![0]!.changes} שינויים, ${g.hot_dirs![0]!.authors} מחברים)` : ""}${(g.repeated_change_shapes?.length ?? 0) > 0 ? ` · ${g.repeated_change_shapes!.length} צורות שינוי חוזרות` : " · אין צורות שינוי חוזרות לקרוא"}`
    : "אין היסטוריה לקרוא", (g.commits_in_clone ?? 0) <= 1 ? "warn" : "plain"));
  if ((g.tracked_binaries_dll_exe_pdb ?? 0) > 20 || (g.tracked_package_dirs ?? 0) > 50 || (g.tracked_ide_junk ?? 0) > 20) out.push(f("git.tracked_binaries_dll_exe_pdb", "profile_hygiene", "היגיינה", `${n(g.tracked_binaries_dll_exe_pdb ?? 0)} dll/exe/pdb · ${n(g.tracked_package_dirs ?? 0)} קובצי package cache · ${n(g.tracked_ide_junk ?? 0)} קובצי IDE בתוך git`, "warn"));
  out.push(f("size", "profile_size", "גודל", `${n(d.size.files)} קבצים · ${n(d.size.code_lines)} שורות קוד · ${Math.round(d.size.bytes_on_disk_excl_git / 1048576)}MB`));
  out.push(f("docs.license_kind", "profile_license", "רישיון", d.docs.license_kind === "none" ? "אין קובץ רישיון" : d.docs.license_kind));
  return out;
}

/** One paragraph for the prompts — the facts, English, compact. */
export function profileSummary(d: RepoProfile): string {
  const parts: string[] = [];
  parts.push(`Languages: ${d.languages.slice(0, 4).map((l) => `${l.language} (${l.files} files)`).join(", ") || "none detected"}.`);
  if (d.frameworks.length) parts.push(`Frameworks: ${d.frameworks.slice(0, 10).join(", ")}.`);
  parts.push(`Build: ${d.build.commands.map((c) => c.replace(/\s+#.*$/, "")).join("; ") || (d.build.system.join(", ") || "none detected")}${d.windows_build.windows_only_build ? " (Windows-only: msbuild, signed assemblies)" : ""}.`);
  parts.push(`Tests: ${d.tests.frameworks.length ? `${d.tests.frameworks.slice(0, 3).join(", ")}, ${d.tests.test_files} test files in ${d.tests.test_dirs.slice(0, 3).map((t) => t[0]).join(", ") || "?"}` : `no test framework (${d.tests.test_files} test-like files)`}.`);
  parts.push(`Lint/format: ${d.lint_format.slice(0, 5).join(", ") || "none"}.`);
  parts.push(`CI: ${d.ci.present ? `${d.ci.systems.join(", ")} (${d.ci.workflow_count ?? d.ci.workflows.length} workflows) running ${d.ci.commands.slice(0, 4).join("; ") || "?"}` : "none"}.`);
  parts.push(d.monorepo.is_monorepo ? `Multi-package: ${d.monorepo.workspaces.slice(0, 2).map(String).join("; ")} (${d.monorepo.package_count ?? d.monorepo.packages.length} packages).` : `Single package; top-level: ${d.size.top_level_dirs.slice(0, 10).join(", ")}.`);
  const gen = d.generated_code.paths.filter((p) => p.files >= 2).slice(0, 4);
  if (gen.length || d.generated_code.header_marked_files) parts.push(`Generated code: ${gen.map((p) => p.dir).join(", ") || "—"}${d.generated_code.header_marked_files ? `; ${d.generated_code.header_marked_files} files with auto-generated headers` : ""}.`);
  if (d.secrets.total || d.secrets.sensitive_files.length) parts.push(`Secrets: ${d.secrets.outside_tests} secret-shaped strings outside tests, ${d.secrets.in_test_files} in tests; ${d.secrets.sensitive_files.length} sensitive-by-name files (locations only, never values).`);
  const ext = Object.keys(d.external_systems).slice(0, 8);
  if (ext.length) parts.push(`External systems referenced: ${ext.join(", ")}.`);
  parts.push(`AI configuration: ${d.ai_config.present ? `${d.ai_config.kinds.join(", ")} (${d.ai_config.count} files)` : "none"}.`);
  parts.push(`Docs: ${d.docs.readme ? `README ${Math.round(d.docs.readme_bytes / 1024)}KB` : "no README"}, ${d.docs.docs_files} files in docs/, architecture docs: ${d.docs.architecture_docs.slice(0, 2).join(", ") || "none"}, contributing: ${d.docs.contributing[0] ?? "none"}, PR template: ${d.docs.pr_template?.[0] ?? "none"}.`);
  const env = [d.environment.devcontainer ? "devcontainer" : null, d.environment.dockerfile.length ? "Dockerfile" : null, d.environment.docker_compose.length ? "compose" : null].filter(Boolean);
  if (env.length) parts.push(`Environment: ${env.join(", ")}.`);
  const g = d.git;
  parts.push(g.available ? `History: ${g.commits_in_clone ?? 0} commits, ${g.authors_in_clone ?? 0} authors, ${g.first_commit_date_in_clone ?? "?"}..${g.last_commit_date ?? "?"}; hot dirs: ${(g.hot_dirs ?? []).slice(0, 3).map((h) => `${h.dir} (${h.changes} changes/${h.authors} authors)`).join(", ") || "none"}; repeated change shapes: ${g.repeated_change_shapes?.length ?? 0}.` : "History: not available.");
  parts.push(`Size: ${d.size.files} files, ${d.size.code_lines} code lines.`);
  return parts.join(" ");
}

/** The facts a trial's judge is handed — only the ones that bear on the task. */
export function factsForJudge(d: RepoProfile): string[] {
  const facts: string[] = [];
  facts.push(`Build command: ${d.build.commands[0]?.replace(/\s+#.*$/, "") ?? "none detected"}${d.windows_build.windows_only_build ? " — it runs ONLY on Windows (msbuild); it cannot run on Linux or macOS" : ""}.`);
  facts.push(d.tests.frameworks.length ? `Test framework: ${d.tests.frameworks.slice(0, 3).join(", ")}; ${d.tests.test_files} test files under ${d.tests.test_dirs.slice(0, 3).map((t) => t[0]).join(", ") || "?"}.` : "There is NO test framework in this repository.");
  facts.push(d.ci.present ? `CI: ${d.ci.systems.join(", ")} runs ${d.ci.commands.slice(0, 4).join("; ") || "?"}.` : "There is NO CI in this repository.");
  facts.push(d.lint_format.length ? `Lint/format: ${d.lint_format.slice(0, 4).join(", ")}.` : "There is NO linter or formatter configured.");
  if (d.monorepo.is_monorepo) facts.push(`Multi-package repository: ${d.monorepo.package_count ?? d.monorepo.packages.length} packages (${d.monorepo.packages.slice(0, 8).join(", ")}).`);
  if (d.package_managers.length) facts.push(`Package manager(s): ${d.package_managers.join(", ")}.`);
  const gen = d.generated_code.paths.filter((p) => p.files >= 2).slice(0, 4).map((p) => p.dir);
  if (gen.length) facts.push(`Generated code lives in: ${gen.join(", ")} — it is not edited by hand.`);
  const ext = Object.keys(d.external_systems).slice(0, 6);
  if (ext.length) facts.push(`External systems: ${ext.join(", ")} — their live schema or data is not in the repository.`);
  return facts;
}
