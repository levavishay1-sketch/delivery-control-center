import { sql } from "drizzle-orm";
import { withTenant } from "@dcc/db";
import { appendEvent } from "@dcc/db";
import { gap, workitem } from "@dcc/db/schema";
import { regenerateBrief } from "./brief/generate.ts";

/**
 * A Gap is an AI PROPOSAL, never a fact, until a human verifies it
 * (architecture §4). Classified blocking / non-blocking. A non-blocking
 * verified gap can be spun off into its own WorkItem.
 */

export async function proposeGap(input: {
  clientId: string;
  workitemId: string;
  by: { userId: string };
  /** delegated: Claude acting for a user. interactive: a human logged it. */
  mode: "delegated" | "interactive";
  description: string;
  blocking: boolean;
  confidence: number;
}) {
  const [row] = await withTenant(input.clientId, (tx) =>
    tx
      .insert(gap)
      .values({
        clientId: input.clientId,
        workitemId: input.workitemId,
        description: input.description,
        blocking: input.blocking,
        confidence: input.confidence.toFixed(2),
        state: "proposed",
      })
      .returning(),
  );

  const ev = await appendEvent({
    clientId: input.clientId,
    workitemId: input.workitemId,
    source: input.mode === "delegated" ? "claude_session" : "manual",
    type: "gap.proposed",
    actor:
      input.mode === "delegated"
        ? { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "skill:gap-report" }
        : { kind: "user", userId: input.by.userId, identityType: "interactive" },
    links: [{ rel: "gap", ref: row!.id }],
    payload: { description: input.description, blocking: input.blocking, confidence: input.confidence },
  });

  await withTenant(input.clientId, (tx) =>
    tx.update(gap).set({ proposedByEvent: ev!.id }).where(sql`${gap.id} = ${row!.id}`),
  );
  await regenerateBrief(input.clientId, input.workitemId);
  return row!;
}

export async function verifyGap(input: {
  clientId: string;
  gapId: string;
  by: { userId: string };
  outcome: "verified" | "dismissed" | "spun_off";
  /** required when outcome = spun_off */
  spunOffTitle?: string;
  projectId?: string;
  ownerId?: string;
}) {
  return withTenant(input.clientId, async (tx) => {
    const [g] = await tx.select().from(gap).where(sql`${gap.id} = ${input.gapId}`).limit(1);
    if (!g) throw new Error("gap not found");

    let spunOffTo: string | null = null;
    if (input.outcome === "spun_off") {
      if (!input.spunOffTitle) throw new Error("spun_off needs spunOffTitle");
      // Inherit project + owner from the parent WorkItem unless overridden.
      const [parent] = await tx
        .select({ projectId: workitem.projectId, ownerId: workitem.ownerId })
        .from(workitem)
        .where(sql`${workitem.id} = ${g.workitemId}`)
        .limit(1);
      const [wi] = await tx
        .insert(workitem)
        .values({
          clientId: input.clientId,
          projectId: input.projectId ?? parent!.projectId,
          ownerId: input.ownerId ?? parent!.ownerId,
          title: input.spunOffTitle,
          level: "task",
        })
        .returning();
      spunOffTo = wi!.id;
    }

    await tx
      .update(gap)
      .set({
        state: input.outcome,
        resolvedBy: input.by.userId,
        resolvedAt: new Date(),
        spunOffTo,
      })
      .where(sql`${gap.id} = ${input.gapId}`);

    await appendEvent({
      clientId: input.clientId,
      workitemId: g.workitemId,
      source: "manual",
      type: "gap.verified",
      actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
      links: [{ rel: "gap", ref: input.gapId }, ...(spunOffTo ? [{ rel: "task" as const, ref: spunOffTo }] : [])],
      payload: { gapId: input.gapId, outcome: input.outcome, spunOffTo: spunOffTo ?? undefined },
    });

    await regenerateBrief(input.clientId, g.workitemId);
    return { gapId: input.gapId, outcome: input.outcome, spunOffTo };
  });
}
