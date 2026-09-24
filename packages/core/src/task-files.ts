/**
 * A task's own file changes and a before/after read of any one of them — the
 * same two questions the pull-request screen and the onboarding review
 * already answer (`repo-onboarding/changes.ts`, `pull-request-detail.ts`),
 * asked here against a task's own branch instead of a pull request's or an
 * onboarding run's.
 *
 * Deliberately its own read, not a reuse of `repo-onboarding/changes.ts`'s
 * `changedFiles`/`fileVersions`: those compare a baseline commit to the
 * WORKING TREE — right for onboarding, where a live session's uncommitted
 * work is exactly what is being reviewed. A task's own working tree is a
 * cache clone shared with every other task and check on the same repo, so
 * anything else that happened to run there (a manual build, another task's
 * checkout) would leak in. This reads two COMMITS only — the task's base and
 * its branch tip — never the filesystem, so nothing but the task's own
 * commits can appear.
 *
 * A separate small file, not folded into `ai-assist.ts`: `repo-onboarding/
 * changes.ts` already imports `git` from there, so importing it back would
 * be circular.
 */
import { withTenant } from "@dcc/db";
import { task, workitem } from "@dcc/db/schema";
import { eq } from "drizzle-orm";
import { existingCheckout, firstRepo, git, taskBaseSha, taskBranchName } from "./ai-assist.ts";
import type { ChangedFile } from "./repo-onboarding/types.ts";

const MAX_FILE_BYTES = 400_000;

/** The checkout dir and the two commits every file question below compares. */
async function taskGitContext(clientId: string, taskId: string) {
  const [t] = await withTenant(clientId, (tx) => tx.select().from(task).where(eq(task.id, taskId)).limit(1));
  if (!t) throw new Error("משימה לא נמצאה");
  const [wi] = await withTenant(clientId, (tx) => tx.select({ key: workitem.key }).from(workitem).where(eq(workitem.id, t.workitemId)).limit(1));
  const r = await firstRepo(clientId, t.workitemId);
  const dir = r ? existingCheckout({ ...r, localPath: null }) : null;
  if (!dir) throw new Error("אין עותק עבודה של המאגר עדיין");
  const branch = taskBranchName(wi?.key, t);
  const exists = await git(["rev-parse", "--verify", "--quiet", branch], dir);
  if (exists.code !== 0) throw new Error("למשימה הזו עדיין אין ענף — היא לא פותחה");
  const base = await taskBaseSha(dir, branch, t);
  if (!base) throw new Error("למשימה הזו עדיין אין בסיס להשוואה — היא לא פותחה");
  return { dir, base, branch };
}

/** Every file the task's branch touched, against what it was built on — its own commits only. */
export async function taskChangedFiles(clientId: string, taskId: string): Promise<ChangedFile[]> {
  const { dir, base, branch } = await taskGitContext(clientId, taskId);
  const [status, numstat] = await Promise.all([
    git(["diff", "--name-status", base, branch], dir, { timeoutMs: 60_000 }),
    git(["diff", "--numstat", base, branch], dir, { timeoutMs: 60_000 }),
  ]);
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
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** One of them, before and after — both read from git objects, never the working tree. */
export async function taskFileVersions(clientId: string, taskId: string, filePath: string): Promise<{ path: string; before: string | null; after: string | null; binary: boolean; tooLarge: boolean }> {
  if (!filePath || filePath.includes("..") || filePath.startsWith("/")) throw new Error("נתיב לא חוקי");
  const { dir, base, branch } = await taskGitContext(clientId, taskId);
  const read = async (ref: string): Promise<{ text: string | null; tooLarge: boolean }> => {
    const at = `${ref}:${filePath}`;
    if ((await git(["cat-file", "-e", at], dir)).code !== 0) return { text: null, tooLarge: false };
    const size = Number((await git(["cat-file", "-s", at], dir)).out) || 0;
    if (size > MAX_FILE_BYTES) return { text: null, tooLarge: true };
    const shown = await git(["show", at], dir, { timeoutMs: 30_000 });
    return { text: shown.code === 0 ? shown.out : null, tooLarge: false };
  };
  const [before, after] = await Promise.all([read(base), read(branch)]);
  if (before.tooLarge || after.tooLarge) return { path: filePath, before: null, after: null, binary: false, tooLarge: true };
  const binary = [before.text, after.text].some((v) => v?.includes("\u0000"));
  return { path: filePath, before: binary ? null : before.text, after: binary ? null : after.text, binary, tooLarge: false };
}
