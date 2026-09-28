import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@dcc/db";
import { repo } from "@dcc/db/schema";
import { ensureCheckout, git, resolveCommitIdentity } from "./ai-assist.ts";
import { listPullRequests } from "./pull-requests.ts";
import { forgetPullRequest } from "./pull-request-detail.ts";
import { appendRepoAiEvent } from "./repo-onboarding/events.ts";
import { verifyCommit, type VerifyResult } from "./merge-verify.ts";

/**
 * Resolving a conflict from inside DCC (`openspec/changes/pull-request-center`).
 *
 * What GitHub does in its web editor, and what it refuses to do: checked on
 * 2026-09-21 against a real conflicting request, its "Resolve conflicts"
 * button was greyed out with "These conflicts are too complex to resolve in
 * the web editor. Use the command line." Its editor only ever handles simple
 * competing line changes; everything else it sends to a terminal. So this is
 * the same decision, made in the same place, plus the per-side choice its
 * editor does not offer.
 *
 * Three rules hold it:
 *
 * - **Nothing touches a working copy.** The shared clone may be somebody's own
 *   folder (`repo.localPath`), so the merge is built with plumbing into an
 *   index of its own: `merge-tree` for the merged tree, `hash-object` for the
 *   resolved files, `commit-tree` for the commit. No checkout, no branch
 *   switch, no staged file, nothing written into anyone's editor.
 * - **The result is an ordinary merge commit on the request's branch**, with
 *   the branch as its first parent and the target as its second — the same
 *   commit GitHub's editor makes, pushed as the person, never forced. A branch
 *   that moved meanwhile makes the push a non-fast-forward, and git refuses it
 *   rather than overwriting somebody's work.
 * - **A file is only offered when git left markers in it.** A conflict of
 *   another kind (a file changed on one side and deleted on the other, a
 *   binary file) is named and sent to the command line, as the host does.
 */

export class ConflictError extends Error {}

export type ConflictSegment = { kind: "text"; text: string } | { kind: "conflict"; ours: string; theirs: string };

export type ConflictFileContent = {
  path: string;
  /** The file as the merge left it — the text a person edits, markers and all. */
  content: string;
  /** The same file split for choosing: plain stretches, and the places the two sides disagree. */
  segments: ConflictSegment[];
  /** How many places have to be decided in this file. */
  conflicts: number;
  /** false when git left no markers to choose between — then only the command line will do. */
  resolvable: boolean;
  why?: string;
  /** The whole file on the request's branch, and on the target — each side read in full, so a person
   *  sees the conflict inside its file and not as a fragment lifted out of it. */
  oursFile: string;
  theirsFile: string;
};

export type ConflictContent = {
  /** The request's own branch — "ours" everywhere below. */
  head: string;
  /** The branch it is going into. */
  base: string;
  headSha: string;
  baseSha: string;
  files: ConflictFileContent[];
  /** Set when not one file can be resolved from here; the screen then says so instead of opening an editor. */
  needsCommandLine: boolean;
};

const MARK_OURS = /^<{7}(\s|$)/;
const MARK_BASE = /^\|{7}(\s|$)/;
const MARK_SPLIT = /^={7}(\s|$)/;
const MARK_THEIRS = /^>{7}(\s|$)/;

/** The merged text, split into what can be kept as it is and what has to be decided. */
export function splitConflicts(content: string): ConflictSegment[] {
  const lines = content.split("\n");
  const out: ConflictSegment[] = [];
  let plain: string[] = [];
  const flush = () => { if (plain.length) { out.push({ kind: "text", text: plain.join("\n") }); plain = []; } };
  for (let i = 0; i < lines.length; i++) {
    if (!MARK_OURS.test(lines[i]!)) { plain.push(lines[i]!); continue; }
    const ours: string[] = [];
    const theirs: string[] = [];
    let side: "ours" | "base" | "theirs" = "ours";
    let closed = false;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j]!;
      if (MARK_BASE.test(l)) { side = "base"; continue; }          // diff3 style: the common ancestor, shown to nobody
      if (MARK_SPLIT.test(l)) { side = "theirs"; continue; }
      if (MARK_THEIRS.test(l)) { closed = true; break; }
      if (side === "ours") ours.push(l);
      else if (side === "theirs") theirs.push(l);
    }
    // An unterminated marker is not a conflict — it is a line of the file that happens to start with "<<<<<<<".
    if (!closed) { plain.push(lines[i]!); continue; }
    flush();
    out.push({ kind: "conflict", ours: ours.join("\n"), theirs: theirs.join("\n") });
    i = j;
  }
  flush();
  return out;
}

export const hasMarkers = (s: string) => s.split("\n").some((l) => MARK_OURS.test(l) || MARK_SPLIT.test(l) || MARK_THEIRS.test(l));

