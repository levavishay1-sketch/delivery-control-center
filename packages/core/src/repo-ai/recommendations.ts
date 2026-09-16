import { eq } from "drizzle-orm";
import { withTenant } from "@dcc/db";
import { repoAiRecommendation } from "@dcc/db/schema";
import { appendRepoAiEvent } from "./events.ts";

/**
 * Recommendation + Decision — deliberately a lighter shape than the
 * spec's automated P3A (internal fit) / P3B (external research) engine,
 * which this pass did not build (see the implementation report: that
 * needs a "Company Standards" concept and a real internal-experience
 * corpus that don't exist yet, and would be pure speculation to build
 * blind). What IS real: a Recommendation always carries a stated need
 * and reason, is never silently applied, and every Decision is recorded
 * — same "no silent actions" contract the rest of DCC already has, just
 * without the auto-research pipeline behind it yet. `createRecommendation`
 * is meant to be called by a human today; it's the same shape an
 * eventual P3A/P3B engine would call into later without a caller-side
 * change.
 */
export async function createRecommendation(input: {
  clientId: string; repoId: string; action: string; componentId?: string | null;
  need: string; rationale?: string | null; by: { userId: string };
}) {
  const [row] = await withTenant(input.clientId, (tx) =>
    tx.insert(repoAiRecommendation).values({
      repoId: input.repoId, clientId: input.clientId, action: input.action,
      componentId: input.componentId ?? null, need: input.need, rationale: input.rationale ?? null,
      status: "READY_FOR_DECISION", createdBy: input.by.userId,
    }).returning(),
  );
  await appendRepoAiEvent({ clientId: input.clientId, repoId: input.repoId, type: "recommendation.created", payload: { recommendationId: row!.id, action: input.action, need: input.need }, actorUserId: input.by.userId });
  return row!;
}

export async function decideRecommendation(input: {
  clientId: string; recommendationId: string; repoId: string;
  decision: "ACCEPTED" | "REJECTED" | "MODIFIED_AND_ACCEPTED" | "POSTPONED";
  reason: string; by: { userId: string };
}) {
  const [row] = await withTenant(input.clientId, (tx) =>
    tx.update(repoAiRecommendation).set({
      status: input.decision, decidedBy: input.by.userId, decidedAt: new Date(), decisionReason: input.reason,
    }).where(eq(repoAiRecommendation.id, input.recommendationId)).returning(),
  );
  await appendRepoAiEvent({
    clientId: input.clientId, repoId: input.repoId, type: "recommendation.decided",
    payload: { recommendationId: input.recommendationId, decision: input.decision, reason: input.reason },
    actorUserId: input.by.userId,
  });
  return row!;
}
