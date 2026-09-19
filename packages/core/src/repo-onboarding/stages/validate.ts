import { execFileSync } from "node:child_process";
import { existsSync, globSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { estimateTokens } from "../artifacts.ts";
import { matchesProtectedPattern } from "../guardrails.ts";
import { getActiveOnboardingPrompt } from "../prompts.ts";
import { createClaudeCodeRunner, READ_ONLY_TOOLS } from "../runner.ts";
import { VALIDATE_SCHEMA } from "../schemas.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";
import type { BoundariesResult } from "./boundaries.ts";
import { buildPathIndex, resolveBySuffix } from "./generate.ts";
import type { GenerateResult } from "./generate.ts";
import type { PlanResult } from "./plan.ts";

/**
 * Stage 7 — Validate. Deterministic checks first (does the configuration
 * load, do the hooks fire, do the globs match anything, do the referenced
 * paths exist, how much always-loaded context did we just add), then one
 * read-only AI review for what only reading can catch (contradictions
 * with the code, unsupported claims, generic filler). DCC deliberately
 * does NOT run the repository's own build/test scripts here: a client
 * repository's package.json script is arbitrary code on the operator's
 * machine.
 */
export type Check = { id: string; label_he: string; status: "pass" | "warn" | "fail" | "skipped"; detail?: string };
export type ContextBudget = {
  alwaysLoadedTokens: number; onDemandTokens: number;
  items: { path: string; loading: "always" | "on_demand" | "never"; tokens: number; lines: number; note?: string }[];
  thresholds: { warnAlways: number; failAlways: number; claudeMdMaxLines: number };
};
export type ReviewIssue = { severity: "low" | "medium" | "high"; artifact: string; problem_he: string; evidence?: string; recommended_correction_he?: string; category?: string };
export type ValidateResult = {
  status: "READY" | "READY_WITH_WARNING" | "NOT_READY";
  checks: Check[];
  budget: ContextBudget;
  review: { overall_status: "PASS" | "WARN" | "FAIL"; issues: ReviewIssue[]; strengths_he?: string[] } | null;
  fixNote?: string;
  attempt: number;
  claudeExecutionId?: string;
};

const THRESHOLDS = { warnAlways: 3000, failAlways: 6000, claudeMdMaxLines: 150 };

function parseFm(rawText: string): Record<string, string | string[]> {
  // A file checked out with CRLF line endings (the Git/Windows default —
  // exactly what a .NET repo like this one gets) leaves every line ending
  // in `\r`. JS regex `.` excludes line terminators, `\r` among them, so
  // `(.*)$` can never reach end-of-string on such a line and the whole
  // per-line match silently fails — frontmatter comes back completely
  // empty, on every rule and skill, with no error. Confirmed live: a
  // CRLF copy of a real rule file parsed to `{}` where the LF original
  // parsed correctly. Normalize once, up front, rather than special-case
  // every regex below.
  const text = rawText.replace(/\r\n/g, "\n");
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  const out: Record<string, string | string[]> = {};
  if (!m) return out;
  const lines = m[1]!.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i]!.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!, val = kv[2]!.trim();
    if (val === "" && lines[i + 1] && /^\s+-\s+/.test(lines[i + 1]!)) {
      const arr: string[] = [];
      for (let j = i + 1; j < lines.length && /^\s+-\s+/.test(lines[j]!); j++) arr.push(lines[j]!.replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, ""));
      out[key] = arr;
    } else out[key] = val.replace(/^["']|["']$/g, "");
  }
  return out;
}

function globMatches(root: string, patterns: string[]): number {
  let n = 0;
  for (const p of patterns) {
    try { n += globSync(p, { cwd: root }).length; } catch { /* invalid pattern counts as zero */ }
  }
  return n;
}

