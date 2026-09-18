import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HookSpec } from "./settings-adapter.ts";

/**
 * DCC's own capture hooks (SessionStart → Context Brief, SessionEnd →
 * `claude.session` event, PostToolUse(Bash) → `git.activity` event) are
 * copied INTO the client repository so a committed `.claude/settings.json`
 * can reference them by `$CLAUDE_PROJECT_DIR` — an absolute path on one
 * developer's machine would not survive a clone. The scripts are the
 * same files this repository dogfoods (`hooks/`); each developer still
 * needs `DCC_DEV_EMAIL` / `DCC_HOOK_TOKEN` in their shell (hooks/README.md).
 */

const SOURCE_DIR = fileURLToPath(new URL("../../../../hooks/", import.meta.url));
export const DCC_HOOKS_DIR = ".claude/hooks/dcc";
const FILES = ["lib.mjs", "session-start.mjs", "session-end.mjs", "post-tool-use.mjs"] as const;

export function dccHookSpecs(): HookSpec[] {
  return [
    { id: "dcc-session-start", event: "SessionStart", hookPath: `${DCC_HOOKS_DIR}/session-start.mjs` },
    { id: "dcc-session-end", event: "SessionEnd", hookPath: `${DCC_HOOKS_DIR}/session-end.mjs` },
    { id: "dcc-post-tool-use", event: "PostToolUse", matcher: "Bash", hookPath: `${DCC_HOOKS_DIR}/post-tool-use.mjs` },
  ];
}

export function dccHooksAvailable(): boolean {
  return FILES.every((f) => existsSync(path.join(SOURCE_DIR, f)));
}

/** Writes the hook scripts and a `.dcc.json` (only when absent — an
 *  existing one is the team's). Returns repo-relative paths written. */
export function materializeDccHooks(workspaceDir: string, cfg: { apiUrl: string; clientId: string; repoName: string }): string[] {
  const written: string[] = [];
  const dir = path.join(workspaceDir, DCC_HOOKS_DIR);
  mkdirSync(dir, { recursive: true });
  for (const f of FILES) {
    copyFileSync(path.join(SOURCE_DIR, f), path.join(dir, f));
    written.push(`${DCC_HOOKS_DIR}/${f}`);
  }
  const dccJson = path.join(workspaceDir, ".dcc.json");
  if (!existsSync(dccJson)) {
    writeFileSync(dccJson, JSON.stringify({ apiUrl: cfg.apiUrl, clientId: cfg.clientId, repo: cfg.repoName }, null, 2) + "\n", "utf8");
    written.push(".dcc.json");
  }
  return written;
}
