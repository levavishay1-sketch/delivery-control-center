import { execFileSync } from "node:child_process";
import { existsSync, globSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { estimateTokens } from "../artifacts.ts";
import { getActiveOnboardingPrompt } from "../prompts.ts";
import { createClaudeCodeRunner, READ_ONLY_TOOLS } from "../runner.ts";
import { VALIDATE_SCHEMA } from "../schemas.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";
import type { BoundariesResult } from "./boundaries.ts";
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

function parseFm(text: string): Record<string, string | string[]> {
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
  return { ok, detail: ok ? `${samples.length} sample inputs behaved as expected` : results.join("; ") };
}

registerStage("validate", async (ctx): Promise<StageOutcome> => {
  const boundaries = ctx.priorResults.boundaries as BoundariesResult | undefined;
  const plan = ctx.priorResults.plan as PlanResult | undefined;
  const gen = ctx.priorResults.generate as GenerateResult | undefined;
  if (!boundaries?.approved || !plan?.approved || !gen) return { status: "Failed", errors: ["generate has not completed"] };
  const root = ctx.workspaceDir;
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
  for (const a of approved.filter((x) => x.kind === "guardrail_hook")) {
    if (!exists(a.path)) { add({ id: `hook:${a.catalogId}`, label_he: `Guardrail ${a.title_he}`, status: "fail", detail: "הקובץ חסר" }); continue; }
    const samples = a.catalogId === "protect-secrets"
      ? [{ label: "read .env", input: { tool_name: "Read", tool_input: { file_path: `${root}/.env` } }, expectBlock: true }, { label: "read README", input: { tool_name: "Read", tool_input: { file_path: `${root}/README.md` } }, expectBlock: false }]
      : a.catalogId === "prevent-dangerous-git"
        ? [{ label: "force push", input: { tool_name: "Bash", tool_input: { command: "git push --force origin main" } }, expectBlock: true }, { label: "git status", input: { tool_name: "Bash", tool_input: { command: "git status" } }, expectBlock: false }]
        : [{ label: "unrelated write", input: { tool_name: "Write", tool_input: { file_path: `${root}/README.md` } }, expectBlock: false }, ...(plan.protectedGlobs[0] ? [{ label: "protected write", input: { tool_name: "Write", tool_input: { file_path: `${root}/${plan.protectedGlobs[0]}/x.txt` } }, expectBlock: true }] : [])];
    const r = exerciseHook(root, a.path, samples);
    add({ id: `hook:${a.catalogId}`, label_he: `Guardrail ${a.title_he}`, status: r.ok ? "pass" : "fail", detail: r.detail });
  }
  const dcc = approved.find((x) => x.kind === "dcc_hooks");
  if (dcc) {
    const files = [".claude/hooks/dcc/lib.mjs", ".claude/hooks/dcc/session-start.mjs", ".claude/hooks/dcc/session-end.mjs", ".claude/hooks/dcc/post-tool-use.mjs"];
    const bad = files.filter((f) => { if (!exists(f)) return true; try { execFileSync("node", ["--check", path.join(root, f)], { stdio: "pipe" }); return false; } catch { return true; } });
    add({ id: "dcc_hooks", label_he: "hooks של DCC", status: bad.length ? "fail" : "pass", detail: bad.length ? `בעיה ב: ${bad.join(", ")}` : `${files.length} קבצים + .dcc.json${exists(".dcc.json") ? "" : " (חסר!)"}` });
  }

  // Rules and skills: frontmatter + globs + budget.
  for (const a of approved.filter((x) => x.kind === "rule")) {
    if (!exists(a.path)) { add({ id: `rule:${a.key}`, label_he: `Rule ${a.title_he}`, status: "fail", detail: "הקובץ חסר" }); continue; }
    const text = read(a.path);
    const fm = parseFm(text);
    const paths = Array.isArray(fm.paths) ? fm.paths : typeof fm.paths === "string" && fm.paths ? [fm.paths] : [];
    const matches = globMatches(root, paths);
    const tokens = estimateTokens(text.replace(/<!--[\s\S]*?-->/g, ""));
    items.push({ path: a.path, loading: paths.length ? "on_demand" : "always", tokens, lines: text.split("\n").length, note: paths.length ? `paths: ${paths.join(", ")}` : "ללא paths — נטען בכל session" });
    add({ id: `rule:${a.key}`, label_he: `Rule ${a.title_he}`, status: paths.length === 0 ? "warn" : matches === 0 ? "warn" : "pass", detail: paths.length === 0 ? "ללא paths frontmatter — נטען תמיד" : `${matches} קבצים תואמים ל-${paths.length} תבניות` });
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
  const missingRefs: string[] = [];
  for (const p of prose) for (const ref of referencedPaths(p.text)) if (!exists(ref) && !existsSync(path.join(root, path.dirname(p.path), ref))) missingRefs.push(`${p.path} → ${ref}`);
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
      promptId: prompt.id, capability: "onboarding_validate", tools: [...READ_ONLY_TOOLS], denyRules: boundaries.approved.rules,
      jsonSchema: VALIDATE_SCHEMA as unknown as Record<string, unknown>,
      promptVars: { ARTIFACT_PATHS: JSON.stringify(prose.map((p) => p.path)), CHECKS: JSON.stringify(checks.map((c) => ({ id: c.id, status: c.status, detail: c.detail }))) },
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
