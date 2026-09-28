import { and, eq, isNull } from "drizzle-orm";
import { appendEvent, withTenant } from "@dcc/db";
import { task, workitem } from "@dcc/db/schema";
import { approveTask } from "./ai-assist.ts";
import { progressTask } from "./tasks.ts";
import { updateRequirement } from "./crud.ts";
import { regenerateBrief } from "./brief/generate.ts";

/**
 * The research/testing lifecycle (decided 2026-09-12, `requirement-types`
 * 0.2/0.3 — delegated to this session's judgment): unlike a development
 * requirement, there is no AI breakdown into many tasks. Instead, ONE
 * task is created to represent the tracked work itself — still a real,
 * materialized TFS work item (the proposal's own exit gate: "still a
 * real, tracked TFS task") — and all the actual research/testing happens
 * as notes directly on the requirement. Closing the requirement closes
 * that one task too; reopening (generic, via `decision-history`) leaves
 * the task as-is — a person decides separately whether the tracked work
 * itself needs reopening.
 */

type Dev = { userId: string };

export type ResearchWorkResult = { taskId: string; materialized: boolean; materializeError?: string };

/** Create + immediately approve + materialize the one tracking task for
 *  a research/testing requirement. Refuses a second call once one
 *  exists — this is a single task per requirement, not a breakdown. */
export async function startResearchWork(input: { clientId: string; workitemId: string; by: Dev }): Promise<ResearchWorkResult> {
  const wi = await withTenant(input.clientId, async (tx) => {
    const [row] = await tx.select({ title: workitem.title, requirementType: workitem.requirementType }).from(workitem).where(eq(workitem.id, input.workitemId)).limit(1);
    if (!row) throw new Error("requirement not found");
    if (row.requirementType === "development") throw new Error("פעולה זו רק לדרישות תחקור/בדיקות");
    return row;
  });
  const existing = await withTenant(input.clientId, (tx) =>
    tx.select({ id: task.id }).from(task).where(and(eq(task.workitemId, input.workitemId), isNull(task.parentTaskId))).limit(1),
  );
  if (existing.length > 0) throw new Error("כבר קיימת משימת מעקב לדרישה הזו");

  const [t] = await withTenant(input.clientId, (tx) =>
    tx.insert(task).values({
      clientId: input.clientId, workitemId: input.workitemId, seq: 1, kind: "task",
      intent: wi.title, appetite: "standard", origin: "human", state: "pending", adoType: "Task",
    }).returning(),
  );
  const r = await approveTask(input.clientId, t!.id, input.by);
  if (!r.approved) throw new Error("יצירת המשימה נכשלה");
  return { taskId: t!.id, materialized: !!r.materialized, materializeError: r.materializeError };
}

/** Close a research/testing requirement: the conclusion becomes its
 *  final note, the tracking task moves to done, then the requirement
 *  itself. Requires an actual conclusion — never a silent phase flip. */
export async function finishResearchWork(input: { clientId: string; workitemId: string; by: Dev; conclusion: string }) {
  const conclusion = input.conclusion.trim();
  if (!conclusion) throw new Error("צריך לכתוב מסקנות לפני סיום");

  const wi = await withTenant(input.clientId, async (tx) => {
    const [row] = await tx.select({ requirementType: workitem.requirementType }).from(workitem).where(eq(workitem.id, input.workitemId)).limit(1);
    if (!row) throw new Error("requirement not found");
    return row;
  });
  const label = wi.requirementType === "testing" ? "תוצאת בדיקה" : "מסקנות תחקור";

  await appendEvent({
    clientId: input.clientId, workitemId: input.workitemId, source: "manual", type: "note.added",
    actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
    payload: { body: `${label}: ${conclusion}` },
  });

  const [t] = await withTenant(input.clientId, (tx) =>
    tx.select({ id: task.id, state: task.state }).from(task).where(and(eq(task.workitemId, input.workitemId), isNull(task.parentTaskId))).limit(1),
  );
  if (t && t.state !== "done") {
    await progressTask({ clientId: input.clientId, taskId: t.id, by: input.by, mode: "interactive", to: "done" });
  }

  await updateRequirement({ clientId: input.clientId, id: input.workitemId, by: input.by, patch: { phase: "done" } });
  await regenerateBrief(input.clientId, input.workitemId);
  return { finished: true };
}
