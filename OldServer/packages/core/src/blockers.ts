import { sql } from "drizzle-orm";
import { withTenant, appendEvent } from "@dcc/db";
import { blocker, workitem } from "@dcc/db/schema";
import { regenerateBrief } from "./brief/generate.ts";

/**
 * A Blocker: Claude stopped mid-task and needs an answer (architecture
 * §13). A structured object, not a chat. Routed to the WorkItem owner
 * (who may not be at a terminal), answered in a focused UI, answer
 * returned to Claude.
 */

export async function raiseBlocker(input: {
  clientId: string;
  workitemId: string;
  raisedBy: { userId: string };
  taskId?: string;
  /** "missing_access" | "unclear_requirement" | "budget_exceeded" | ... */
  questionType: string;
  question: string;
}) {
  return withTenant(input.clientId, async (tx) => {
    const [wi] = await tx.select({ ownerId: workitem.ownerId }).from(workitem).where(sql`${workitem.id} = ${input.workitemId}`).limit(1);
    if (!wi) throw new Error("workitem not found");

    const [row] = await tx
      .insert(blocker)
      .values({
        clientId: input.clientId,
        workitemId: input.workitemId,
        taskId: input.taskId ?? null,
        questionType: input.questionType,
        question: input.question,
        routedTo: wi.ownerId,
        state: "open",
      })
      .returning();

    await appendEvent({
      clientId: input.clientId,
      workitemId: input.workitemId,
      source: "claude_session",
      type: "blocker.raised",
      actor: { kind: "delegated", userId: input.raisedBy.userId, identityType: "delegated", triggeredBy: "skill:raise-blocker" },
      links: [{ rel: "blocker", ref: row!.id }, ...(input.taskId ? [{ rel: "task" as const, ref: input.taskId }] : [])],
      payload: { questionType: input.questionType, question: input.question, taskId: input.taskId },
    });

    await regenerateBrief(input.clientId, input.workitemId);
    return row!;
  });
}

export async function answerBlocker(input: {
  clientId: string;
  blockerId: string;
  answeredBy: { userId: string };
  answer: string;
}) {
  return withTenant(input.clientId, async (tx) => {
    const [b] = await tx.select().from(blocker).where(sql`${blocker.id} = ${input.blockerId}`).limit(1);
    if (!b) throw new Error("blocker not found");
    if (b.state !== "open") throw new Error(`blocker is ${b.state}`);

    await tx
      .update(blocker)
      .set({ answer: input.answer, answeredBy: input.answeredBy.userId, answeredAt: new Date(), state: "answered" })
      .where(sql`${blocker.id} = ${input.blockerId}`);

    await appendEvent({
      clientId: input.clientId,
      workitemId: b.workitemId,
      source: "manual",
      type: "blocker.answered",
      actor: { kind: "user", userId: input.answeredBy.userId, identityType: "interactive" },
      links: [{ rel: "blocker", ref: input.blockerId }],
      payload: { blockerId: input.blockerId, answer: input.answer },
    });

    await regenerateBrief(input.clientId, b.workitemId);
    return { blockerId: input.blockerId, state: "answered" as const };
  });
}

/** The "waiting on me" queue for a user, across a client's WorkItems. */
export async function blockersFor(clientId: string, userId: string) {
  return withTenant(clientId, (tx) =>
    tx
      .select()
      .from(blocker)
      .where(sql`${blocker.routedTo} = ${userId} and ${blocker.state} = 'open'`)
      .orderBy(sql`${blocker.createdAt}`),
  );
}
