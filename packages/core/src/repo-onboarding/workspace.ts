import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureCheckout, git } from "../ai-assist.ts";
import type { ExistingSetup } from "./types.ts";

/**
 * The isolated working copy an onboarding run edits: a `git worktree` off
 * the shared clone (`ensureCheckout`), on its own branch, pinned to a
 * recorded baseline commit. The developer's own checkout is never touched,
 * and a large repository is downloaded once, not once per run.
 *
 * `os.homedir()`, not `os.tmpdir()`: on this machine `TEMP` resolves to a
 * Windows 8.3 short-name path (`C:\Users\AVISHA~1\...`) that Claude Code's
 * own write-permission check treats as suspicious, silently blocking every
 * file write a session makes in it.
 */
export const ONBOARDING_ROOT = path.join(os.homedir(), ".dcc-repos-onboarding");

/** Per-run files DCC itself keeps (terminal log, status-line snapshot).
 *  Deliberately outside the worktree, so they never show up in the diff. */
export const runtimeDir = (runId: string) => path.join(ONBOARDING_ROOT, "_runtime", runId);

/** `core.longpaths` is off by default on Windows even when the OS allows
 *  long paths; a deep checkout fails partway through without it. */
const LONGPATHS = process.platform === "win32" ? ["-c", "core.longpaths=true"] : [];

export type OnboardingWorkspace = { dir: string; baselineSha: string; branch: string; defaultBranch: string | null };

export async function ensureOnboardingWorkspace(
  repo: { id: string; name: string; localPath: string | null; adoRepoRef: string | null },
  runId: string,
  log: (line: string) => void,
): Promise<OnboardingWorkspace> {
  log(`dcc$ fetch ${repo.adoRepoRef ?? repo.localPath ?? repo.name}`);
  const sharedDir = await ensureCheckout(repo);
  if (!sharedDir) throw new Error(`אין אפשרות לשכפל או לגשת לריפו ${repo.name} — בדוק את כתובת ה-Git שלו`);

  const baselineSha = (await git(["rev-parse", "HEAD"], sharedDir)).out.trim();
  const head = await git(["symbolic-ref", "--short", "HEAD"], sharedDir);
  const defaultBranch = head.code === 0 ? head.out.trim() || null : null;
  const branch = `ai/onboarding/${runId.slice(0, 8)}`;
  mkdirSync(ONBOARDING_ROOT, { recursive: true });
  const dir = path.join(ONBOARDING_ROOT, runId);

  // Rerunning this stage for the same run: a previous attempt may have left
  // a partial checkout or a registered branch behind, and `worktree add` is
  // not idempotent against either. Both are scoped to this run alone.
  if (existsSync(dir)) {
    await git([...LONGPATHS, "worktree", "remove", dir, "--force"], sharedDir);
    rmSync(dir, { recursive: true, force: true });
  }
  await git(["worktree", "prune"], sharedDir);
  await git(["branch", "-D", branch], sharedDir);

  log(`dcc$ git worktree add -b ${branch} ${dir} ${baselineSha.slice(0, 7)}`);
  const added = await git([...LONGPATHS, "worktree", "add", "-b", branch, dir, baselineSha], sharedDir, { timeoutMs: 600_000 });
  if (added.code !== 0) throw new Error(`יצירת העותק המבודד נכשלה: ${added.out.slice(0, 300)}`);
  return { dir, baselineSha, branch, defaultBranch };
}

export async function trackedFileCount(dir: string): Promise<number> {
  const r = await git(["ls-files"], dir, { timeoutMs: 60_000 });
  return r.out.split("\n").filter((l) => l.trim()).length;
}

const countIn = (dir: string, pick: (name: string, full: string) => boolean): number => {
  try { return readdirSync(dir).filter((n) => pick(n, path.join(dir, n))).length; } catch { return 0; }
};

/** What Claude Code configuration the repository already carries — one line
 *  on the stage card, so `/init`'s "I found an existing CLAUDE.md" question
 *  does not come as a surprise. */
export function existingSetup(dir: string): ExistingSetup {
  const claudeMd = path.join(dir, "CLAUDE.md");
  const dotClaude = path.join(dir, ".claude");
  return {
    claudeMdLines: existsSync(claudeMd) ? readFileSync(claudeMd, "utf8").split("\n").length : null,
    agentsMd: existsSync(path.join(dir, "AGENTS.md")),
    rules: countIn(path.join(dotClaude, "rules"), (n) => n.endsWith(".md")),
    skills: countIn(path.join(dotClaude, "skills"), (_n, full) => existsSync(path.join(full, "SKILL.md"))),
    hooks: countIn(path.join(dotClaude, "hooks"), (n) => !n.startsWith(".")),
    agents: countIn(path.join(dotClaude, "agents"), (n) => n.endsWith(".md")),
    settings: existsSync(path.join(dotClaude, "settings.json")),
  };
}
