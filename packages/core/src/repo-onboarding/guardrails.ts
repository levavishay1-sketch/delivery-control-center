import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HookSpec } from "./settings-adapter.ts";

/**
 * Guardrail catalog — a small, DCC-reviewed set of deterministic
 * `PreToolUse` hooks. Enforcement lives in hooks, never in prose
 * instructions ("an instruction like 'never edit .env' in CLAUDE.md is a
 * request, not a guarantee. A PreToolUse hook that blocks the edit is
 * enforcement" — Claude Code docs, Extend Claude Code). Templates are
 * pre-authored and reviewed once here, not regenerated per run.
 */

const TEMPLATE_DIR = fileURLToPath(new URL("./guardrail-templates/", import.meta.url));

export type GuardrailDefinition = {
  id: string;
  label_he: string;
  description_he: string;
  event: "PreToolUse";
  matcher: string;
  templateFile: string;
  /** Needs `{{PROTECTED_GLOBS}}` substitution from repo-specific discovery. */
  needsProtectedGlobs: boolean;
  /** Deterministic applicability — a suggestion for the plan, never
   *  applied without the plan being approved. */
  isApplicable(ctx: { protectedGlobs: string[] }): boolean;
};

export const GUARDRAIL_CATALOG: GuardrailDefinition[] = [
  {
    id: "protect-secrets", label_he: "הגנה על סודות", event: "PreToolUse", matcher: "Read",
    description_he: "חוסם קריאה של קבצים שנראים כמו סודות/אישורי גישה (.env, מפתחות, credentials) — ללא תלות בכללי הקריאה המאושרים.",
    templateFile: "protect-secrets.mjs", needsProtectedGlobs: false,
    isApplicable: () => true,
  },
  {
    id: "prevent-dangerous-git", label_he: "מניעת פעולות Git מסוכנות", event: "PreToolUse", matcher: "Bash",
    description_he: "חוסם force-push, git reset --hard ופעולות Git הרסניות/שמשכתבות היסטוריה.",
    templateFile: "prevent-dangerous-git.mjs", needsProtectedGlobs: false,
    isApplicable: () => true,
  },
  {
    id: "protect-generated-code", label_he: "הגנה על קוד מיוצר", event: "PreToolUse", matcher: "Write|Edit",
    description_he: "חוסם כתיבה לאזורים שזוהו ב-Discovery כמיוצרים אוטומטית — עריכה ידנית שם נדרסת על ידי הגנרטור.",
    templateFile: "protect-generated-code.mjs", needsProtectedGlobs: true,
    isApplicable: (ctx) => ctx.protectedGlobs.length > 0,
  },
  {
    id: "restrict-write-paths", label_he: "הגבלת נתיבי כתיבה", event: "PreToolUse", matcher: "Write|Edit",
    description_he: "חוסם כתיבה לנתיבים רגישים בעלי טווח פגיעה גבוה (CI/CD, תשתית) — שינויים שם עוברים PR אנושי.",
    templateFile: "restrict-write-paths.mjs", needsProtectedGlobs: true,
    isApplicable: (ctx) => ctx.protectedGlobs.length > 0,
  },
];

export function getGuardrailDefinition(id: string): GuardrailDefinition | undefined {
  return GUARDRAIL_CATALOG.find((g) => g.id === id);
}

export function renderGuardrailScript(def: GuardrailDefinition, protectedGlobs: string[]): string {
  const raw = readFileSync(path.join(TEMPLATE_DIR, def.templateFile), "utf8");
  if (!def.needsProtectedGlobs) return raw;
  return raw.replace("{{PROTECTED_GLOBS}}", JSON.stringify(protectedGlobs));
}

export function guardrailHookPath(def: GuardrailDefinition): string {
  return `.claude/hooks/${def.id}.mjs`;
}

export function toHookSpec(def: GuardrailDefinition): HookSpec {
  return { id: def.id, event: def.event, matcher: def.matcher, hookPath: guardrailHookPath(def) };
}

/** `generated_or_protected_areas` entries can carry commentary after the
 *  path ("Shared/Entities.cs (98,438 lines, auto-generated)"); a hook
 *  matching on the whole string would never fire. Keep the path only. */
export function cleanPathFragment(raw: string): string {
  const cut = raw.search(/\s+[(—]|\s+-\s+/);
  return (cut >= 0 ? raw.slice(0, cut) : raw).trim().replace(/^\.?\//, "");
}
