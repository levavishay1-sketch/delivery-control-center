import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Component, ComponentValidation } from "./types.ts";

/**
 * Validation per kind of component, in the isolated copy: a hook is run
 * against a forbidden action and must block; a permission file must parse
 * and every rule must have the syntax Claude Code reads; a skill or an agent
 * must carry the frontmatter Claude Code triggers on; a rule line or a doc
 * must not name a path that does not exist; a script is run. What cannot be
 * verified here says so (`passed: null`) rather than passing. Pure on the
 * file system; no database, no model.
 */

const now = () => new Date().toISOString();
const result = (how: string, passed: boolean | null, detail: string): ComponentValidation => ({ how, passed, detail, at: now() });

type HookEvent = Record<string, unknown>;

function runHook(file: string, event: HookEvent, cwd: string): { code: number; stderr: string; stdout: string } {
  const r = spawnSync(process.execPath, [file], { input: JSON.stringify({ cwd, session_id: "dcc-verify", ...event }), cwd, encoding: "utf8", timeout: 60_000, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } });
  return { code: r.status ?? -1, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
}

/** A path the hook must refuse and one it must allow, from the component's own parameters. */
function forbiddenAndAllowed(params: Record<string, unknown>): { forbidden: string; allowed: string } {
  const paths = Array.isArray(params.paths) ? (params.paths as string[]) : [];
  const first = paths[0] ?? "generated";
  const forbidden = first.includes("*") ? first.replace(/\*\*?\/?/g, "x/") : first.endsWith("/") ? `${first}file.txt` : /\.[a-z0-9]+$/i.test(first) ? first : `${first}/file.txt`;
  return { forbidden, allowed: "README-dcc-verify-allowed.md" };
}

export function validateHook(c: Component, dir: string): ComponentValidation {
  const file = c.files.find((f) => f.endsWith(".mjs"));
  if (!file) return result("הרצת ה-hook", false, "לא נכתב קובץ hook");
  const abs = path.join(dir, file);
  const template = String(c.params.template ?? "");
  const secret = "Password=Sup3rS3cretDccVerify1;";
  if (template === "block-paths") {
    const { forbidden, allowed } = forbiddenAndAllowed(c.params);
    const deny = runHook(abs, { tool_name: "Edit", tool_input: { file_path: path.join(dir, forbidden) } }, dir);
    const allow = runHook(abs, { tool_name: "Edit", tool_input: { file_path: path.join(dir, allowed) } }, dir);
    if (deny.code !== 2) return result(`ניסיון עריכה של ${forbidden}`, false, `ה-hook לא חסם (קוד ${deny.code})`);
    if (allow.code !== 0) return result(`ניסיון עריכה של ${forbidden}`, false, `ה-hook חסם גם קובץ מותר (${allowed}, קוד ${allow.code})`);
    return result(`ניסיון עריכה של ${forbidden}`, true, "נחסם; קובץ מותר עבר");
  }
  if (template === "block-commands") {
    const patterns = Array.isArray(c.params.patterns) ? (c.params.patterns as string[]) : [];
    const bad = patterns[0] ?? "forbidden";
    const deny = runHook(abs, { tool_name: "Bash", tool_input: { command: `${bad} -auto-approve` } }, dir);
    const allow = runHook(abs, { tool_name: "Bash", tool_input: { command: "ls" } }, dir);
    return deny.code === 2 && allow.code === 0 ? result(`הפקודה "${bad}"`, true, "נחסמה; ls עבר") : result(`הפקודה "${bad}"`, false, `חסימה: קוד ${deny.code}; ls: קוד ${allow.code}`);
  }
  if (template === "secret-scan") {
    const deny = runHook(abs, { tool_name: "Write", tool_input: { file_path: path.join(dir, "src/dcc-verify.ts"), content: `const c = "${secret}";` } }, dir);
    const clean = runHook(abs, { tool_name: "Write", tool_input: { file_path: path.join(dir, "src/dcc-verify.ts"), content: "const c = 1;" } }, dir);
    if (deny.code !== 2) return result("כתיבת מחרוזת חיבור מזויפת", false, `ה-hook לא חסם (קוד ${deny.code})`);
    if ((deny.stderr + deny.stdout).includes("Sup3rS3cretDccVerify1")) return result("כתיבת מחרוזת חיבור מזויפת", false, "ה-hook הדפיס את הסוד עצמו");
    if (clean.code !== 0) return result("כתיבת מחרוזת חיבור מזויפת", false, `ה-hook חסם גם תוכן נקי (קוד ${clean.code})`);
    if (c.params.allowTests === true) {
      const test = runHook(abs, { tool_name: "Write", tool_input: { file_path: path.join(dir, "tests/dcc-verify.test.ts"), content: `const c = "${secret}";` } }, dir);
      if (test.code !== 0) return result("כתיבת מחרוזת חיבור מזויפת", false, "ה-hook חסם קובץ בדיקה למרות ה-allowlist");
    }
    return result("כתיבת מחרוזת חיבור מזויפת", true, "נחסמה בלי להדפיס את הערך; תוכן נקי עבר");
  }
  if (template === "build-gate") {
    const again = runHook(abs, { hook_event_name: "Stop", stop_hook_active: true }, dir);
    return again.code === 0 ? result("Stop hook שכבר המשיך תור", true, "לא נכנס ללולאה; ה-build עצמו נבדק בסקריפט האימות") : result("Stop hook שכבר המשיך תור", false, `קוד ${again.code}`);
  }
  if (template === "post-format" || template === "post-validate") {
    const tmp = path.join(dir, "dcc-verify-format.txt");
    writeFileSync(tmp, "x\n");
    try {
      const r = runHook(abs, { tool_name: "Edit", tool_input: { file_path: tmp } }, dir);
      return result("הרצה על קובץ שנערך", r.code === 0 || r.code === 2, r.code === 0 ? "רץ" : r.code === 2 ? "רץ והחזיר שגיאה (כצפוי לקובץ לא תקין)" : `קוד ${r.code}: ${r.stderr.slice(0, 200)}`);
    } finally {
      rmSync(tmp, { force: true });
    }
  }
  const generic = runHook(abs, { tool_name: "Edit", tool_input: { file_path: path.join(dir, "README.md") } }, dir);
  return result("הרצה עם אירוע לדוגמה", generic.code === 0 || generic.code === 2, `קוד ${generic.code}`);
}

