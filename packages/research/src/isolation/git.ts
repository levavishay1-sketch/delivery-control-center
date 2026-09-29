import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * HELPER. git for the harness, with the user's configuration kept out: no
 * system config, an empty global config, no prompts, no automatic gc, and
 * byte-exact checkouts (core.autocrlf=false) so that a working tree can be
 * compared with the blobs it came from. The agent gets the same isolation
 * through its environment (see runner/env.ts).
 */

let emptyGlobal: string | null = null;

export function emptyGitConfig(): string {
  if (emptyGlobal === null) {
    const dir = mkdtempSync(path.join(tmpdir(), "dcc-git-config-"));
    emptyGlobal = path.join(dir, "gitconfig");
    writeFileSync(emptyGlobal, "");
  }
  return emptyGlobal;
}

export function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: emptyGitConfig(),
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "pilot", GIT_AUTHOR_EMAIL: "pilot@invalid",
    GIT_COMMITTER_NAME: "pilot", GIT_COMMITTER_EMAIL: "pilot@invalid",
    ...extra,
  };
}

const BASE = ["-c", "core.autocrlf=false", "-c", "core.longpaths=true", "-c", "gc.auto=0", "-c", "advice.detachedHead=false"];

/** Runs git and returns stdout without the trailing newline; throws with stderr on failure. */
export function git(cwd: string, args: readonly string[], opts: { input?: string; env?: Record<string, string> } = {}): string {
  try {
    return execFileSync("git", [...BASE, ...args], {
      cwd, env: gitEnv(opts.env), encoding: "utf8", input: opts.input, maxBuffer: 512 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
    }).replace(/\n$/, "");
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${(err.stderr ?? err.message).toString().trim()}`, { cause: e });
  }
}

/** Runs git and reports only whether it succeeded (for checks such as cat-file -e). */
export function gitOk(cwd: string, args: readonly string[]): boolean {
  return spawnSync("git", [...BASE, ...args], { cwd, env: gitEnv(), stdio: "ignore" }).status === 0;
}
