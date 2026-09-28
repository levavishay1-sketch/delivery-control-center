/**
 * Record the branch of every task that was developed before branches were
 * recorded (`task.branch`, see task-branch.ts).
 *
 * Those tasks were found through a name worked out again each time, and where
 * the requirement's key or the task's wording had changed since, the name no
 * longer matched the branch a run had really created — so the task looked never
 * developed. What is recorded is what the runs themselves reported, and only a
 * branch that exists in the clone: nothing is guessed, nothing is deleted.
 *
 * Idempotent: a task with a branch recorded is left alone.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, withoutTenant } from "@dcc/db";
import { flowRun, task, workitem } from "@dcc/db/schema";
import { existingCheckout, firstRepo, git } from "./ai-assist.ts";
import { branchToRecord, taskBranchName } from "./task-branch.ts";

export type BranchRepair = {
  seq: number;
  requirement: string | null;
  /** What was recorded — null when no branch of the task exists in the clone. */
  recorded: string | null;
  /** The name that would have been looked for before this fix. */
  lookedFor: string;
  /** Whether that old name was already the right one. */
  wasRight: boolean;
  /** The task has run before but none of its branches exists any more. */
  lost: boolean;
};

export async function recordTaskBranches(): Promise<BranchRepair[]> {
  const rows = await withoutTenant((tx) => tx.select().from(task).where(and(eq(task.kind, "task"), isNull(task.branch), sql`${task.state} <> 'dropped'`)));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const runs = await db.select({ taskId: flowRun.taskId, result: flowRun.result, startedAt: flowRun.startedAt }).from(flowRun)
    .where(and(inArray(flowRun.taskId, ids), eq(flowRun.kind, "implement"))).orderBy(desc(flowRun.startedAt));
  const branchesByTask = new Map<string, string[]>();
  for (const r of runs) {
    const b = (r.result as { branch?: string; manual?: unknown } | null)?.branch;
    if (r.taskId && b) branchesByTask.set(r.taskId, [...(branchesByTask.get(r.taskId) ?? []), b]);
  }
  const wis = await withoutTenant((tx) => tx.select({ id: workitem.id, key: workitem.key }).from(workitem).where(inArray(workitem.id, [...new Set(rows.map((r) => r.workitemId))])));
  const keyOf = new Map(wis.map((w) => [w.id, w.key]));

  const out: BranchRepair[] = [];
  for (const t of rows) {
    const runBranches = branchesByTask.get(t.id) ?? [];
    const key = keyOf.get(t.workitemId) ?? null;
    const lookedFor = taskBranchName(key, t);
    const repo = await firstRepo(t.clientId, t.workitemId);
    const dir = repo ? existingCheckout({ ...repo, localPath: null }) : null;
    const present = new Set<string>();
    if (dir) for (const b of [...runBranches, lookedFor]) if ((await git(["rev-parse", "--verify", "--quiet", b], dir)).code === 0) present.add(b);
    const recorded = branchToRecord({ runBranches, derived: lookedFor, exists: (b) => present.has(b) });
    if (recorded) await db.update(task).set({ branch: recorded }).where(eq(task.id, t.id));
    if (recorded || runBranches.length) out.push({ seq: t.seq, requirement: key, recorded, lookedFor, wasRight: recorded === lookedFor, lost: !recorded && runBranches.length > 0 });
  }
  return out;
}