async function openRequest(repoId: string, number: number) {
  const list = await listPullRequests({});
  const pr = list.rows.find((r) => r.repo.id === repoId && r.number === number);
  if (!pr) throw new ConflictError("הבקשה כבר לא פתוחה, ולכן אין בה קונפליקט לפתור.");
  if (!pr.conflicts) throw new ConflictError("אין קונפליקט בבקשה הזו כרגע. רעננו את המסך.");
  const [r] = await db.select({ id: repo.id, name: repo.name, localPath: repo.localPath, adoRepoRef: repo.adoRepoRef, clientId: repo.clientId })
    .from(repo).where(eq(repo.id, repoId)).limit(1);
  if (!r) throw new ConflictError("המאגר לא נמצא");
  const dir = await ensureCheckout(r);
  if (!dir) throw new ConflictError(`אין עותק של ${r.name} שאפשר לעבוד בו. פתרו מהטרמינל, או חברו את המאגר מחדש.`);
  return { pr, r, dir };
}

/** The merge, computed but not kept: the tree git would produce, and the files it could not settle. */
async function mergeState(dir: string, base: string, head: string) {
  const fetched = await git(["fetch", "origin", base, head], dir, { timeoutMs: 120_000 });
  if (fetched.code !== 0) throw new ConflictError(`לא הצלחנו להביא את הענפים מהגיט־האוסט: ${fetched.out.slice(0, 200)}`);
  const sha = async (ref: string) => (await git(["rev-parse", "--verify", "--quiet", ref], dir)).out.trim();
  const headSha = await sha(`origin/${head}`);
  const baseSha = await sha(`origin/${base}`);
  if (!headSha || !baseSha) throw new ConflictError("אחד הענפים לא נמצא בגיט־האוסט. רעננו את המסך.");
  // The request's branch first, so "ours" is the person's own work — the same
  // side GitHub shows first, since it merges the target INTO the branch.
  const r = await git(["merge-tree", "--write-tree", "--name-only", "--no-messages", `origin/${head}`, `origin/${base}`], dir, { timeoutMs: 120_000 });
  if (r.code === 0) throw new ConflictError("הענפים מתמזגים בלי קונפליקט. רעננו את המסך — ייתכן שמישהו כבר פתר אותו.");
  if (r.code !== 1) throw new ConflictError(`חישוב המיזוג נכשל: ${r.out.slice(0, 200)}`);
  const lines = r.out.split("\n").map((l) => l.trim());
  const end = lines.indexOf("", 1);
  return { dir, headSha, baseSha, tree: lines[0]!, paths: lines.slice(1, end === -1 ? undefined : end).filter(Boolean) };
}

export async function pullRequestConflict(repoId: string, number: number): Promise<ConflictContent> {
  const { pr, dir } = await openRequest(repoId, number);
  const m = await mergeState(dir, pr.baseBranch, pr.headBranch);

  const files: ConflictFileContent[] = [];
  for (const p of m.paths) {
    const shown = await git(["show", `${m.tree}:${p}`], dir, { timeoutMs: 60_000 });
    const content = shown.code === 0 ? shown.out : "";
    const side = async (ref: string) => { const r = await git(["show", `${ref}:${p}`], dir, { timeoutMs: 60_000 }); return r.code === 0 ? r.out : ""; };
    const [oursFile, theirsFile] = await Promise.all([side(`origin/${pr.headBranch}`), side(`origin/${pr.baseBranch}`)]);
    if (shown.code !== 0 || !hasMarkers(content) || content.includes(" ")) {
      files.push({
        path: p, content: "", segments: [], conflicts: 0, resolvable: false, oursFile, theirsFile,
        why: content.includes(" ") ? "קובץ בינארי — אי אפשר לבחור בין שתי גרסאות שלו כאן." : "הקונפליקט בקובץ הזה אינו על שורות שנכתבו אחרת (למשל קובץ שנמחק בצד אחד ושונה בשני), ולכן אין בין מה לבחור.",
      });
      continue;
    }
    const segments = splitConflicts(content);
    files.push({ path: p, content, segments, conflicts: segments.filter((s) => s.kind === "conflict").length, resolvable: true, oursFile, theirsFile });
  }
  return {
    head: pr.headBranch, base: pr.baseBranch, headSha: m.headSha, baseSha: m.baseSha, files,
    needsCommandLine: files.length > 0 && files.every((f) => !f.resolvable),
  };
}

/**
 * The person's decision, written to the request's branch: one merge commit
 * carrying their resolved files, pushed in their name. Never forced — a
 * branch that moved since they opened the screen refuses the push, and they
 * are told to look again rather than have their work overwrite somebody's.
 */
