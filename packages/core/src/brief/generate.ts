import { sql } from "drizzle-orm";
import { withTenant } from "@dcc/db";
import { blocker, contextBrief, gap, review, task, workitem } from "@dcc/db/schema";
import { eventLog } from "@dcc/db/schema";
import { renderBrief, type BriefModel } from "./render.ts";
import { summariseTimeline } from "../summarise.ts";

/**
 * Regenerate a WorkItem's Context Brief (architecture §10).
 *
 * Phase 0 brief is ASSEMBLED from structured state — open gaps, blocker,
 * task counts, decisions, the recent timeline — not LLM-summarised. It
 * is already what the SessionStart hook injects, so the next session
 * starts from the flow, not from zero.
 *
 * `summariseTimeline()` is the seam where a policy-chosen model condenses
 * the free-text event bodies once an API key is configured. Without one
 * it returns the raw recent lines. Either way the Brief is fresh on
 * every new event.
 */
export async function regenerateBrief(clientId: string, workitemId: string): Promise<void> {
  const model = await withTenant(clientId, async (tx): Promise<BriefModel | null> => {
    const [wi] = await tx.select().from(workitem).where(sql`${workitem.id} = ${workitemId}`).limit(1);
    if (!wi) return null;

    const gaps = await tx
      .select()
      .from(gap)
      .where(sql`${gap.workitemId} = ${workitemId} and ${gap.state} in ('proposed','verified')`)
      .orderBy(sql`${gap.blocking} desc, ${gap.createdAt}`);

    const openBlockers = await tx
      .select()
      .from(blocker)
      .where(sql`${blocker.workitemId} = ${workitemId} and ${blocker.state} = 'open'`);

    const answeredBlockers = await tx
      .select()
      .from(blocker)
      .where(sql`${blocker.workitemId} = ${workitemId} and ${blocker.state} = 'answered'`)
      .orderBy(sql`${blocker.answeredAt} desc`)
      .limit(5);

    const taskRows = await tx
      .select({ seq: task.seq, intent: task.intent, state: task.state })
      .from(task)
      .where(sql`${task.workitemId} = ${workitemId}`)
      .orderBy(task.seq);

    const [lastReview] = await tx
      .select()
      .from(review)
      .where(sql`${review.workitemId} = ${workitemId}`)
      .orderBy(sql`${review.createdAt} desc`)
      .limit(1);

    const recent = await tx
      .select({
        occurredAt: eventLog.occurredAt,
        source: eventLog.source,
        type: eventLog.type,
        payload: eventLog.payload,
      })
      .from(eventLog)
      .where(sql`${eventLog.workitemId} = ${workitemId} and ${eventLog.supersedes} is null`)
      .orderBy(sql`${eventLog.occurredAt} desc`)
      .limit(15);

    return {
      key: wi.key,
      title: wi.title,
      phase: wi.phase,
      level: wi.level,
      linkedAdoId: wi.linkedAdoId,
      startedWithOpenBlocker: wi.startedWithOpenBlocker,
      gaps: gaps.map((g) => ({
        description: g.description,
        blocking: g.blocking,
        verified: g.state === "verified",
        confidence: Number(g.confidence),
      })),
      openBlockers: openBlockers.map((b) => ({ questionType: b.questionType, question: b.question })),
      answeredBlockers: answeredBlockers.map((b) => ({ question: b.question, answer: b.answer ?? "" })),
      tasks: taskRows.map((t) => ({ seq: t.seq, intent: t.intent, state: t.state })),
      lastReview: lastReview
        ? {
            verdict: lastReview.verdict,
            findings: (lastReview.findings ?? []).map((f) => ({ file: f.file, severity: f.severity, note: f.note })),
          }
        : null,
      recentTimeline: recent.reverse(),
    };
  });

  if (!model) return;

  const narrative = await summariseTimeline(model.recentTimeline);
  const body = renderBrief(model, narrative);

  const lastEventId = await withTenant(clientId, async (tx) => {
    const [row] = await tx
      .select({ id: eventLog.id })
      .from(eventLog)
      .where(sql`${eventLog.workitemId} = ${workitemId}`)
      .orderBy(sql`${eventLog.recordedAt} desc`)
      .limit(1);
    return row?.id ?? null;
  });

  await withTenant(clientId, (tx) =>
    tx
      .insert(contextBrief)
      .values({
        workitemId,
        clientId,
        body,
        currentAsOfEvent: lastEventId,
        modelUsed: narrative.modelUsed,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: contextBrief.workitemId,
        set: { body, currentAsOfEvent: lastEventId, modelUsed: narrative.modelUsed, updatedAt: new Date() },
      }),
  );
}
