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

/** One file's diff. A new, untracked file has no git diff yet, so it is
 *  rendered as all-added lines. */
export async function fileDiff(dir: string, baselineSha: string, filePath: string): Promise<{ path: string; diff: string; binary: boolean }> {
  if (!filePath || filePath.includes("..") || path.isAbsolute(filePath)) throw new Error("נתיב לא חוקי");
  const tracked = await git(["ls-files", "--error-unmatch", "--", filePath], dir);
  const inBaseline = await git(["cat-file", "-e", `${baselineSha}:${filePath}`], dir);
  if (tracked.code === 0 || inBaseline.code === 0) {
    const d = await git(["diff", "--no-color", baselineSha, "--", filePath], dir, { timeoutMs: 30_000 });
    return { path: filePath, diff: d.out, binary: /^Binary files/m.test(d.out) };
  }
  const full = path.join(dir, filePath);
  if (!existsSync(full)) return { path: filePath, diff: "", binary: false };
  const buf = readFileSync(full);
  if (buf.includes(0)) return { path: filePath, diff: `Binary files /dev/null and b/${filePath} differ`, binary: true };
  const lines = buf.toString("utf8").replace(/\n$/, "").split("\n");
  return { path: filePath, diff: [`--- /dev/null`, `+++ b/${filePath}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n"), binary: false };
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
