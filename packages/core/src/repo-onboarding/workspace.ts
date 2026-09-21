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

export type OnboardingWorkspace = {
  dir: string; baselineSha: string; branch: string;
  /** The repository's main line — the branch the run is cut from and will be delivered back to. */
  defaultBranch: string | null;
  /** How that baseline was found, so the screen can say it and a fallback is never silent. */
  baseFrom: "remote" | "local" | "head";
};

/**
 * Which commit a run starts from.
 *
 * Never the working copy's HEAD. A shared clone may also be somebody's own
 * working folder (`repo.localPath`), and `ensureCheckout` hands that folder
 * back untouched — so it stands on whatever branch they last switched to. A
 * run cut from there quietly carries their unmerged work into its own branch,
 * and from there into the pull request it opens: this repository's own
 * onboarding run was cut from `project/info-hints` and its request arrived
 * carrying that whole project.
 *
 * So the baseline comes from the main line as the remote declares it, and
 * `git fetch` makes sure that line is current. Fetching only moves
 * remote-tracking refs: it is safe in a folder somebody is working in, which
 * `reset`/`checkout` would not be.
 */
async function resolveBaseline(sharedDir: string, log: (line: string) => void): Promise<{ sha: string; branch: string | null; from: OnboardingWorkspace["baseFrom"] }> {
  const head = async (ref: string) => (await git(["rev-parse", "--verify", "--quiet", ref], sharedDir)).out.trim();

  const hasOrigin = (await git(["remote", "get-url", "origin"], sharedDir)).code === 0;
  if (hasOrigin) {
    log("dcc$ git fetch origin --prune");
    await git(["fetch", "origin", "--prune"], sharedDir, { timeoutMs: 300_000 });
    // `origin/HEAD` is what the remote calls its main line; a clone made with
    // `--depth` or an older git may not have it until it is asked for.
    let ref = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], sharedDir)).out.trim();
    if (!ref) {
      await git(["remote", "set-head", "origin", "-a"], sharedDir, { timeoutMs: 120_000 });
      ref = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], sharedDir)).out.trim();
    }
    const sha = ref ? await head(ref) : "";
    if (sha) return { sha, branch: ref.replace(/^origin\//, ""), from: "remote" };
  }

  // No remote, or a remote that would not say: the local main line, by its usual names.
  for (const name of ["main", "master"]) {
    const sha = await head(`refs/heads/${name}`);
    if (sha) {
      log(`dcc$ no origin/HEAD — using local ${name}`);
      return { sha, branch: name, from: "local" };
    }
  }

  const sha = await head("HEAD");
  if (!sha) throw new Error("העותק המקומי לא שלם — אין ממה להתחיל");
  const current = (await git(["symbolic-ref", "--short", "HEAD"], sharedDir)).out.trim() || null;
  log(`dcc$ no main line found — starting from the current branch (${current ?? "detached"})`);
  return { sha, branch: current, from: "head" };
}

export async function ensureOnboardingWorkspace(
  repo: { id: string; name: string; localPath: string | null; adoRepoRef: string | null },
  runId: string,
  log: (line: string) => void,
): Promise<OnboardingWorkspace> {
  log(`dcc$ fetch ${repo.adoRepoRef ?? repo.localPath ?? repo.name}`);
  const sharedDir = await ensureCheckout(repo);
  if (!sharedDir) throw new Error(`אין אפשרות לשכפל או לגשת לריפו ${repo.name} — בדוק את כתובת ה-Git שלו`);

  if ((await git(["rev-parse", "--verify", "--quiet", "HEAD"], sharedDir)).out.trim() === "") {
    throw new Error(`העותק המקומי של ${repo.name} לא שלם — מחקו את ${sharedDir} והריצו את השלב שוב`);
  }
  const base = await resolveBaseline(sharedDir, log);
  const baselineSha = base.sha;
  const defaultBranch = base.branch;
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

  log(`dcc$ git worktree add -b ${branch} ${dir} ${baselineSha.slice(0, 7)}  # ${defaultBranch ?? "HEAD"}`);
  const added = await git([...LONGPATHS, "worktree", "add", "-b", branch, dir, baselineSha], sharedDir, { timeoutMs: 600_000 });
  if (added.code !== 0) throw new Error(`יצירת העותק המבודד נכשלה: ${added.out.slice(0, 300)}`);
  return { dir, baselineSha, branch, defaultBranch, baseFrom: base.from };
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
