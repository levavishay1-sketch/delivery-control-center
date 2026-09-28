/**
 * Two tasks in one requirement that changed the same code — told to the person,
 * and the one way to combine them that DCC does for them: merging a dependency
 * the task was developed without into the task's own branch.
 *
 * Nothing here decides for the person. A conflict is reported, with the files,
 * and leaves every branch as it was — the merge is tried in a scratch tree
 * first (`git merge-tree`), so a refused merge never leaves a half-merged
 * checkout behind. What is left to the person when it conflicts: Rollback and
 * run again (the task is then developed on top of the dependency), or resolve
 * it by hand in git.
 */
import { and, eq, sql } from "drizzle-orm";
import { appendEvent, withTenant } from "@dcc/db";
import { task, workitem } from "@dcc/db/schema";
import { ensureCheckout, existingCheckout, firstRepo, git, liveTaskPhase, relationsOf, resolveCommitIdentity, taskBaseSha, taskCommitCount } from "./ai-assist.ts";
import { regenerateBrief } from "./brief/generate.ts";
import { branchOf } from "./task-branch.ts";
import { readMergeTree, sharedFiles, type MergePreview } from "./task-overlap.ts";

export type TaskOverlap = {
  id: string;
  seq: number;
  intent: string;
  /** How the two tasks are tied: one waits for the other, or nothing ties them. */
  relation: "waits_for" | "waited_on_by" | "none";
  files: string[];
  /** Whether one branch already holds the other's work — then there is nothing to combine. */
  inOneLine: boolean;
  merge: MergePreview | null;
};

const ownFiles = async (dir: string, branch: string, t: { baseSha: string | null }): Promise<string[]> => {
  const from = await taskBaseSha(dir, branch, t);
  if (!from) return [];
  return (await git(["-c", "core.quotepath=false", "diff", "--name-only", from, branch], dir, { timeoutMs: 60_000 })).out.split("\n").map((l) => l.trim()).filter(Boolean);
};

const isAncestor = async (dir: string, a: string, b: string) => (await git(["merge-base", "--is-ancestor", a, b], dir)).code === 0;

const previewMerge = async (dir: string, a: string, b: string): Promise<MergePreview | null> => {
  const r = await git(["merge-tree", "--write-tree", "--name-only", a, b], dir, { timeoutMs: 60_000 });
  return readMergeTree(r.code, r.out);
};

/**
 * The other developed tasks of the requirement that changed a file this one changed, with how the two are tied and
 * whether their branches combine cleanly. Reads git only; never checks anything out.
 */
