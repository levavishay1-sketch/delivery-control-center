import { and, desc, eq } from "drizzle-orm";
import { db, withTenant } from "@dcc/db";
import { repo, repoAiProfile, repoKnowledgeSnapshot, repoAiRecommendation } from "@dcc/db/schema";
import { appendRepoAiEvent } from "./events.ts";
import { repoInventoryView, syncRepoInventory } from "./inventory.ts";

export type RepoAiState =
  | "NOT_MANAGED" | "INVENTORY_PENDING" | "KNOWLEDGE_PENDING" | "MANAGED" | "REVIEW_DUE" | "BLOCKED";

async function setState(clientId: string, repoId: string, state: RepoAiState, blockedReason?: string | null) {
  await withTenant(clientId, (tx) =>
    tx.update(repoAiProfile).set({ state, blockedReason: blockedReason ?? null, updatedAt: new Date() }).where(eq(repoAiProfile.repoId, repoId)),
  );
}
export { setState as setRepoAiState };

/** Turns AI management on for a repo — decision (2026-09-14): a Repository
 *  belongs to exactly one Client, so an org-shared repo (client_id NULL)
 *  is explicitly out of scope for this feature, not silently allowed.
 *
 * Step 1 of the onboarding pipeline (design discussion, 2026-09-16) — the
 * deterministic inventory scan — runs IMMEDIATELY as part of starting
 * management, not as a separate manual click. There's no reason to gate
 * a $0, no-AI, filesystem-only scan behind an extra button: the moment a
 * repo enters management is exactly when we want to know what's already
 * there, and it's the input the next steps (deny rules, `/init`) need.
 * If the scan fails (e.g. can't clone the repo yet), management still
 * starts — state stays at INVENTORY_PENDING so the panel's "sync"
 * action remains available to retry, instead of the whole start failing
 * over a step that's meant to be best-effort. */
export async function startRepoAiManagement(repoId: string, by: { userId: string }) {
  const [r] = await db.select().from(repo).where(eq(repo.id, repoId)).limit(1);
  if (!r) throw new Error("repo not found");
  if (!r.clientId) throw new Error("ניהול AI זמין רק ל-repository ששייך ללקוח יחיד — זה משותף (ללא לקוח)");
  const clientId = r.clientId;

  const [existing] = await withTenant(clientId, (tx) => tx.select().from(repoAiProfile).where(eq(repoAiProfile.repoId, repoId)).limit(1));
  if (existing) return existing;

  const [row] = await withTenant(clientId, (tx) =>
    tx.insert(repoAiProfile).values({ repoId, clientId, state: "INVENTORY_PENDING" }).returning(),
  );
  await appendRepoAiEvent({ clientId, repoId, type: "state.changed", payload: { from: null, to: "INVENTORY_PENDING" }, actorUserId: by.userId });

  try {
    await syncRepoInventory(repoId, by);
  } catch {
    // best-effort — see doc comment above. The sync's own event/error handling
    // already records what happened; nothing further to do here.
  }

  const [updated] = await withTenant(clientId, (tx) => tx.select().from(repoAiProfile).where(eq(repoAiProfile.repoId, repoId)).limit(1));
  return updated ?? row!;
}

/** The full picture for one Repository's AI-management panel. */
export async function getRepoAiProfileView(clientId: string, repoId: string) {
  const [profile] = await withTenant(clientId, (tx) => tx.select().from(repoAiProfile).where(eq(repoAiProfile.repoId, repoId)).limit(1));
  const inventory = profile ? await repoInventoryView(clientId, repoId) : [];
  const [latestKnowledge] = profile
    ? await withTenant(clientId, (tx) =>
        tx.select().from(repoKnowledgeSnapshot).where(eq(repoKnowledgeSnapshot.repoId, repoId)).orderBy(desc(repoKnowledgeSnapshot.generatedAt)).limit(1),
      )
    : [];
  const recommendations = profile
    ? await withTenant(clientId, (tx) =>
        tx.select().from(repoAiRecommendation)
          .where(and(eq(repoAiRecommendation.repoId, repoId), eq(repoAiRecommendation.status, "READY_FOR_DECISION")))
          .orderBy(desc(repoAiRecommendation.createdAt)),
      )
    : [];
  const knowledgeHistory = profile
    ? await withTenant(clientId, (tx) =>
        tx.select({ id: repoKnowledgeSnapshot.id, generatedAt: repoKnowledgeSnapshot.generatedAt, mode: repoKnowledgeSnapshot.mode, analyzedCommit: repoKnowledgeSnapshot.analyzedCommit })
          .from(repoKnowledgeSnapshot).where(eq(repoKnowledgeSnapshot.repoId, repoId)).orderBy(desc(repoKnowledgeSnapshot.generatedAt)).limit(10),
      )
    : [];

  return {
    profile: profile ?? { repoId, clientId, state: "NOT_MANAGED" as RepoAiState, blockedReason: null, lastInventorySyncAt: null, lastInventorySyncCommit: null, reviewDueAt: null },
    inventory,
    latestKnowledge: latestKnowledge ?? null,
    knowledgeHistory,
    recommendations,
  };
}

export type RepoAiProfileView = Awaited<ReturnType<typeof getRepoAiProfileView>>;
