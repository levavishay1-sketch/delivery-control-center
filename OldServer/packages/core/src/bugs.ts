import { and, eq } from "drizzle-orm";
import { withTenant } from "@dcc/db";
import { bugTaskLink, task, workitem } from "@dcc/db/schema";

/**
 * A Bug requirement's link to the task(s) it's actually about — decided
 * 2026-09-12 (`bug-change-request-lifecycle`): a Bug can be linked to a
 * task as its structure (a bug ON that task's work), or stand alone with
 * no link. Many-to-many (see `bugTaskLink`'s own comment for why).
 * Deliberately DCC-internal only — like every requirement, a Bug never
 * syncs to ADO itself, so this link has no TFS-side mirror to maintain.
 */

export type LinkedTaskRow = { id: string; intent: string; requirementId: string; requirementTitle: string };

export async function linkBugToTask(input: { clientId: string; bugId: string; taskId: string }) {
  await withTenant(input.clientId, async (tx) => {
    const [bug] = await tx.select({ type: workitem.type }).from(workitem).where(eq(workitem.id, input.bugId)).limit(1);
    if (!bug) throw new Error("requirement not found");
    if (bug.type !== "bug") throw new Error("אפשר לקשר משימה רק לדרישה מסוג Bug");
    const [t] = await tx.select({ id: task.id }).from(task).where(eq(task.id, input.taskId)).limit(1);
    if (!t) throw new Error("task not found");
    await tx.insert(bugTaskLink).values({ clientId: input.clientId, bugId: input.bugId, taskId: input.taskId }).onConflictDoNothing();
  });
  return { linked: true };
}

export async function unlinkBugFromTask(input: { clientId: string; bugId: string; taskId: string }) {
  await withTenant(input.clientId, (tx) =>
    tx.delete(bugTaskLink).where(and(eq(bugTaskLink.bugId, input.bugId), eq(bugTaskLink.taskId, input.taskId))),
  );
  return { unlinked: true };
}

export async function bugLinkedTasks(clientId: string, bugId: string): Promise<LinkedTaskRow[]> {
  return withTenant(clientId, (tx) =>
    tx.select({ id: task.id, intent: task.intent, requirementId: task.workitemId, requirementTitle: workitem.title })
      .from(bugTaskLink)
      .innerJoin(task, eq(task.id, bugTaskLink.taskId))
      .innerJoin(workitem, eq(workitem.id, task.workitemId))
      .where(eq(bugTaskLink.bugId, bugId)),
  );
}

/** Every ACTIVE check-kind child across a Bug's linked tasks, deduped by
 *  intent — what `runBreakdown` copies onto the Bug's own top-level fix
 *  task so a Bug never starts its verification burden from a blank slate
 *  (design notes, `bug-change-request-lifecycle`; Change Request does
 *  NOT get this — it's a fresh category, not a Bug). */
export async function inheritedChecksForBug(clientId: string, bugId: string): Promise<{ intent: string; prompt: string | null }[]> {
  const linked = await bugLinkedTasks(clientId, bugId);
  if (linked.length === 0) return [];
  // filter to checks whose parent is one of the linked tasks — done in JS
  // (not a `where parentTaskId in (...)`) since the linked-task id list is
  // always small (a Bug links to a handful of tasks at most).
  const linkedIds = new Set(linked.map((l) => l.id));
  const parented = await withTenant(clientId, (tx) =>
    tx.select({ intent: task.intent, prompt: task.prompt, parentTaskId: task.parentTaskId, checkKind: task.checkKind })
      .from(task)
      .where(and(eq(task.kind, "check"), eq(task.active, true))),
  );
  const seen = new Set<string>();
  const out: { intent: string; prompt: string | null }[] = [];
  for (const c of parented) {
    if (!c.parentTaskId || !linkedIds.has(c.parentTaskId)) continue;
    // The build, tests and regression checks every task gets are not inherited — the bug's own task gets its own.
    if (c.checkKind) continue;
    if (seen.has(c.intent)) continue;
    seen.add(c.intent);
    out.push({ intent: c.intent, prompt: c.prompt });
  }
  return out;
}
