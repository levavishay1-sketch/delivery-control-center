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
  /** the question itself, phrased so a person can answer it */
  description: string;
  blocking: boolean;
  confidence: number;
  /** one short line — why this matters */
  why?: string;
  kind?: "business" | "technical" | "missing_info" | "new_scope";
  /** "client" = only the requester can decide; "team" = we can */
  whoAnswers?: "client" | "team";
  options?: string[];
  impactIfWrong?: string;
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
        why: input.why ?? null,
        kind: input.kind ?? "missing_info",
        whoAnswers: input.whoAnswers ?? "team",
        options: input.options ?? [],
        impactIfWrong: input.impactIfWrong ?? null,
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

/** The gap a conversation named by its short reference (`gap-ref.ts`), on this requirement — or why not. */
export async function gapByRef(clientId: string, workitemId: string, ref: string) {
  const r = ref.trim().toLowerCase();
  if (!/^[0-9a-f]{4,36}$/.test(r)) return { gap: null, reason: `"${ref}" אינו מזהה של פער` } as const;
  const rows = await withTenant(clientId, (tx) =>
    tx.select().from(gap).where(sql`${gap.workitemId} = ${workitemId} and ${gap.id}::text like ${`${r}%`}`),
  );
  if (rows.length === 0) return { gap: null, reason: "הפער לא נמצא בדרישה הזו" } as const;
  if (rows.length > 1) return { gap: null, reason: "המזהה מתאים ליותר מפער אחד" } as const;
  return { gap: rows[0]!, reason: null } as const;
}

export async function verifyGap(input: {
  clientId: string;
  gapId: string;
  by: { userId: string };
  outcome: "verified" | "resolved" | "dismissed" | "spun_off";
  /** required when outcome = spun_off */
  spunOffTitle?: string;
  /** the decision that closes the gap — recorded as a note (outcome = resolved) */
  answer?: string;
  ownerId?: string;
}) {
  return withTenant(input.clientId, async (tx) => {
    const [g] = await tx.select().from(gap).where(sql`${gap.id} = ${input.gapId}`).limit(1);
    if (!g) throw new Error("gap not found");

    // Both the decision AND the "this isn't a real gap" reason are recorded:
    // the reason is exactly what stops the next person (or the next Claude
    // run) from raising the same question again. It rides into the brief.
    if ((input.outcome === "resolved" || input.outcome === "dismissed") && input.answer?.trim()) {
      const lead = input.outcome === "resolved" ? "החלטה על הפער" : "נדחה כלא-פער";
      await appendEvent({
        clientId: input.clientId,
        workitemId: g.workitemId,
        source: "manual",
        type: "note.added",
        actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
        payload: { body: `${lead} "${g.description.slice(0, 80)}":\n${input.answer.trim()}` },
      });
    }

    let spunOffTo: string | null = null;
    if (input.outcome === "spun_off") {
      if (!input.spunOffTitle) throw new Error("spun_off needs spunOffTitle");
      // The spun-off requirement is a sibling of the origin: same parent,
      // same owner (unless overridden). A gap is its own small unit of work.
      const [origin] = await tx
        .select({ parentId: workitem.parentId, ownerId: workitem.ownerId })
        .from(workitem)
        .where(sql`${workitem.id} = ${g.workitemId}`)
        .limit(1);
      const [wi] = await tx
        .insert(workitem)
        .values({
          clientId: input.clientId,
          parentId: origin!.parentId,
          ownerId: input.ownerId ?? origin!.ownerId,
          title: input.spunOffTitle,
          type: "task",
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
        ...(input.answer?.trim() ? { answer: input.answer.trim() } : {}),
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
