import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { git } from "../ai-assist.ts";
import type { ChangedFile } from "./types.ts";

/**
 * What the session changed in the worktree, against the run's baseline —
 * tracked files (whether or not Claude committed them) and new, untracked
 * ones alike, since `/init` writes files without committing.
 */

export async function changedFiles(dir: string, baselineSha: string): Promise<ChangedFile[]> {
  const status = await git(["diff", "--name-status", baselineSha], dir, { timeoutMs: 60_000 });
  const numstat = await git(["diff", "--numstat", baselineSha], dir, { timeoutMs: 60_000 });
  const counts = new Map<string, { additions: number; deletions: number }>();
  for (const line of numstat.out.split("\n")) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (m) counts.set(m[3]!.trim(), { additions: m[1] === "-" ? 0 : Number(m[1]), deletions: m[2] === "-" ? 0 : Number(m[2]) });
  }
  const out: ChangedFile[] = [];
  for (const line of status.out.split("\n")) {
    const m = line.match(/^([AMDRT])\S*\t(.+?)(?:\t(.+))?$/);
    if (!m) continue;
    const p = (m[3] ?? m[2])!.trim();
    out.push({ path: p, status: m[1]!, ...(counts.get(p) ?? { additions: 0, deletions: 0 }) });
  }
  const untracked = await git(["ls-files", "--others", "--exclude-standard"], dir, { timeoutMs: 60_000 });
  for (const p of untracked.out.split("\n").map((s) => s.trim()).filter(Boolean)) {
    const full = path.join(dir, p);
    let additions = 0;
    try { if (statSync(full).isFile()) additions = readFileSync(full, "utf8").split("\n").length; } catch { /* unreadable: count stays 0 */ }
    out.push({ path: p, status: "A", additions, deletions: 0 });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** The worktree's state in a few lines, for the assistant: tracked files that differ
 *  from the baseline (one line each) and files git does not track yet (grouped by
 *  folder — a build can leave hundreds, and reading them all would be slow). */
export async function changeSummary(dir: string, baselineSha: string): Promise<string> {
  const status = await git(["diff", "--name-status", baselineSha], dir, { timeoutMs: 60_000 });
  const numstat = await git(["diff", "--numstat", baselineSha], dir, { timeoutMs: 60_000 });
  const counts = new Map<string, string>();
  for (const line of numstat.out.split("\n")) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (m) counts.set(m[3]!.trim(), `+${m[1]} −${m[2]}`);
  }
  const tracked: string[] = [];
  for (const line of status.out.split("\n")) {
    const m = line.match(/^([AMDRT])\S*\t(.+?)(?:\t(.+))?$/);
    if (m) { const p = (m[3] ?? m[2])!.trim(); tracked.push(`${m[1]} ${p} ${counts.get(p) ?? ""}`.trim()); }
  }
  const untracked = (await git(["ls-files", "--others", "--exclude-standard"], dir, { timeoutMs: 60_000 })).out.split("\n").map((s) => s.trim()).filter(Boolean);
  const groups = new Map<string, number>();
  for (const p of untracked) {
    const parts = p.split("/");
    const key = parts.slice(0, Math.min(parts.length - 1, 4)).join("/") || ".";
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const out: string[] = [];
  if (tracked.length) out.push(`קבצים שנעקבים ב-git ושונו מול נקודת ההתחלה (${tracked.length}) — חלקם כבר ב-commit של Claude, חלקם לא:`, ...tracked.slice(0, 40), ...(tracked.length > 40 ? [`… ועוד ${tracked.length - 40}`] : []));
  if (untracked.length) out.push(`קבצים חדשים ש-git עוד לא עוקב אחריהם (${untracked.length}) — לא נמצאים באף commit, ומסירה של DCC (git add -A) תכניס אותם:`, ...[...groups].slice(0, 12).map(([k, n]) => `${k}/ ×${n}`));
  return out.join("\n");
}

/** The file as the run began and as it is now, for the side-by-side view.
 *  Anything that is not readable text, or is very large, is reported instead of loaded. */
const MAX_FILE_BYTES = 400_000;

export async function fileVersions(dir: string, baselineSha: string, filePath: string): Promise<{ path: string; before: string | null; after: string | null; binary: boolean; tooLarge: boolean }> {
  if (!filePath || filePath.includes("..") || path.isAbsolute(filePath)) throw new Error("נתיב לא חוקי");
  const inBaseline = await git(["cat-file", "-e", `${baselineSha}:${filePath}`], dir);
  let before: string | null = null;
  if (inBaseline.code === 0) {
    const size = Number((await git(["cat-file", "-s", `${baselineSha}:${filePath}`], dir)).out) || 0;
    if (size > MAX_FILE_BYTES) return { path: filePath, before: null, after: null, binary: false, tooLarge: true };
    // git() trims and merges stderr, so a blob is read through cat-file's own output only when it is text.
    const shown = await git(["show", `${baselineSha}:${filePath}`], dir, { timeoutMs: 30_000 });
    before = shown.code === 0 ? shown.out : null;
  }
  const full = path.join(dir, filePath);
  let after: string | null = null;
  if (existsSync(full) && statSync(full).isFile()) {
    if (statSync(full).size > MAX_FILE_BYTES) return { path: filePath, before: null, after: null, binary: false, tooLarge: true };
    const buf = readFileSync(full);
    if (buf.includes(0)) return { path: filePath, before: null, after: null, binary: true, tooLarge: false };
    after = buf.toString("utf8");
  }
  return { path: filePath, before, after, binary: before?.includes("\u0000") ?? false, tooLarge: false };
}