const RULE_SYNTAX = /^(Read|Edit|Write|MultiEdit|Bash|Glob|Grep|WebFetch|WebSearch|NotebookEdit|Task|mcp__[\w-]+)(\(.*\))?$/;

export function validateSettings(dir: string, c: Component): ComponentValidation {
  const file = path.join(dir, ".claude", "settings.json");
  if (!existsSync(file)) return result("פענוח .claude/settings.json", false, "הקובץ לא נכתב");
  let json: { permissions?: { deny?: unknown; allow?: unknown }; hooks?: unknown; enabledPlugins?: unknown };
  try { json = JSON.parse(readFileSync(file, "utf8")) as typeof json; } catch (e) { return result("פענוח .claude/settings.json", false, `JSON לא תקין: ${(e as Error).message.slice(0, 120)}`); }
  if (c.kind === "permission") {
    const deny = Array.isArray(json.permissions?.deny) ? (json.permissions!.deny as string[]) : [];
    const mine = Array.isArray(c.params.deny) ? (c.params.deny as string[]) : [];
    const bad = deny.filter((d) => !RULE_SYNTAX.test(d));
    if (bad.length) return result("פענוח .claude/settings.json", false, `כללים בתחביר לא מוכר: ${bad.slice(0, 3).join(", ")}`);
    const missing = mine.filter((m) => !deny.some((d) => d.includes(m.replace(/^\w+\(|\)$/g, ""))));
    return missing.length ? result("פענוח .claude/settings.json", false, `חסרים בקובץ: ${missing.slice(0, 3).join(", ")}`) : result("פענוח .claude/settings.json", true, `${deny.length} כללי deny, כולם בתחביר של Claude Code`);
  }
  return result("פענוח .claude/settings.json", true, "תקין");
}