/** Backtick-quoted tokens that look like repository paths. */
function referencedPaths(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]{2,120})`/g)) {
    const t = m[1]!.trim();
    if (/^[\w.@/-]+\/[\w.@/-]+$|^[\w.-]+\.(md|json|ts|tsx|js|mjs|cs|csproj|sln|py|go|java|yml|yaml|toml)$/i.test(t) && !/[ *{}$<>]/.test(t) && !t.startsWith("http")) out.add(t.replace(/^\.\//, ""));
  }
  return Array.from(out);
}

function shingleOverlap(a: string, b: string, n = 8): number {
  const sh = (s: string) => { const w = s.toLowerCase().split(/\s+/).filter(Boolean); const set = new Set<string>(); for (let i = 0; i + n <= w.length; i++) set.add(w.slice(i, i + n).join(" ")); return set; };
  const A = sh(a), B = sh(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const s of B) if (A.has(s)) hit++;
  return hit / B.size;
}

/** Every rule file Claude Code would load — `.md`, discovered
 *  recursively under `.claude/rules/` (memory docs), whoever wrote it. */
function listRuleFiles(root: string): string[] {
  const base = path.join(root, ".claude", "rules");
  if (!existsSync(base)) return [];
  const out: string[] = [];
  const walk = (rel: string) => {
    let entries: string[];
    try { entries = readdirSync(path.join(base, rel || ".")); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e}` : e;
      let st; try { st = statSync(path.join(base, r)); } catch { continue; }
      if (st.isDirectory()) walk(r);
      else if (st.isFile() && e.endsWith(".md")) out.push(`.claude/rules/${r}`);
    }
  };
  walk("");
  return out.sort();
}

/** Repository files, excluding VCS and the noise every profile denies.
 *  Bounded: we only need a representative sample, not an index. */
function repoFiles(root: string, cap = 4000): string[] {
  const out: string[] = [];
  const skip = new Set([".git", "node_modules", ".vs", "bin", "obj"]);
  const walk = (rel: string) => {
    if (out.length >= cap) return;
    let entries: string[];
    try { entries = readdirSync(path.join(root, rel || ".")); } catch { return; }
    for (const e of entries) {
      if (out.length >= cap) return;
      if (skip.has(e)) continue;
      const r = rel ? `${rel}/${e}` : e;
      let st; try { st = statSync(path.join(root, r)); } catch { continue; }
      if (st.isDirectory()) walk(r);
      else if (st.isFile()) out.push(r);
    }
  };
  walk("");
  return out;
}

/**
 * What each protected pattern actually covers in this repository.
 *
 * This is the check that matters to a person reading the report: a
 * pattern covering zero files protects nothing (it is a typo or prose
 * that slipped through), and a pattern covering hundreds of
 * hand-maintained source files will silently block real work. Both are
 * reported by count, with examples, so the numbers can be judged.
 */
function protectedPatternCoverage(root: string, patterns: string[], files: string[]): { pattern: string; matched: string[] }[] {
  return patterns.map((pattern) => ({ pattern, matched: files.filter((f) => matchesProtectedPattern(f, pattern)) }));
}

function exerciseHook(root: string, hookPath: string, samples: { input: unknown; expectBlock: boolean; label: string }[]): { ok: boolean; detail: string } {
  const full = path.join(root, hookPath);
  try { execFileSync("node", ["--check", full], { stdio: "pipe" }); } catch (e) { return { ok: false, detail: `syntax: ${String((e as Error).message).slice(0, 120)}` }; }
  const results: string[] = [];
  let ok = true;
  for (const s of samples) {
    let code = 0;
    try { execFileSync("node", [full], { input: JSON.stringify(s.input), stdio: "pipe", timeout: 10_000 }); } catch (e) { code = (e as { status?: number }).status ?? 1; }
    const blocked = code === 2;
    if (blocked !== s.expectBlock) { ok = false; results.push(`${s.label}: expected ${s.expectBlock ? "block" : "allow"}, got exit ${code}`); }
  }
  const blocked = samples.filter((s) => s.expectBlock).length;
  return {
    ok,
    detail: ok
      ? `נבדק מול ${samples.length} קבצים אמיתיים מה-Repository: ${blocked} נחסמו כצפוי, ${samples.length - blocked} עברו כצפוי`
      : results.join("; "),
  };
}

