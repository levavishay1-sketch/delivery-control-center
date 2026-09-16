import type { EffectivePolicy } from "./security-profiles.ts";

/**
 * Claude settings adapter (spec §11/§2 "Critical Technical Constraint" —
 * the ONE place besides `ClaudeCodeRunner` allowed to know Claude Code's
 * on-disk config schema). Translates an `EffectivePolicy` + the approved
 * guardrail hooks into the real, persisted `.claude/settings.json` shape
 * — confirmed live against two sources of truth: `ai-assist.ts`'s own
 * `--settings` construction (`{"permissions": {"deny": string[]}}`) and
 * this repo's own dogfooded `.claude/settings.json` (`hooks.<Event>` =
 * array of `{matcher?, hooks: [{type:"command", command:"..."}]}`).
 *
 * `"ask"`-valued policy axes are intentionally NOT emitted as Claude
 * Code `ask` permission rules here — this settings.json is generated for
 * INTERACTIVE developer sessions after onboarding (where an ask-prompt
 * has a human to answer it), but the onboarding pipeline itself has no
 * concept of "ask" (every pipeline stage runs headless). Rather than
 * silently guess how a future interactive session should resolve "ask",
 * this adapter only emits the unambiguous `allow`/`deny` axes; `"ask"`
 * axes are surfaced in the stage result for a human to review, not
 * baked into the committed artifact.
 */

export type GuardrailHookSpec = {
  id: string;
  event: "PreToolUse";
  matcher: string;
  /** Relative to the repo root, e.g. ".claude/hooks/protect-secrets.mjs". */
  hookPath: string;
};

const VERB_TO_PATHS: Record<string, "allow" | "deny"> = { allow: "allow", deny: "deny" };

export type ClaudeSettingsJson = {
  permissions?: { allow?: string[]; deny?: string[] };
  hooks?: Record<string, { matcher?: string; hooks: { type: "command"; command: string }[] }[]>;
};

export function buildClaudeSettings(policy: EffectivePolicy, enabledGuardrails: GuardrailHookSpec[]): ClaudeSettingsJson {
  const allow: string[] = [];
  const deny: string[] = [...policy.deniedReadPaths];

  const applyVerb = (verb: string, rule: string) => {
    const mapped = VERB_TO_PATHS[verb];
    if (mapped === "allow") allow.push(rule);
    else if (mapped === "deny") deny.push(rule);
    // "ask" is deliberately omitted — see module doc comment.
  };

  applyVerb(policy.profile.write, "Write");
  applyVerb(policy.profile.commands.destructive, "Bash(rm:*)");
  applyVerb(policy.profile.commands.git_push, "Bash(git push:*)");
  applyVerb(policy.profile.commands.deployment, "Bash(*deploy*)");
  applyVerb(policy.profile.network, "WebFetch");
  applyVerb(policy.profile.mcp, "mcp__*");

  const settings: ClaudeSettingsJson = {};
  if (allow.length || deny.length) {
    settings.permissions = {};
    if (allow.length) settings.permissions.allow = Array.from(new Set(allow));
    if (deny.length) settings.permissions.deny = Array.from(new Set(deny));
  }
  if (enabledGuardrails.length) {
    settings.hooks = {};
    for (const g of enabledGuardrails) {
      settings.hooks[g.event] ??= [];
      settings.hooks[g.event]!.push({ matcher: g.matcher, hooks: [{ type: "command", command: `node "$CLAUDE_PROJECT_DIR/${g.hookPath}"` }] });
    }
  }
  return settings;
}
