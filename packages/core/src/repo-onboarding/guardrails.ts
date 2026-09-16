import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GuardrailHookSpec } from "./settings-adapter.ts";

/**
 * Guardrail catalog (spec §19 Stage 12). A small, DCC-reviewed set of
 * deterministic safety hooks — "DCC should maintain a central catalog of
 * reviewed guardrails," per the spec, as the primary path; Claude
 * generating a repo-specific script is explicitly the spec's fallback
 * ("If Claude Code must generate..."), not the default. These templates
 * are pre-authored and reviewed once here, not regenerated per run.
 */

const TEMPLATE_DIR = fileURLToPath(new URL("./guardrail-templates/", import.meta.url));

export type GuardrailDefinition = {
  id: string;
  label: string;
  description: string;
  event: "PreToolUse";
  matcher: string;
  templateFile: string;
  /** Needs `{{PROTECTED_GLOBS}}` substitution from repo-specific discovery. */
  needsProtectedGlobs: boolean;
  /** Deterministic applicability heuristic — a suggestion for human
   *  review, never auto-applied without approval (same principle as
   *  `security_permissions`'s suggested rules). */
  isApplicable(ctx: { generatedOrProtectedAreas: unknown[] }): boolean;
};

export const GUARDRAIL_CATALOG: GuardrailDefinition[] = [
  {
    id: "protect-secrets", label: "הגנה על סודות", event: "PreToolUse", matcher: "Read",
    description: "חוסם קריאה של קבצים שנראים כמו סודות/אישורי גישה (.env, מפתחות, credentials) — ללא תלות בכללי הקריאה המאושרים.",
    templateFile: "protect-secrets.mjs", needsProtectedGlobs: false,
    isApplicable: () => true,
  },
  {
    id: "prevent-dangerous-git", label: "מניעת פעולות Git מסוכנות", event: "PreToolUse", matcher: "Bash",
    description: "חוסם force-push, git reset --hard ופעולות Git הרסניות/שמשכתבות היסטוריה אחרות.",
    templateFile: "prevent-dangerous-git.mjs", needsProtectedGlobs: false,
    isApplicable: () => true,
  },
  {
    id: "protect-generated-code", label: "הגנה על קוד מיוצר", event: "PreToolUse", matcher: "Write|Edit",
    description: "חוסם כתיבה לתוך אזורים שזוהו כמיוצרים אוטומטית (Generated) — עריכה ידנית שם נדרסת על ידי הגנרטור האמיתי.",
    templateFile: "protect-generated-code.mjs", needsProtectedGlobs: true,
    isApplicable: (ctx) => ctx.generatedOrProtectedAreas.length > 0,
  },
  {
    id: "restrict-write-paths", label: "הגבלת נתיבי כתיבה", event: "PreToolUse", matcher: "Write|Edit",
    description: "חוסם כתיבה לנתיבים רגישים בעלי טווח פגיעה גבוה (CI/CD, תשתית) — שינויים שם צריכים לעבור PR אנושי.",
    templateFile: "restrict-write-paths.mjs", needsProtectedGlobs: true,
    isApplicable: (ctx) => ctx.generatedOrProtectedAreas.length > 0,
  },
];

export function getGuardrailDefinition(id: string): GuardrailDefinition | undefined {
  return GUARDRAIL_CATALOG.find((g) => g.id === id);
}

/** Renders a guardrail's template into its final `.mjs` content, ready to
 *  write to `.claude/hooks/<id>.mjs`. `protectedGlobs` is only used when
 *  the definition needs it (`needsProtectedGlobs`); an empty list is
 *  valid — the resulting hook simply never matches, which is safer than
 *  refusing to generate it. */
export function renderGuardrailScript(def: GuardrailDefinition, protectedGlobs: string[]): string {
  const raw = readFileSync(path.join(TEMPLATE_DIR, def.templateFile), "utf8");
  if (!def.needsProtectedGlobs) return raw;
  return raw.replace("{{PROTECTED_GLOBS}}", JSON.stringify(protectedGlobs));
}

export function guardrailHookPath(def: GuardrailDefinition): string {
  return `.claude/hooks/${def.id}.mjs`;
}

export function toHookSpec(def: GuardrailDefinition): GuardrailHookSpec {
  return { id: def.id, event: def.event, matcher: def.matcher, hookPath: guardrailHookPath(def) };
}