registerStage("validate", async (ctx): Promise<StageOutcome> => {
  const boundaries = ctx.priorResults.boundaries as BoundariesResult | undefined;
  const plan = ctx.priorResults.plan as PlanResult | undefined;
  const gen = ctx.priorResults.generate as GenerateResult | undefined;
  if (!boundaries?.approved || !plan?.approved || !gen) return { status: "Failed", errors: ["generate has not completed"] };
  const root = ctx.workspaceDir;
  // `generate` may have replaced the deterministic list with a validated
  // `protected_globs_correction` — that is what the hooks on disk were
  // actually rendered with, so it is what must be checked. Falling back
  // to plan.protectedGlobs keeps this working for a run from before this
  // field existed.
  const protectedGlobs = gen.protectedGlobs ?? plan.protectedGlobs;
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const items: ContextBudget["items"] = [];
  const read = (p: string) => readFileSync(path.join(root, p), "utf8");
  const exists = (p: string) => existsSync(path.join(root, p));
  const approved = plan.approved.filter((a) => a.action !== "skip" && a.action !== "remove");

  // CLAUDE.md — the always-loaded map.
  const claudeMd = approved.find((a) => a.kind === "claude_md");
  const claudeMdPath = claudeMd?.path ?? "CLAUDE.md";
  let claudeMdText = "";
  if (exists(claudeMdPath)) {
    claudeMdText = read(claudeMdPath);
    const lines = claudeMdText.split("\n").length;
    // HTML comments are stripped before injection (memory docs) — don't count them.
    const injected = claudeMdText.replace(/<!--[\s\S]*?-->/g, "");
    items.push({ path: claudeMdPath, loading: "always", tokens: estimateTokens(injected), lines });
    add({ id: "claude_md_exists", label_he: "CLAUDE.md קיים", status: "pass", detail: `${lines} שורות` });
    add({ id: "claude_md_lines", label_he: "אורך CLAUDE.md", status: lines > THRESHOLDS.claudeMdMaxLines ? "fail" : lines > 100 ? "warn" : "pass", detail: `${lines} שורות (יעד 40–80, מקסימום ${THRESHOLDS.claudeMdMaxLines}; התיעוד הרשמי: מתחת ל-200 שורות מוריד ציות)` });
  } else add({ id: "claude_md_exists", label_he: "CLAUDE.md קיים", status: "fail", detail: "לא נמצא בענף ה-onboarding" });

  // settings.json + hooks.
  const settingsPath = ".claude/settings.json";
  let settings: { permissions?: { deny?: string[]; allow?: string[] }; hooks?: Record<string, { hooks: { command: string }[] }[]> } | null = null;
  if (exists(settingsPath)) {
    try { settings = JSON.parse(read(settingsPath)); add({ id: "settings_parse", label_he: "settings.json תקין", status: "pass", detail: `deny ${settings?.permissions?.deny?.length ?? 0} · allow ${settings?.permissions?.allow?.length ?? 0} · אירועי hooks ${Object.keys(settings?.hooks ?? {}).length}` }); }
    catch (e) { add({ id: "settings_parse", label_he: "settings.json תקין", status: "fail", detail: String((e as Error).message).slice(0, 120) }); }
  } else add({ id: "settings_parse", label_he: "settings.json קיים", status: approved.some((a) => a.kind === "settings") ? "fail" : "skipped" });
  if (settings) {
    const hookPaths = new Set<string>();
    for (const entries of Object.values(settings.hooks ?? {})) for (const e of entries) for (const h of e.hooks) { const m = h.command.match(/\$CLAUDE_PROJECT_DIR\/(.+?)"/); if (m) hookPaths.add(m[1]!); }
    const missingHooks = Array.from(hookPaths).filter((p) => !exists(p));
    add({ id: "hooks_exist", label_he: "קבצי hooks קיימים", status: missingHooks.length ? "fail" : hookPaths.size ? "pass" : "skipped", detail: missingHooks.length ? `חסרים: ${missingHooks.join(", ")}` : `${hookPaths.size} קבצים` });
    const denyForSecrets = (settings.permissions?.deny ?? []).some((d) => /\.env/.test(d));
    add({ id: "deny_secrets", label_he: "חסימת קריאה של סודות", status: denyForSecrets ? "pass" : "warn", detail: denyForSecrets ? "כלל Read(.env*) קיים" : "אין כלל Read שחוסם .env — מומלץ" });
  }
  // What the protected-path patterns actually cover here. Computed once:
  // it drives both the effectiveness check and the hook's sample inputs,
  // so the hooks are exercised against real files from this repository
  // rather than synthetic paths that happen to match the first pattern.
  const allFiles = repoFiles(root);
  const coverage = protectedPatternCoverage(root, protectedGlobs, allFiles);
  const unprotected = allFiles.filter((f) => !protectedGlobs.some((p) => matchesProtectedPattern(f, p)));
  if (protectedGlobs.length) {
    // Only one thing here is decidable without judgement: a pattern that
    // matches no file protects nothing. Everything else — whether a
    // broad pattern is correct — depends on what those files are, which
    // is the reviewer's call, not a threshold's. `packages/` covering
    // thousands of vendored files is right; a pattern covering a folder
    // of hand-maintained sources is wrong; both look the same to a
    // counter. So: fail the dead ones, and report the rest as facts the
    // reviewer and the person reading the report can weigh.
    const dead = coverage.filter((c) => c.matched.length === 0);
    add({
      id: "protected_globs_effective",
      label_he: "תבניות הנתיבים המוגנים",
      status: dead.length ? "fail" : "pass",
      detail: [
        dead.length ? `${dead.length} תבניות לא תואמות אף קובץ ולכן לא מגנות על כלום: ${dead.map((d) => `"${d.pattern}"`).join(" · ")}` : "",
        coverage.map((c) => `"${c.pattern}" → ${c.matched.length} קבצים${c.matched[0] ? ` (למשל ${c.matched[0]})` : ""}`).join(" · "),
      ].filter(Boolean).join(" | "),
    });
  }

  for (const a of approved.filter((x) => x.kind === "guardrail_hook")) {
    if (!exists(a.path)) { add({ id: `hook:${a.catalogId}`, label_he: `Guardrail ${a.title_he}`, status: "fail", detail: "הקובץ חסר" }); continue; }
    // One real file per protected pattern must be blocked, and one real
    // file covered by no pattern must get through. A guardrail that
    // cannot demonstrate both on this repository's own files is broken.
    const protectedSamples = coverage
      .filter((c) => c.matched.length > 0)
      .slice(0, 8)
      .map((c) => ({ label: `protected: ${c.matched[0]}`, input: { tool_name: "Write", cwd: root, tool_input: { file_path: `${root}/${c.matched[0]}` } }, expectBlock: true }));
    const samples = a.catalogId === "protect-secrets"
      ? [{ label: "read .env", input: { tool_name: "Read", cwd: root, tool_input: { file_path: `${root}/.env` } }, expectBlock: true }, { label: "read README", input: { tool_name: "Read", cwd: root, tool_input: { file_path: `${root}/README.md` } }, expectBlock: false }]
      : a.catalogId === "prevent-dangerous-git"
        ? [{ label: "force push", input: { tool_name: "Bash", cwd: root, tool_input: { command: "git push --force origin main" } }, expectBlock: true }, { label: "git status", input: { tool_name: "Bash", cwd: root, tool_input: { command: "git status" } }, expectBlock: false }]
        : [
            ...protectedSamples,
            ...(unprotected[0] ? [{ label: `unprotected: ${unprotected[0]}`, input: { tool_name: "Write", cwd: root, tool_input: { file_path: `${root}/${unprotected[0]}` } }, expectBlock: false }] : []),
          ];
    const r = exerciseHook(root, a.path, samples);
    add({ id: `hook:${a.catalogId}`, label_he: `Guardrail ${a.title_he}`, status: r.ok ? "pass" : "fail", detail: samples.length ? r.detail : "אין קבצים לבדוק מולם" });
  }
  const dcc = approved.find((x) => x.kind === "dcc_hooks");
  if (dcc) {
    const files = [".claude/hooks/dcc/lib.mjs", ".claude/hooks/dcc/session-start.mjs", ".claude/hooks/dcc/session-end.mjs", ".claude/hooks/dcc/post-tool-use.mjs"];
    const bad = files.filter((f) => { if (!exists(f)) return true; try { execFileSync("node", ["--check", path.join(root, f)], { stdio: "pipe" }); return false; } catch { return true; } });
    add({ id: "dcc_hooks", label_he: "hooks של DCC", status: bad.length ? "fail" : "pass", detail: bad.length ? `בעיה ב: ${bad.join(", ")}` : `${files.length} קבצים + .dcc.json${exists(".dcc.json") ? "" : " (חסר!)"}` });
  }

  // Rules: frontmatter + globs + budget.
  //
  // Scanned from the repository's own `.claude/rules/` tree, not from
  // this run's plan. A rule a previous onboarding (or a person) left
  // behind still costs context on every session and can still carry the
  // wrong frontmatter — measuring only what we just wrote reported a
  // budget less than half the real one.
  for (const rel of listRuleFiles(root)) {
    const a = approved.find((x) => x.kind === "rule" && x.path === rel);
    const text = read(rel);
    const fm = parseFm(text);
    const paths = Array.isArray(fm.paths) ? fm.paths : typeof fm.paths === "string" && fm.paths ? [fm.paths] : [];
    const matches = globMatches(root, paths);
    const tokens = estimateTokens(text.replace(/<!--[\s\S]*?-->/g, ""));
    // `globs:`/`alwaysApply:` are Cursor's `.mdc` syntax. Claude Code
    // reads neither, so such a rule loads on every session — usually the
    // exact opposite of what whoever wrote it intended.
    const cursorKeys = ["globs", "alwaysApply"].filter((k) => k in fm);
    const label = a ? `Rule ${a.title_he}` : `Rule קיים ${path.posix.basename(rel)}`;
    items.push({
      path: rel,
      loading: paths.length ? "on_demand" : "always",
      tokens,
      lines: text.split("\n").length,
      note: paths.length ? `paths: ${paths.join(", ")}` : "ללא paths — נטען בכל session",
    });
    const detail = cursorKeys.length
      ? `frontmatter משתמש ב-${cursorKeys.join("/")} — זה תחביר של Cursor. Claude Code מתעלם ממנו, ולכן הכלל נטען בכל session (${tokens} טוקנים). החליפו ל-paths:`
      : paths.length === 0
        ? `ללא paths frontmatter — נטען בכל session (${tokens} טוקנים)`
        : `${matches} קבצים תואמים ל-${paths.length} תבניות`;
    add({
      id: a ? `rule:${a.key}` : `rule:existing:${rel}`,
      label_he: label,
      status: cursorKeys.length ? "fail" : paths.length === 0 || matches === 0 ? "warn" : "pass",
      detail,
    });
  }
  for (const a of approved.filter((x) => x.kind === "knowledge_skill" || x.kind === "workflow_skill")) {
    if (!exists(a.path)) { add({ id: a.key, label_he: `Skill ${a.skill?.name ?? a.title_he}`, status: "fail", detail: "הקובץ חסר" }); continue; }
    const text = read(a.path);
    const fm = parseFm(text);
    const desc = typeof fm.description === "string" ? fm.description : "";
    const paths = Array.isArray(fm.paths) ? fm.paths : [];
    const matches = paths.length ? globMatches(root, paths) : -1;
    const descTokens = estimateTokens(desc) + estimateTokens(String(fm.name ?? ""));
    const bodyTokens = estimateTokens(text) - descTokens;
    items.push({ path: a.path, loading: "on_demand", tokens: Math.max(0, bodyTokens), lines: text.split("\n").length, note: `תיאור ~${descTokens} טוקנים נטען תמיד${fm["disable-model-invocation"] === "true" ? " (disable-model-invocation: לא נטען עד הפעלה)" : ""}` });
    const problems: string[] = [];
    if (!fm.name) problems.push("חסר name");
    if (!desc) problems.push("חסר description");
    if (desc.length > 1536) problems.push("description ארוך מ-1536 תווים (ייחתך)");
    if (paths.length && matches === 0) problems.push("paths לא תואמים אף קובץ");
    if (text.split("\n").length > 200) problems.push("מעל 200 שורות — שקלו לפצל לקבצי עזר");
    // Background knowledge is not a command. The skills docs call for
    // `user-invocable: false` on exactly this case ("Claude should know
    // this when relevant, but /<name> isn't a meaningful action for
    // users to take") — otherwise it clutters the slash menu for nothing.
    if (a.kind === "knowledge_skill" && fm["user-invocable"] !== "false") problems.push("ידע רקע — חסר user-invocable: false (אחרת הוא מופיע בתפריט / בלי שיש בו פעולה)");
    add({ id: a.key, label_he: `Skill ${fm.name ?? a.skill?.name ?? ""}`, status: problems.length ? "warn" : "pass", detail: problems.length ? problems.join("; ") : `${text.split("\n").length} שורות · תיאור ${desc.length} תווים${paths.length ? ` · ${matches} קבצים תואמים` : ""}` });
    if (claudeMdText) {
      const overlap = shingleOverlap(claudeMdText, text);
      if (overlap > 0.2) add({ id: `dup:${a.key}`, label_he: `כפילות CLAUDE.md ↔ ${fm.name ?? a.key}`, status: "warn", detail: `${Math.round(overlap * 100)}% מהתוכן חוזר על CLAUDE.md` });
    }
  }
  for (const a of approved.filter((x) => x.kind === "nested_claude_md")) {
    if (!exists(a.path)) { add({ id: a.key, label_he: `CLAUDE.md מקונן ${a.path}`, status: "fail", detail: "הקובץ חסר" }); continue; }
    const text = read(a.path);
    items.push({ path: a.path, loading: "on_demand", tokens: estimateTokens(text.replace(/<!--[\s\S]*?-->/g, "")), lines: text.split("\n").length, note: "נטען כש-Claude קורא קבצים בתיקייה" });
  }

  // Referenced paths in the always-loaded and on-demand prose.
  const prose = approved.filter((a) => a.writer === "ai" && exists(a.path)).map((a) => ({ path: a.path, text: read(a.path) }));
  // What the AI reviewer gets to read. Prose alone was not enough: the
  // guardrail hooks and settings.json are `writer: "dcc"`, so a hook
  // whose path list could never match a real file was never shown to
  // the reviewer at all — it had no way to report what it never saw.
  const reviewPaths = Array.from(new Set([...prose.map((p) => p.path), ...approved.filter((a) => a.writer === "dcc" && exists(a.path)).map((a) => a.path)]));
  // A reference that doesn't exist as given may still be a real path with
  // its leading segments dropped ("Alt.DataModel.Crm.External/Contracts"
  // for the real "Shared/DataModel/Crm/Alt.DataModel.Crm.External/
  // Contracts") — exactly the shortened-reference case generate's own
  // fixLooseFileReferences targets. Try the same suffix resolution before
  // calling it missing: a unique match means the reference is genuinely
  // fine, just written short; ambiguous or no match is the real failure.
  const pathIndex = buildPathIndex(root);
  const missingRefs: string[] = [];
  for (const p of prose) for (const ref of referencedPaths(p.text)) {
    if (exists(ref) || existsSync(path.join(root, path.dirname(p.path), ref))) continue;
    if (resolveBySuffix(pathIndex, ref).length === 1) continue;
    missingRefs.push(`${p.path} → ${ref}`);
  }
  add({ id: "referenced_paths", label_he: "נתיבים מוזכרים קיימים", status: missingRefs.length > 3 ? "fail" : missingRefs.length ? "warn" : "pass", detail: missingRefs.length ? missingRefs.slice(0, 8).join(" · ") : "כל הנתיבים המוזכרים נמצאו" });

  // Context budget.
  const alwaysLoadedTokens = items.filter((i) => i.loading === "always").reduce((s, i) => s + i.tokens, 0)
    + approved.filter((a) => (a.kind === "knowledge_skill" || a.kind === "workflow_skill") && !a.skill?.disableModelInvocation).reduce((s, a) => s + estimateTokens(a.skill?.description ?? "") + 8, 0);
  const onDemandTokens = items.filter((i) => i.loading === "on_demand").reduce((s, i) => s + i.tokens, 0);
  add({ id: "context_budget", label_he: "תקציב הקשר (נטען בכל session)", status: alwaysLoadedTokens > THRESHOLDS.failAlways ? "fail" : alwaysLoadedTokens > THRESHOLDS.warnAlways ? "warn" : "pass", detail: `~${alwaysLoadedTokens} טוקנים תמיד · ~${onDemandTokens} לפי דרישה (אומדן: תווים/4)` });
  add({ id: "build_test", label_he: "הרצת build/test של ה-Repository", status: "skipped", detail: "DCC לא מריץ סקריפטים של ה-Repository בזמן onboarding (מדיניות בטיחות) — הפקודות שתועדו ב-CLAUDE.md מסומנות לפי רמת הביטחון של ה-Discovery" });

  // AI review.
  let review: ValidateResult["review"] = null;
  let claudeExecutionId: string | undefined;
  const prompt = await getActiveOnboardingPrompt("onboarding.v2.validate");
  if (prompt) {
    const runner = createClaudeCodeRunner();
    const exec = await runner.run({
      runId: ctx.runId, stageKey: "validate", repoId: ctx.repoId, clientId: ctx.clientId, cwd: root,
      promptId: prompt.id, capability: "onboarding_validate", modelOverride: ctx.modelChoices.validate, tools: [...READ_ONLY_TOOLS], denyRules: boundaries.approved.rules,
      jsonSchema: VALIDATE_SCHEMA as unknown as Record<string, unknown>,
      promptVars: {
        ARTIFACT_PATHS: JSON.stringify(reviewPaths),
        CHECKS: JSON.stringify(checks.map((c) => ({ id: c.id, status: c.status, detail: c.detail }))),
        // Exactly which files each guardrail will refuse to write, so the
        // reviewer judges the real effect instead of re-deriving it from
        // the pattern strings.
        PROTECTED_COVERAGE: JSON.stringify(coverage.map((c) => ({ pattern: c.pattern, blocks: c.matched.length, examples: c.matched.slice(0, 5) }))),
      },
      maxTurns: 40, timeoutMs: 600_000,
    });
    claudeExecutionId = exec.executionId;
    if (exec.status === "Completed" && exec.json) review = exec.json as NonNullable<ValidateResult["review"]>;
    else add({ id: "ai_review", label_he: "סקירת AI", status: "warn", detail: exec.errorMessage ?? "לא הושלמה" });
  } else add({ id: "ai_review", label_he: "סקירת AI", status: "skipped", detail: "אין prompt פעיל onboarding.v2.validate" });

  const detFail = checks.some((c) => c.status === "fail");
  const detWarn = checks.some((c) => c.status === "warn");
  const status: ValidateResult["status"] = detFail || review?.overall_status === "FAIL" ? "NOT_READY" : detWarn || review?.overall_status === "WARN" ? "READY_WITH_WARNING" : "READY";
  const attempt = ((ctx.ownResult as ValidateResult | undefined)?.attempt ?? 0) + 1;
  const budget: ContextBudget = { alwaysLoadedTokens, onDemandTokens, items, thresholds: THRESHOLDS };
  const result: ValidateResult = { status, checks, budget, review, attempt, claudeExecutionId };

  if (status === "NOT_READY") {
    const fixNote = [
      ...checks.filter((c) => c.status === "fail").map((c) => `- [${c.id}] ${c.label_he}: ${c.detail ?? ""}`),
      ...(review?.issues ?? []).filter((i) => i.severity !== "low").map((i) => `- [${i.artifact}] ${i.problem_he}${i.recommended_correction_he ? ` → ${i.recommended_correction_he}` : ""}`),
    ].join("\n");
    result.fixNote = fixNote;
    // One automatic repair pass, then a person decides.
    if (attempt === 1 && (review?.overall_status === "FAIL" || checks.some((c) => c.status === "fail" && c.id !== "claude_md_exists"))) {
      return { status: "CompletedWithWarnings", warnings: ["האימות נכשל — מבוצע סבב תיקון אוטומטי אחד (יצירה מחדש עם הממצאים)"], claudeExecutionId, result, resetTo: { stageKey: "generate", note: `Validation found these problems — fix them in this pass:\n${fixNote}` } };
    }
    return { status: "Failed", errors: ["האימות נכשל אחרי סבב תיקון — ראו את טבלת הבדיקות וממצאי הסקירה"], claudeExecutionId, result };
  }
  return { status: status === "READY_WITH_WARNING" ? "CompletedWithWarnings" : "Completed", warnings: status === "READY_WITH_WARNING" ? ["מוכן עם אזהרות — ראו את טבלת הבדיקות"] : [], claudeExecutionId, result };
});

void readdirSync; void statSync;