export async function resolveConflict(input: {
  repoId: string; number: number; userId: string; files: { path: string; content: string }[];
}): Promise<{ commitSha: string; branch: string; base: string; files: number }> {
  const { pr, r, dir } = await openRequest(input.repoId, input.number);
  const built = await buildMerge(input, { pr, dir });

  // Not forced: the parent is the branch as it was a moment ago, so a branch
  // that moved meanwhile is rejected by git rather than overwritten.
  const push = await git(["push", "origin", `${built.sha}:refs/heads/${pr.headBranch}`], dir, { timeoutMs: 180_000 });
  if (push.code !== 0) {
    const moved = /non-fast-forward|fetch first|rejected/i.test(push.out);
    throw new ConflictError(moved
      ? `הענף ${pr.headBranch} השתנה בגיט־האוסט מאז שפתחתם את המסך, ולכן לא דחפנו כלום. רעננו והכריעו שוב על המצב החדש.`
      : `הדחיפה נכשלה: ${push.out.slice(0, 300)}`);
  }

  // The request changed on the host a moment ago; what DCC cached about it is now wrong for everyone, not only this screen.
  forgetPullRequest(input.repoId, input.number);

  if (r.clientId) {
    await appendRepoAiEvent({
      clientId: r.clientId, repoId: r.id, type: "pull_request.conflict_resolved",
      payload: { number: pr.number, branch: pr.headBranch, base: pr.baseBranch, commit: built.sha, files: built.paths },
      actorUserId: input.userId,
    }).catch(() => { /* the merge is pushed; the record is best effort */ });
  }
  return { commitSha: built.sha.slice(0, 7), branch: pr.headBranch, base: pr.baseBranch, files: built.paths.length };
}

/**
 * What the decisions produce, checked before anything leaves the machine:
 * the merge commit is built, and the repository's own checks are run against
 * it in a copy of its own. Nothing is pushed — a person sees whether their
 * decision compiles, and then decides whether to save it.
 */
export async function verifyResolution(input: {
  repoId: string; number: number; userId: string; files: { path: string; content: string }[];
}): Promise<VerifyResult> {
  const { pr, dir } = await openRequest(input.repoId, input.number);
  const built = await buildMerge(input, { pr, dir });
  return verifyCommit(dir, built.sha, `${input.repoId.slice(0, 8)}-${input.number}`);
}

/** The merge commit the decisions produce — built and kept in the repository's object store, pushed by nobody. */
async function buildMerge(
  input: { repoId: string; number: number; userId: string; files: { path: string; content: string }[] },
  ctx: { pr: { headBranch: string; baseBranch: string }; dir: string },
): Promise<{ sha: string; paths: string[] }> {
  const { pr, dir } = ctx;
  const m = await mergeState(dir, pr.baseBranch, pr.headBranch);

  const given = new Map(input.files.map((f) => [f.path, f.content]));
  const missing = m.paths.filter((p) => !given.has(p));
  if (missing.length) throw new ConflictError(`עוד לא הוכרעו כל הקבצים: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " ועוד" : ""}.`);
  for (const [p, content] of given) {
    if (!m.paths.includes(p)) throw new ConflictError(`הקובץ ${p} אינו בקונפליקט של הבקשה הזו.`);
    if (hasMarkers(content)) throw new ConflictError(`בקובץ ${p} נשארו סימני קונפליקט (<<<<<<<). הכריעו בכל מקום לפני השמירה.`);
  }

  const work = mkdtempSync(path.join(os.tmpdir(), "dcc-conflict-"));
  const index = path.join(work, "index");
  try {
    // The merged tree as git built it, then each decided file written over it, in an index of its own.
    const read = await git(["read-tree", m.tree], dir, { env: { GIT_INDEX_FILE: index } });
    if (read.code !== 0) throw new ConflictError(`הכנת המיזוג נכשלה: ${read.out.slice(0, 200)}`);
    for (const [p, content] of given) {
      const tmp = path.join(work, "blob");
      writeFileSync(tmp, content, "utf8");
      const blob = await git(["hash-object", "-w", "--path", p, tmp], dir);
      if (blob.code !== 0 || !blob.out.trim()) throw new ConflictError(`שמירת ${p} נכשלה: ${blob.out.slice(0, 200)}`);
      const listed = await git(["ls-tree", m.tree, "--", p], dir);
      const mode = listed.out.trim().split(/\s+/)[0] || "100644";
      const upd = await git(["update-index", "--add", "--cacheinfo", `${mode},${blob.out.trim()},${p}`], dir, { env: { GIT_INDEX_FILE: index } });
      if (upd.code !== 0) throw new ConflictError(`שמירת ${p} נכשלה: ${upd.out.slice(0, 200)}`);
    }
    const tree = await git(["write-tree"], dir, { env: { GIT_INDEX_FILE: index } });
    if (tree.code !== 0 || !tree.out.trim()) throw new ConflictError(`בניית המיזוג נכשלה: ${tree.out.slice(0, 200)}`);

    const who = await resolveCommitIdentity(input.userId);
    const message = `Merge ${pr.baseBranch} into ${pr.headBranch}\n\nConflicts resolved in DCC by ${who.name}:\n${m.paths.map((p) => `- ${p}`).join("\n")}\n`;
    const commit = await git([
      "-c", `user.name=${who.name}`, "-c", `user.email=${who.email}`,
      "commit-tree", tree.out.trim(), "-p", m.headSha, "-p", m.baseSha, "-m", message,
    ], dir);
    if (commit.code !== 0 || !commit.out.trim()) throw new ConflictError(`יצירת קומיט המיזוג נכשלה: ${commit.out.slice(0, 200)}`);
    return { sha: commit.out.trim(), paths: m.paths };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
