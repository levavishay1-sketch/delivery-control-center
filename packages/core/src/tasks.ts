import { sql } from "drizzle-orm";
import { withTenant, appendEvent } from "@dcc/db";
import { task, taskDependency, workitem } from "@dcc/db/schema";
import { regenerateBrief } from "./brief/generate.ts";

/**
 * Task decomposition (architecture §5). The contract is
 * { intent, acceptance (Given/When/Then), appetite, dependencies }.
 * OpenSpec is the X behind this Y — the `task-breakdown` skill runs
 * OpenSpec to produce spec → plan → tasks, then registers the result
 * here so it lands on the timeline and the Context Brief.
 */

export type TaskInput = {
  intent: string;
  acceptance: { given: string; when: string; then: string }[];
  appetite?: "small" | "standard" | "large";
  /** indices (into this same array) of tasks this one depends on */
  dependsOn?: number[];
  /** why the dependency exists — links back to a Requirement/Gap */
  dependencyReason?: string;
};

const dominant = (xs: (string | undefined)[]): "small" | "standard" | "large" => {
  if (xs.includes("large")) return "large";
  if (xs.includes("standard")) return "standard";
  return "small";
};

export async function proposeTasks(input: {
  clientId: string;
  workitemId: string;
  by: { userId: string };
  tasks: TaskInput[];
  openspecChangeId?: string;
}) {
  if (input.tasks.length === 0) throw new Error("no tasks");

  return withTenant(input.clientId, async (tx) => {
    const [wi] = await tx.select({ id: workitem.id }).from(workitem).where(sql`${workitem.id} = ${input.workitemId}`).limit(1);
    if (!wi) throw new Error("workitem not found");

    const startSeq =
      (await tx.select({ n: sql<number>`coalesce(max(${task.seq}), 0)::int` }).from(task).where(sql`${task.workitemId} = ${input.workitemId}`))[0]!.n;

    const ids: string[] = [];
    for (const [i, t] of input.tasks.entries()) {
      const [row] = await tx
        .insert(task)
        .values({
          clientId: input.clientId,
          workitemId: input.workitemId,
          seq: startSeq + i + 1,
          intent: t.intent,
          acceptance: t.acceptance,
          appetite: t.appetite ?? "standard",
          openspecChangeId: input.openspecChangeId ?? null,
        })
        .returning({ id: task.id });
      ids.push(row!.id);
    }

    let depCount = 0;
    for (const [i, t] of input.tasks.entries()) {
      for (const dep of t.dependsOn ?? []) {
        if (dep < 0 || dep >= ids.length || dep === i) continue;
        await tx.insert(taskDependency).values({
          clientId: input.clientId,
          taskId: ids[i]!,
          dependsOnTaskId: ids[dep]!,
          reason: t.dependencyReason ?? null,
        });
        depCount++;
      }
    }

    await appendEvent({
      clientId: input.clientId,
      workitemId: input.workitemId,
      source: "claude_session",
      type: "tasks.proposed",
      actor: { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "skill:task-breakdown" },
      links: ids.map((id) => ({ rel: "task" as const, ref: id })),
      payload: {
        openspecChangeId: input.openspecChangeId,
        taskCount: ids.length,
        dependencyCount: depCount,
        appetite: dominant(input.tasks.map((t) => t.appetite)),
      },
    });

    await regenerateBrief(input.clientId, input.workitemId);
    return { taskIds: ids, dependencyCount: depCount };
  });
}

export async function progressTask(input: {
  clientId: string;
  taskId: string;
  by: { userId: string };
  mode: "delegated" | "interactive";
  to: "pending" | "in_progress" | "blocked" | "done" | "dropped";
}) {
  return withTenant(input.clientId, async (tx) => {
    const [t] = await tx.select().from(task).where(sql`${task.id} = ${input.taskId}`).limit(1);
    if (!t) throw new Error("task not found");
    const from = t.state;
    await tx.update(task).set({ state: input.to, updatedAt: new Date() }).where(sql`${task.id} = ${input.taskId}`);

    await appendEvent({
      clientId: input.clientId,
      workitemId: t.workitemId,
      source: input.mode === "delegated" ? "claude_session" : "manual",
      type: "task.progressed",
      actor:
        input.mode === "delegated"
          ? { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "session" }
          : { kind: "user", userId: input.by.userId, identityType: "interactive" },
      links: [{ rel: "task", ref: input.taskId }],
      payload: { taskId: input.taskId, from, to: input.to, intent: t.intent },
    });

    await regenerateBrief(input.clientId, t.workitemId);
    return { taskId: input.taskId, from, to: input.to };
  });
}

export async function tasksFor(clientId: string, workitemId: string) {
  return withTenant(clientId, async (tx) => {
    const rows = await tx.select().from(task).where(sql`${task.workitemId} = ${workitemId}`).orderBy(task.seq);
    const deps = await tx
      .select()
      .from(taskDependency)
      .where(sql`${taskDependency.taskId} in (select id from ${task} where ${task.workitemId} = ${workitemId})`);
    return { tasks: rows, dependencies: deps };
  });
}