/** Every path a text names in backticks must exist; a command must be one the repository knows. */
export function checkClaims(text: string, dir: string, knownCommands: readonly string[]): { checked: number; missing: string[] } {
  const missing: string[] = [];
  let checked = 0;
  for (const m of text.matchAll(/`([^`\n]{2,160})`/g)) {
    const claim = m[1]!.trim();
    if (/^(npm|npx|pnpm|yarn|bun|dotnet|msbuild|go|cargo|mvn|\.\/mvnw|\.\/gradlew|gradle|make|composer|terraform|pytest|python|pip|uv|node|git|pac|az|aws|gcloud|docker|kubectl|helm|ruff|black|eslint|prettier|tsc|vitest|jest|@)/i.test(claim)) {
      checked++;
      const head = claim.split(/\s+/).slice(0, 3).join(" ");
      if (knownCommands.length && !knownCommands.some((k) => k.includes(head) || claim.includes(k.split(/\s+/).slice(0, 2).join(" ")))) { /* a command the profile did not list is not necessarily wrong — noted, not failed */ }
      continue;
    }
    // A branch name or a pattern (`fix/`, `task/WI-12-x`, `ai/onboarding/<run>`) is not a path claim.
    if (/[<>]/.test(claim) || /^(fix|task|project|feature|release|ai|claude|hotfix)\/[\w<>.-]*$/i.test(claim)) continue;
    if (/^[\w./@-]+\/[\w./@*-]*$|^[\w-]+\.[a-z0-9]{1,6}$/i.test(claim) && !claim.includes("*") && !claim.startsWith("http")) {
      checked++;
      const abs = path.join(dir, claim.replace(/^\.\//, ""));
      if (!existsSync(abs)) missing.push(claim);
    }
  }
  return { checked, missing: [...new Set(missing)] };
}

export function validateText(c: Component, dir: string, knownCommands: readonly string[], appended?: ReadonlyMap<string, string>): ComponentValidation {
  const files = c.files.filter((f) => existsSync(path.join(dir, f)));
  if (!files.length) return result("בדיקת טענות מול הקוד", false, "לא נכתב קובץ");
  let checked = 0;
  const missing: string[] = [];
  for (const f of files) {
    // A file that existed before is judged on what this build added to it, not on what was already there.
    const r = checkClaims(appended?.get(f) ?? readFileSync(path.join(dir, f), "utf8"), dir, knownCommands);
    checked += r.checked;
    missing.push(...r.missing);
  }
  const uniq = [...new Set(missing)];
  if (uniq.length) return result("בדיקת טענות מול הקוד", uniq.length > Math.max(1, checked * 0.2) ? false : true, `${checked} טענות נבדקו; נתיבים שלא קיימים: ${uniq.slice(0, 5).join(", ")}`);
  return result("בדיקת טענות מול הקוד", true, checked ? `${checked} נתיבים ופקודות נבדקו, כולם קיימים` : "אין טענות שניתן לבדוק");
}

function frontmatter(text: string): Record<string, string> | null {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) out[kv[1]!] = kv[2]!.trim();
  }
  return out;
}

export function validateSkill(c: Component, dir: string): ComponentValidation {
  const file = c.files.find((f) => f.endsWith("SKILL.md"));
  if (!file || !existsSync(path.join(dir, file))) return result("frontmatter של ה-skill", false, "לא נכתב SKILL.md");
  const text = readFileSync(path.join(dir, file), "utf8");
  const fm = frontmatter(text);
  if (!fm?.name || !fm.description) return result("frontmatter של ה-skill", false, "חסר name או description — Claude Code לא יטען אותו");
  if (fm.description.length < 40) return result("frontmatter של ה-skill", false, "description קצר מדי כדי ש-Claude Code ידע מתי להפעיל אותו");
  const body = text.slice(text.indexOf("---", 3) + 3).trim();
  if (body.length < 200) return result("frontmatter של ה-skill", false, "הגוף קצר מדי (פחות מ-200 תווים)");
  const claims = checkClaims(body, dir, []);
  return result("frontmatter וגוף ה-skill, נתיבים מול הקוד", claims.missing.length ? null : true, claims.missing.length ? `נתיבים שלא קיימים: ${claims.missing.slice(0, 4).join(", ")}` : `name, description ו-${body.length} תווים; ${claims.checked} נתיבים נבדקו`);
}

export function validateAgent(c: Component, dir: string): ComponentValidation {
  const file = c.files.find((f) => /\.claude\/agents\/.+\.md$/.test(f));
  if (!file || !existsSync(path.join(dir, file))) return result("frontmatter של הסוכן", false, "לא נכתב קובץ סוכן");
  const text = readFileSync(path.join(dir, file), "utf8");
  const fm = frontmatter(text);
  if (!fm?.name || !fm.description) return result("frontmatter של הסוכן", false, "חסר name או description");
  const tools = (fm.tools ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const writes = tools.filter((t) => /^(Edit|Write|MultiEdit)$/.test(t));
  const checklist = (text.match(/^\s*[-*]\s+\[ \]|^\s*[-*]\s+/gm) ?? []).length;
  if (writes.length) return result("frontmatter, כלים ורשימת בדיקה", false, `סוכן בודק עם כלי כתיבה (${writes.join(", ")}) — צריך להיות קריאה בלבד`);
  if (checklist < 3) return result("frontmatter, כלים ורשימת בדיקה", false, `רשימת הבדיקה קצרה מדי (${checklist} פריטים)`);
  return result("frontmatter, כלים ורשימת בדיקה", true, `קריאה בלבד (${tools.join(", ") || "ברירת המחדל"}), ${checklist} פריטי בדיקה`);
}

export function validateMcp(c: Component, dir: string): ComponentValidation {
  const file = path.join(dir, ".mcp.json");
  if (!existsSync(file)) return result("פענוח .mcp.json", false, "הקובץ לא נכתב");
  let json: { mcpServers?: Record<string, { url?: string; command?: string }> };
  try { json = JSON.parse(readFileSync(file, "utf8")) as typeof json; } catch (e) { return result("פענוח .mcp.json", false, `JSON לא תקין: ${(e as Error).message.slice(0, 120)}`); }
  const name = String(c.params.server ?? c.params.name ?? "");
  if (!name) return result("פענוח .mcp.json", false, "לרכיב אין שם שרת");
  const entry = name ? json.mcpServers?.[name] : undefined;
  if (!entry) return result("פענוח .mcp.json", false, `השרת "${name}" לא נמצא בקובץ`);
  if (entry.url && /\{[a-z]+\}/.test(entry.url)) return result("פענוח .mcp.json", null, `נכתב עם מקום להשלמה (${entry.url}) — דורש את פרטי הסביבה של הלקוח לפני חיבור; לא חובר כאן`);
  return result("פענוח .mcp.json", null, "הקובץ תקין; החיבור עצמו וספירת הטוקנים נעשים בסשן הראשון עם הרשאות הלקוח");
}

export function validateFileLines(c: Component, dir: string, file: string): ComponentValidation {
  const abs = path.join(dir, file);
  if (!existsSync(abs)) return result(`הקובץ ${file}`, false, "לא נכתב");
  const text = readFileSync(abs, "utf8");
  const wanted = (Array.isArray(c.params.entries) ? c.params.entries : Array.isArray(c.params.paths) ? c.params.paths : []) as string[];
  const missing = wanted.filter((w) => !text.includes(w));
  return missing.length ? result(`הקובץ ${file}`, false, `חסרות שורות: ${missing.slice(0, 3).join(", ")}`) : result(`הקובץ ${file}`, true, `${wanted.length || "כל"} השורות נמצאות`);
}

/** The local gate is run for real — that is the verification loop. A build that cannot run here says so (exit 3), and that is recorded, not hidden. */
export function validateScript(c: Component, dir: string): ComponentValidation {
  const file = c.files.find((f) => f.endsWith(".mjs") || f.endsWith(".sh"));
  if (!file) return result("הרצת הסקריפט", false, "לא נכתב");
  const r = spawnSync(process.execPath, [path.join(dir, file)], { cwd: dir, encoding: "utf8", timeout: 15 * 60_000, env: { ...process.env, CI: "1" } });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const verdict = out.split("\n").reverse().find((l) => l.startsWith("VERIFY:")) ?? "";
  if (r.status === 0) return result("הרצת סקריפט האימות", true, verdict || "עבר");
  if (r.status === 3) return result("הרצת סקריפט האימות", null, verdict || "אי אפשר להריץ כאן");
  return result("הרצת סקריפט האימות", false, `${verdict || `קוד ${r.status}`}: ${out.trim().split("\n").slice(-3).join(" | ").slice(0, 300)}`);
}

export function validateComponent(c: Component, dir: string, knownCommands: readonly string[], appended?: ReadonlyMap<string, string>): ComponentValidation {
  switch (c.kind) {
    case "hook": return validateHook(c, dir);
    case "permission": case "settings": return validateSettings(dir, c);
    case "plugin": case "lsp": {
      const v = validateSettings(dir, c);
      return v.passed ? result("פענוח .claude/settings.json", null, "רשום ב-enabledPlugins; Claude Code מתקין אותו בסשן הראשון, ואז נמדדת עלות ההקשר") : v;
    }
    case "gitignore": return validateFileLines(c, dir, ".gitignore");
    case "gitattributes": return validateFileLines(c, dir, ".gitattributes");
    case "script": return validateScript(c, dir);
    case "skill": return validateSkill(c, dir);
    case "agent": return validateAgent(c, dir);
    case "mcp": return validateMcp(c, dir);
    case "rule": case "doc": case "scaffold": case "review": case "pr_template": return validateText(c, dir, knownCommands, appended);
    case "runner": return result("—", null, "לא רכיב שמותקן: דרישה מהלקוח (ראו כרטיס הכנות)");
    case "report": return result("—", null, "דיווח, לא התקנה");
    case "devcontainer": return validateText(c, dir, knownCommands, appended);
  }
}

/* ── the joint check over the whole set ───────────────────────────── */

const ALWAYS_LOADED = ["CLAUDE.md", "AGENTS.md"];

export function jointCheck(cards: readonly Component[], dir: string): { duplicates: string[]; contradictions: string[]; alwaysLoadedTokens: number } {
  const writers = new Map<string, string[]>();
  for (const c of cards) for (const f of c.files) writers.set(f, [...(writers.get(f) ?? []), c.key]);
  // Shared files (settings, AGENTS.md, .gitignore) are merged on purpose; a duplicate is two components owning one file of their own.
  const shared = /^(\.claude\/settings\.json|\.mcp\.json|AGENTS\.md|CLAUDE\.md|\.gitignore|\.gitattributes)$/;
  const duplicates = [...writers].filter(([f, ks]) => ks.length > 1 && !shared.test(f)).map(([f, ks]) => `${f}: ${ks.join(", ")}`);
  const contradictions: string[] = [];
  const denied = cards.filter((c) => c.kind === "permission").flatMap((c) => (Array.isArray(c.params.deny) ? (c.params.deny as string[]) : []));
  for (const c of cards) {
    if (c.kind === "skill" || c.kind === "agent" || c.kind === "doc") for (const f of c.files) if (denied.some((d) => d.includes("Read(") && f.startsWith(d.replace(/^Read\(|\)$/g, "").replace(/\/\*\*$/, "")))) contradictions.push(`${c.key}: הקובץ ${f} נמצא תחת איסור קריאה (${c.kind} שאי אפשר לקרוא)`);
  }
  let chars = 0;
  for (const f of ALWAYS_LOADED) { const p = path.join(dir, f); if (existsSync(p)) chars += statSync(p).size; }
  const rulesDir = path.join(dir, ".claude", "rules");
  if (existsSync(rulesDir)) for (const f of readdirSync(rulesDir)) if (f.endsWith(".md")) chars += statSync(path.join(rulesDir, f)).size;
  const mcpTokens = cards.filter((c) => c.kind === "mcp" && (c.status === "installed" || c.status === "verified")).reduce((a, c) => a + (c.contextTokens ?? 0), 0);
  return { duplicates, contradictions, alwaysLoadedTokens: Math.round(chars / 4) + mcpTokens };
}

/** A scratch copy for tests of the validators, so nothing touches a real worktree. */
export const scratchDir = () => mkdtempSync(path.join(os.tmpdir(), "dcc-verify-"));
