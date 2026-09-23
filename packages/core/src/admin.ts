import { and, eq, isNull, sql } from "drizzle-orm";
import { db, withTenant, withoutTenant } from "@dcc/db";
import { client, clientBudget, clientRepo, repo, users, workitem } from "@dcc/db/schema";

/**
 * Onboard a client: client row + AI budget + optional repo link +
 * optional first requirement (a top-level WorkItem). There is no
 * "project" — a client owns a forest of requirements. Repo linking is
 * explicit here (a deliberate call with a named actor), never inferred
 * (architecture §8 / tenancy spec).
 */

export type SetupResult = {
  clientId: string;
  repoId?: string;
  workitemId?: string;
  workitemKey?: string;
};

export async function setupClient(input: {
  clientName: string;
  /** Optional. Repositories are linked per-client. Only pass this to onboard a repo in one shot. */
  repo?: { name: string; gitUrl?: string; adoRepoRef?: string; orgShared?: boolean };
  actorEmail: string;
  firstRequirement?: {
    key?: string;
    title: string;
    type?: "epic" | "feature" | "story" | "bug" | "task" | "spike";
    priority?: "low" | "medium" | "high" | "critical";
    risk?: "low" | "medium" | "high";
    executor?: "human" | "ai" | "mixed";
    dueInDays?: number;
  };
}): Promise<SetupResult> {
  const [actor] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.actorEmail.toLowerCase()}`).limit(1);
  if (!actor) throw new Error(`no user for ${input.actorEmail}`);

  const live = await db.select().from(client).where(and(eq(client.name, input.clientName), isNull(client.archivedAt))).limit(1);
  const [c] = live.length > 0 ? live : await db.insert(client).values({ name: input.clientName }).returning();

  await withTenant(c!.id, (tx) =>
    tx.insert(clientBudget).values({ clientId: c!.id, monthlyUsd: "300" }).onConflictDoNothing(),
  );

  const out: SetupResult = { clientId: c!.id };

  if (input.repo) {
    // repo lives outside RLS (may be org-shared); create or reuse by name
    const existing = await withoutTenant((tx) => tx.select().from(repo).where(sql`${repo.name} = ${input.repo!.name}`).limit(1));
    const [r] =
      existing.length > 0
        ? existing
        : await db
            .insert(repo)
            .values({
              name: input.repo.name,
              clientId: input.repo.orgShared ? null : c!.id,
              adoRepoRef: input.repo.adoRepoRef ?? input.repo.gitUrl ?? null,
            })
            .returning();

    await withTenant(c!.id, (tx) =>
      tx.insert(clientRepo).values({ clientId: c!.id, repoId: r!.id, addedBy: actor.id }).onConflictDoNothing(),
    );
    out.repoId = r!.id;
  }

  if (input.firstRequirement) {
    const fr = input.firstRequirement;
    const [wi] = await withTenant(c!.id, (tx) =>
      tx
        .insert(workitem)
        .values({
          clientId: c!.id,
          ownerId: actor.id,
          key: fr.key ?? null,
          title: fr.title,
          type: fr.type ?? "story",
          priority: fr.priority ?? "medium",
          risk: fr.risk ?? "low",
          executor: fr.executor ?? "human",
          dueDate: fr.dueInDays != null ? new Date(Date.now() + fr.dueInDays * 864e5) : null,
          phase: "intake",
        })
        .returning(),
    );
    out.workitemId = wi!.id;
    out.workitemKey = wi!.key ?? undefined;
  }

  return out;
}
