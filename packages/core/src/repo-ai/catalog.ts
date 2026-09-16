import { eq, sql } from "drizzle-orm";
import { db } from "@dcc/db";
import { aiComponent, client, repo, repoAiComponentLink } from "@dcc/db/schema";

/**
 * The global, org-shared AI component catalog. No RLS on `ai_component`
 * (same reasoning as `repo`/`prompt_template`), so this reads across
 * every client on purpose — decision: "a component should appear in the
 * global library when it exists in at least one Repository." Which
 * repos currently carry it is computed live from
 * `repo_ai_component_link.active`, never a denormalized/stale count.
 */
export async function listAiComponents() {
  return db
    .select({
      id: aiComponent.id, type: aiComponent.type, title: aiComponent.title, description: aiComponent.description,
      firstSeenAt: aiComponent.firstSeenAt, lastSeenAt: aiComponent.lastSeenAt,
      activeRepoCount: sql<number>`(select count(*) from repo_ai_component_link l where l.component_id = ${aiComponent.id} and l.active)::int`,
    })
    .from(aiComponent)
    .orderBy(aiComponent.type, aiComponent.title);
}

/** Every repo (active or historical) that has carried this component, for the catalog's drill-down. */
export async function aiComponentRepos(componentId: string) {
  return db
    .select({
      repoId: repo.id, repoName: repo.name, clientName: client.name,
      detectedPath: repoAiComponentLink.detectedPath, active: repoAiComponentLink.active,
      firstSeenAt: repoAiComponentLink.firstSeenAt, lastSeenAt: repoAiComponentLink.lastSeenAt, removedAt: repoAiComponentLink.removedAt,
    })
    .from(repoAiComponentLink)
    .innerJoin(repo, eq(repo.id, repoAiComponentLink.repoId))
    .leftJoin(client, eq(client.id, repo.clientId))
    .where(eq(repoAiComponentLink.componentId, componentId))
    .orderBy(repo.name);
}

export async function renameAiComponent(id: string, patch: { title?: string; description?: string | null }) {
  const set: Record<string, unknown> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  if (Object.keys(set).length === 0) return { updated: false };
  await db.update(aiComponent).set(set).where(eq(aiComponent.id, id));
  return { updated: true };
}
