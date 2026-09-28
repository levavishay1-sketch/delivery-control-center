import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { git } from "../../ai-assist.ts";
import type { ChangedPath } from "./graders.ts";

/**
 * The two arms of a measurement: two detached worktrees off the shared clone,
 * both at the baseline commit — one holds nothing else ("without"), the other
 * holds exactly the files that would be delivered ("with"). A run resets its
 * arm to the baseline before every task, so no task sees another's changes.
 * Detached, off the shared clone directly: `ensureCheckout` would reset the
 * clone under a person's feet when it is their own folder.
 */

export type Arms = { with: string; without: string };

const LONG = ["-c", "core.longpaths=true"];

async function addWorktree(sharedDir: string, dir: string, sha: string): Promise<void> {
  if (existsSync(dir)) {
    await git([...LONG, "worktree", "remove", dir, "--force"], sharedDir, { timeoutMs: 120_000 });
    rmSync(dir, { recursive: true, force: true });
  }
  await git(["worktree", "prune"], sharedDir);
  mkdirSync(path.dirname(dir), { recursive: true });
  const r = await git([...LONG, "worktree", "add", "--detach", dir, sha], sharedDir, { timeoutMs: 600_000 });
  if (r.code !== 0) throw new Error(`worktree add failed for ${dir}: ${r.out.slice(0, 300)}`);
}

export async function prepareArms(sharedDir: string, baselineSha: string, root: string): Promise<Arms> {
  const arms: Arms = { with: path.join(root, "with"), without: path.join(root, "without") };
  await addWorktree(sharedDir, arms.without, baselineSha);
  await addWorktree(sharedDir, arms.with, baselineSha);
  return arms;
}

export async function removeArms(sharedDir: string, arms: Arms): Promise<void> {
  for (const dir of [arms.with, arms.without]) {
    try { await git([...LONG, "worktree", "remove", dir, "--force"], sharedDir, { timeoutMs: 120_000 }); } catch { /* best effort */ }
    rmSync(dir, { recursive: true, force: true });
  }
  await git(["worktree", "prune"], sharedDir);
}

/** Back to the baseline: every change undone, every new file (ignored ones too) gone. */
export async function resetArm(dir: string, baselineSha: string): Promise<void> {
  await git([...LONG, "reset", "--hard", baselineSha], dir, { timeoutMs: 300_000 });
  await git([...LONG, "clean", "-fdx"], dir, { timeoutMs: 300_000 });
}

/**
 * The delivered set into the "with" arm, file by file, from the run's copy.
 * `enabledPlugins` is dropped from the copied settings: a headless run would
 * try to install them from the marketplace at start, which is not what is
 * measured (they are `configured`, not exercised).
 */
export function copyDelivered(fromDir: string, toDir: string, files: readonly string[]): string[] {
  const copied: string[] = [];
  for (const rel of files) {
    const src = path.join(fromDir, rel);
    if (!existsSync(src) || !statSync(src).isFile()) continue;
    const dst = path.join(toDir, rel);
    mkdirSync(path.dirname(dst), { recursive: true });
    if (rel.replace(/\\/g, "/") === ".claude/settings.json") {
      try {
        const s = JSON.parse(readFileSync(src, "utf8")) as Record<string, unknown>;
        delete s.enabledPlugins;
        writeFileSync(dst, JSON.stringify(s, null, 2));
      } catch { copyFileSync(src, dst); }
    } else copyFileSync(src, dst);
    copied.push(rel);
  }
  return copied;
}

/** An `.mcp.json` the arm may load: present, valid, and without an unfilled placeholder in any URL. */
export function usableMcpConfig(dir: string): string | null {
  const p = path.join(dir, ".mcp.json");
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, "utf8");
    JSON.parse(raw);
    return /\{[a-z_-]+\}/i.test(raw) ? null : p;
  } catch { return null; }
}

const DIFF_CAP = 200_000;
const NEW_FILE_CAP = 20_000;
const BINARY = /\.(dll|exe|pdb|png|jpg|jpeg|gif|zip|nupkg|jar|class|so|dylib|bin|ico|pfx|snk)$/i;

/** What the run left behind in the arm, against the baseline: changed paths with line counts, the files it committed, the diff text. */
export async function collectEvidence(dir: string, baselineSha: string): Promise<{ changed: ChangedPath[]; committed: string[]; diff: string }> {
  const changed = new Map<string, ChangedPath>();
  const numstat = await git(["diff", "--numstat", baselineSha, "--"], dir, { timeoutMs: 120_000 });
  for (const line of numstat.out.split("\n")) {
    const m = line.match(/^(\S+)\t(\S+)\t(.+)$/);
    if (!m) continue;
    const p = m[3]!.replace(/\\/g, "/");
    changed.set(p, { path: p, status: "M", additions: m[1] === "-" ? 0 : Number(m[1]), deletions: m[2] === "-" ? 0 : Number(m[2]) });
  }
  const names = await git(["diff", "--name-status", baselineSha, "--"], dir, { timeoutMs: 120_000 });
  for (const line of names.out.split("\n")) {
    const m = line.match(/^([A-Z])\d*\t(.+?)(?:\t(.+))?$/);
    if (!m) continue;
    const p = (m[3] ?? m[2]!).replace(/\\/g, "/");
    const cur = changed.get(p);
    if (cur) cur.status = m[1]!;
    else changed.set(p, { path: p, status: m[1]!, additions: 0, deletions: 0 });
  }
  const untracked = await git(["ls-files", "--others", "--exclude-standard"], dir, { timeoutMs: 120_000 });
  const newContents: string[] = [];
  for (const rel of untracked.out.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const p = rel.replace(/\\/g, "/");
    let lines = 0;
    if (!BINARY.test(p)) {
      try {
        const text = readFileSync(path.join(dir, rel), "utf8");
        lines = text.split("\n").length;
        if (text.length <= NEW_FILE_CAP) newContents.push(`+++ ${p}\n${text}`);
      } catch { /* unreadable */ }
    }
    changed.set(p, { path: p, status: "?", additions: lines, deletions: 0 });
  }
  const committedOut = await git(["diff", "--name-only", baselineSha, "HEAD", "--"], dir, { timeoutMs: 120_000 });
  const committed = committedOut.out.split("\n").map((l) => l.trim().replace(/\\/g, "/")).filter(Boolean);
  const diffOut = await git(["diff", baselineSha, "--", ".", ...["*.dll", "*.exe", "*.pdb", "*.png", "*.jpg", "*.zip", "*.nupkg"].map((g) => `:(exclude)${g}`)], dir, { timeoutMs: 120_000 });
  const diff = (diffOut.out + "\n" + newContents.join("\n")).slice(0, DIFF_CAP);
  return { changed: [...changed.values()], committed, diff };
}