export async function taskOverlaps(clientId: string, taskId: string): Promise<TaskOverlap[]> {
  const [t] = await withTenant(clientId, (tx) => tx.select().from(task).where(eq(task.id, taskId)).limit(1));
  if (!t || t.kind !== "task") return [];
  const [wi] = await withTenant(clientId, (tx) => tx.select({ key: workitem.key }).from(workitem).where(eq(workitem.id, t.workitemId)).limit(1));
  const repo = await firstRepo(clientId, t.workitemId);
  const dir = repo ? existingCheckout({ ...repo, localPath: null }) : null;
  if (!dir) return [];
  const mine = branchOf(wi?.key, t);
  if (!(await taskCommitCount(dir, mine, t))) return [];
  const myFiles = await ownFiles(dir, mine, t);
  if (!myFiles.length) return [];

  const { rows, rel } = await relationsOf(clientId, t.workitemId);
  const iWaitFor = new Set(rel.effectiveDeps(t.id).map((d) => d.id));
  const out: TaskOverlap[] = [];
  for (const o of rows) {
    if (o.id === t.id || o.kind !== "task" || o.state === "dropped" || !o.active || rel.isGroup(o.id)) continue;
    const theirs = branchOf(wi?.key, o);
    if (!(await taskCommitCount(dir, theirs, o))) continue;
    const files = sharedFiles(myFiles, await ownFiles(dir, theirs, o));
    if (!files.length) continue;
    const inOneLine = (await isAncestor(dir, theirs, mine)) || (await isAncestor(dir, mine, theirs));
    const relation = iWaitFor.has(o.id) ? "waits_for" : rel.effectiveDeps(o.id).some((d) => d.id === t.id) ? "waited_on_by" : "none";
    out.push({ id: o.id, seq: o.seq, intent: o.intent, relation, files, inOneLine, merge: inOneLine ? { clean: true } : await previewMerge(dir, mine, theirs) });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

export type MergeResult =
  | { merged: true; already: boolean }
  | { merged: false; reason: string; conflictFiles: string[] };

/**
 * Bring a dependency's work into the task's own branch — for a task that was developed without it. A clean merge is done,
 * and the task then counts as built on that dependency (its own work is what came after it); its checks have not run on
 * the merged code, so they are reset. A conflict is reported and changes nothing.
 */
export async function mergeDependencyIntoTask(input: { clientId: string; taskId: string; dependencyId: string; by: { userId: string } }): Promise<MergeResult> {
  const { clientId, taskId, dependencyId, by } = input;
  const [t] = await withTenant(clientId, (tx) => tx.select().from(task).where(eq(task.id, taskId)).limit(1));
  const [d] = await withTenant(clientId, (tx) => tx.select().from(task).where(eq(task.id, dependencyId)).limit(1));
  if (!t || !d || t.kind !== "task") throw new Error("משימה לא נמצאה");
  const { rel } = await relationsOf(clientId, t.workitemId);
  if (!rel.effectiveDeps(t.id).some((x) => x.id === d.id)) throw new Error(`#${d.seq} היא לא תלות של משימה #${t.seq} — מיזוג נעשה רק עם משימה שהמשימה תלויה בה`);
  if (liveTaskPhase(taskId) || liveTaskPhase(dependencyId)) throw new Error("יש הרצה של Claude על אחת המשימות כרגע — חכו שתסתיים");

  const [wi] = await withTenant(clientId, (tx) => tx.select({ key: workitem.key }).from(workitem).where(eq(workitem.id, t.workitemId)).limit(1));
  const repo = await firstRepo(clientId, t.workitemId);
  if (!repo) throw new Error("אין repository מקושר לדרישה");
  const dir = await ensureCheckout({ ...repo, localPath: null });
  if (!dir) throw new Error(`לא הצלחתי להביא עותק של ${repo.name}`);
  const mine = branchOf(wi?.key, t);
  const theirs = branchOf(wi?.key, d);
  if (!(await taskCommitCount(dir, mine, t))) throw new Error(`משימה #${t.seq} עוד לא פותחה — אין ענף לצרף אליו`);
  if (!(await taskCommitCount(dir, theirs, d))) throw new Error(`ל-#${d.seq} אין קוד משלה — אין מה למזג`);
  if (await isAncestor(dir, theirs, mine)) return { merged: true, already: true };
  if (t.baseTaskId && t.baseTaskId !== d.id) {
    return { merged: false, reason: `המשימה כבר בנויה על #${(await withTenant(clientId, (tx) => tx.select({ seq: task.seq }).from(task).where(eq(task.id, t.baseTaskId!)).limit(1)))[0]?.seq ?? "?"}. מיזוג של תלות נוספת מעליה לא נתמך — Rollback והרצה חוזרת יבנו אותה על כולן`, conflictFiles: [] };
  }

  const preview = await previewMerge(dir, mine, theirs);
  if (!preview) return { merged: false, reason: "git לא הצליח לבדוק את המיזוג", conflictFiles: [] };
  if (!preview.clean) {
    return { merged: false, reason: `המיזוג של #${d.seq} לתוך #${t.seq} מתנגש — שני הענפים שינו את אותן שורות. לא שיניתי כלום. Rollback והרצה חוזרת יפתחו את המשימה על #${d.seq}, או שאפשר לפתור את הקונפליקט ידנית ב-git`, conflictFiles: preview.conflictFiles };
  }

  const identity = await resolveCommitIdentity(by.userId);
  await git(["reset", "--hard"], dir);
  await git(["clean", "-fd"], dir);
  await git(["checkout", mine], dir);
  const tip = (await git(["rev-parse", theirs], dir)).out;
  const m = await git(["-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "merge", "--no-edit", "--no-ff", "-m", `${wi?.key ?? "REQ"} t${t.seq}: merge the work of #${d.seq}\n\nDCC task ${t.id}`, theirs], dir);
  if (m.code !== 0) {
    await git(["merge", "--abort"], dir);
    return { merged: false, reason: `המיזוג נכשל למרות שהבדיקה אמרה שהוא נקי: ${m.out.slice(0, 200)}. לא שיניתי כלום`, conflictFiles: [] };
  }

  // The task now counts as built on that dependency; what ran before ran on other code.
  const missing = (t.builtWithout as string[]).filter((x) => x !== d.id);
  await withTenant(clientId, async (tx) => {
    await tx.update(task).set({
      baseTaskId: d.id, baseBranch: theirs, baseSha: tip, builtWithout: missing,
      state: t.state === "done" || t.state === "failed_checks" ? "in_progress" : t.state, wasDone: false, updatedAt: new Date(),
    }).where(eq(task.id, t.id));
    await tx.update(task).set({ checkResult: null, checkCause: null, checkResolvedBy: null, checkResolvedAt: null, state: "pending", updatedAt: new Date() })
      .where(and(eq(task.parentTaskId, t.id), eq(task.kind, "check"), sql`${task.state} <> 'dropped'`));
  });
  await appendEvent({
    clientId, workitemId: t.workitemId, source: "manual", type: "note.added",
    actor: { kind: "user", userId: by.userId, identityType: "interactive" },
    links: [{ rel: "task", ref: t.id }],
    payload: { body: `⇄ העבודה של #${d.seq} מוזגה לענף של משימה #${t.seq} — מיזוג נקי, ללא קונפליקט. הבדיקות של המשימה נוקו כי הקוד השתנה ועליהן לרוץ שוב.` },
  });
  await regenerateBrief(clientId, t.workitemId);
  return { merged: true, already: false };
}
