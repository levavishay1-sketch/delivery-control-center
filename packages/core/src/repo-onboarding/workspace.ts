import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureCheckout, git } from "../ai-assist.ts";
import type { OnboardingWorkspace } from "./types.ts";

/**
 * Isolated Git workspace per onboarding run (spec §3/§34 Phase 1).
 *
 * `git worktree` off the existing shared clone (`ensureCheckout`), not a
 * fresh clone per run — see the approved plan's reasoning: the isolation
 * requirement ("no parallel run mutates another's working directory") is
 * about the working tree, which a worktree gives for free off one
 * already-up-to-date shared clone. A real repo tested this session
 * (Altshuler Trade) vendors ~1000 DLLs/PDBs — cloning fresh per run would
 * repeatedly pay that download cost; a worktree pays it once.
 */

// `os.homedir()`, not `os.tmpdir()` — see the identical fix + full
// explanation on `REPO_CACHE` in `ai-assist.ts`: on this machine `TEMP`/
// `TMP` resolve to a Windows 8.3 short-name path segment
// (`C:\Users\AVISHA~1\...`) that Claude Code's own write-permission
// check flags as suspicious, silently blocking every file write a
// write-mode onboarding stage makes (confirmed live: `claude_md_
// generation`/`scoped_rules` both reported `status: "Completed"` with
// zero files actually written, Claude's own text response explaining
// the blocked-pending-approval write).
const ONBOARDING_CACHE = path.join(os.homedir(), ".dcc-repos-onboarding");

/** On Windows, `core.longpaths` must be set explicitly (it's off by
 *  default even when the OS itself has long-path support enabled) or a
 *  checkout with deeply-nested paths fails partway through. Confirmed
 *  live on the real Altshuler Trade repo: `git worktree add` into a
 *  UUID-named directory (the run-id) failed with "fatal: Could not reset
 *  index file to revision 'HEAD'" after checking out 100% of files —
 *  the same command with a short directory name succeeded — and adding
 *  `-c core.longpaths=true` fixed the UUID-path case outright. Prepended
 *  to every git invocation here, not just worktree add, since the clone
 *  fallback and `releaseOnboardingWorkspace`'s cleanup hit the same
 *  nested-path files. */
const LONGPATHS = process.platform === "win32" ? ["-c", "core.longpaths=true"] : [];

function run(args: string[], cwd?: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn("git", [...LONGPATHS, ...args], { cwd, windowsHide: true, shell: process.platform === "win32" });
    p.on("close", (code) => resolve(code ?? 1));
    p.on("error", () => resolve(1));
  });
}

/** Creates (or reuses, if already set up for this exact runId) an isolated
 *  worktree pinned to the repo's current default-branch HEAD, on its own
 *  `ai/repository-onboarding/<runId>` branch. The directory name is
 *  derived from `runId` alone — deliberately decoupled from the branch
 *  name (which contains `/` and would otherwise nest as literal folders
 *  if naively joined into a path). */
export async function ensureOnboardingWorkspace(
  repo: { id: string; name: string; localPath: string | null; adoRepoRef: string | null },
  runId: string,
): Promise<OnboardingWorkspace> {
  const sharedDir = await ensureCheckout(repo);
  if (!sharedDir) throw new Error(`אין אפשרות לשכפל/לגשת לריפוזיטורי ${repo.name} — בדוק את כתובת ה-Git שלו`);

  const baselineSha = (await git(["rev-parse", "HEAD"], sharedDir)).out.trim();
  const branch = `ai/repository-onboarding/${runId}`;
  mkdirSync(ONBOARDING_CACHE, { recursive: true });
  const worktreeDir = path.join(ONBOARDING_CACHE, runId);

  // A stage retry re-enters this same runId/path (state-machine resumability
  // design) — but a PREVIOUS attempt that was interrupted mid-checkout
  // (e.g. the API process was killed) can leave a stale, partially-checked-
  // -out directory and/or a stale `branch` ref registered on the shared
  // clone behind. `git worktree add` is not idempotent against either —
  // confirmed live (a killed-mid-checkout retry on the real ~1000-file
  // Altshuler Trade repo failed both the worktree AND the clone fallback
  // because the target path already existed with partial content). Clear
  // both defensively before every attempt; safe because a workspace path
  // is always scoped to one runId and never read by anything else.
  if (existsSync(worktreeDir)) {
    await git([...LONGPATHS, "worktree", "remove", worktreeDir, "--force"], sharedDir);
    rmSync(worktreeDir, { recursive: true, force: true });
  }
  await git(["worktree", "prune"], sharedDir);
  await git(["branch", "-D", branch], sharedDir);

  const added = await git([...LONGPATHS, "worktree", "add", "-b", branch, worktreeDir, baselineSha], sharedDir);
  if (added.code === 0) {
    return { dir: worktreeDir, baselineSha, branch, kind: "worktree" };
  }

  // Fallback: a fresh, fully isolated clone at the same path. Same
  // reasoning ensureCheckout's own first-clone path uses (depth 80).
  const gitUrl = repo.adoRepoRef;
  if (!gitUrl) throw new Error(`worktree נכשל (${added.out.slice(0, 200)}) ואין כתובת git לשכפול חלופי`);
  const cloneCode = await run(["clone", "--depth", "80", gitUrl, worktreeDir]);
  if (cloneCode !== 0) throw new Error(`worktree נכשל (${added.out.slice(0, 200)}) וגם שכפול חלופי נכשל עבור ${repo.name}`);
  await git([...LONGPATHS, "checkout", "-b", branch, baselineSha], worktreeDir);
  return { dir: worktreeDir, baselineSha, branch, kind: "clone" };
}

/** Removes an onboarding worktree/clone. NOT called automatically on run
 *  completion or failure (Phase 1 decision, approved plan §3) — a
 *  developer will want to inspect a failed worktree, and later stages may
 *  still need to read a completed one. Automatic GC/TTL is out of scope
 *  for this pass; call this explicitly when a workspace is truly done with. */
export async function releaseOnboardingWorkspace(runId: string, repoSharedDir?: string): Promise<void> {
  const worktreeDir = path.join(ONBOARDING_CACHE, runId);
  if (repoSharedDir) await git([...LONGPATHS, "worktree", "remove", worktreeDir, "--force"], repoSharedDir);
  await run(["worktree", "prune"], repoSharedDir);
}
