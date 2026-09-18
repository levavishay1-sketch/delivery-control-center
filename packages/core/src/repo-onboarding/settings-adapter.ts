import type { EffectivePolicy } from "./security-profiles.ts";

/**
 * Claude settings adapter — the ONE place besides `ClaudeCodeRunner`
 * allowed to know Claude Code's on-disk config schema. Translates an
 * `EffectivePolicy` + the approved hooks into the persisted
 * `.claude/settings.json` shape (`permissions.allow/deny`, `hooks.<Event>`
 * = array of `{matcher?, hooks: [{type:"command", command}]}`).
 *
 * `"ask"`-valued policy axes are intentionally NOT emitted: the generated
 * file serves interactive developer sessions, where Claude Code's own
 * modes already prompt for anything not allowed or denied, and an `ask`
 * rule would only make auto mode prompt where it otherwise wouldn't.
 * Only the unambiguous `allow`/`deny` axes are baked in.
 *
 * When the repository already has a settings file and the boundaries
 * decision was "merge", `mergeClaudeSettings` keeps everything it had
 * and unions DCC's deny rules and hook entries in — it never removes a
 * rule the team wrote.
 */

export type HookEvent = "PreToolUse" | "PostToolUse" | "SessionStart" | "SessionEnd";

export type HookSpec = {
  id: string;
  event: HookEvent;
  matcher?: string;
  /** Relative to the repo root, e.g. ".claude/hooks/protect-secrets.mjs". */
  hookPath: string;
};

export type ClaudeSettingsJson = {
  permissions?: { allow?: string[]; deny?: string[] };
  hooks?: Record<string, { matcher?: string; hooks: { type: "command"; command: string }[] }[]>;
  [key: string]: unknown;
};

const VERB_TO_PATHS: Record<string, "allow" | "deny"> = { allow: "allow", deny: "deny" };

export const hookCommand = (hookPath: string) => `node "$CLAUDE_PROJECT_DIR/${hookPath}"`;

export function buildClaudeSettings(policy: EffectivePolicy, enabledHooks: HookSpec[]): ClaudeSettingsJson {
  const allow: string[] = [];
  const deny: string[] = [...policy.deniedReadPaths];

  const applyVerb = (verb: string, rule: string) => {
    const mapped = VERB_TO_PATHS[verb];
    if (mapped === "allow") allow.push(rule);
    else if (mapped === "deny") deny.push(rule);
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
  if (enabledHooks.length) {
    settings.hooks = {};
    for (const g of enabledHooks) {
      settings.hooks[g.event] ??= [];
      settings.hooks[g.event]!.push({ ...(g.matcher ? { matcher: g.matcher } : {}), hooks: [{ type: "command", command: hookCommand(g.hookPath) }] });
    }
  }
  return settings;
}

/** Existing file wins on every key it has; DCC only adds deny rules and
 *  hook entries that aren't already there (matched by command text). */
export function mergeClaudeSettings(existing: ClaudeSettingsJson, generated: ClaudeSettingsJson): ClaudeSettingsJson {
  const out: ClaudeSettingsJson = { ...existing };
  const exPerm = existing.permissions ?? {};
  const genPerm = generated.permissions ?? {};
  const deny = Array.from(new Set([...(exPerm.deny ?? []), ...(genPerm.deny ?? [])]));
  const allow = Array.from(new Set([...(exPerm.allow ?? []), ...(genPerm.allow ?? [])]));
  if (deny.length || allow.length) out.permissions = { ...exPerm, ...(allow.length ? { allow } : {}), ...(deny.length ? { deny } : {}) };
  if (generated.hooks) {
    const hooks: NonNullable<ClaudeSettingsJson["hooks"]> = { ...(existing.hooks ?? {}) };
    for (const [event, entries] of Object.entries(generated.hooks)) {
      const current = [...(hooks[event] ?? [])];
      const known = new Set(current.flatMap((e) => e.hooks.map((h) => h.command)));
      for (const e of entries) if (!e.hooks.every((h) => known.has(h.command))) current.push(e);
      hooks[event] = current;
    }
    out.hooks = hooks;
  }
  return out;
}
