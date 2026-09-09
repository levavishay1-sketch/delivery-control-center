import { sql } from "drizzle-orm";
import { db, withTenant, withoutTenant } from "@dcc/db";
import { client, clientRepo, project, projectRepo, repo, users, workitem } from "@dcc/db/schema";

/**
 * Onboard a client end to end: client → project → repo link → optional
 * first WorkItem. Repo linking is explicit here (a deliberate call with
 * a named actor), never inferred (architecture §8 / tenancy spec).
 */

export type SetupResult = {
  clientId: string;
  projectId: string;
  repoId: string;
  workitemId?: string;
  workitemKey?: string;
};

export async function setupClient(input: {
  clientName: string;
  projectName: string;
  repo: { name: string; gitUrl?: string; adoRepoRef?: string; orgShared?: boolean };
  actorEmail: string;
  firstWorkItem?: { key: string; title: string; level?: "epic" | "feature" | "story" | "task" };
}): Promise<SetupResult> {
  const [actor] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.actorEmail.toLowerCase()}`).limit(1);
  if (!actor) throw new Error(`no user for ${input.actorEmail}`);

  const [c] =
    (await db.select().from(client).where(sql`${client.name} = ${input.clientName}`).limit(1)).length > 0
      ? await db.select().from(client).where(sql`${client.name} = ${input.clientName}`).limit(1)
      : await db.insert(client).values({ name: input.clientName }).returning();

  const [p] = await withTenant(c!.id, (tx) =>
    tx.insert(project).values({ clientId: c!.id, name: input.projectName }).returning(),
  );

  // repo lives outside RLS (may be org-shared); create or reuse by name
  const existing = await withoutTenant((tx) => tx.select().from(repo).where(sql`${repo.name} = ${input.repo.name}`).limit(1));
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

  await withTenant(c!.id, async (tx) => {
    await tx.insert(clientRepo).values({ clientId: c!.id, repoId: r!.id, addedBy: actor.id }).onConflictDoNothing();
    await tx.insert(projectRepo).values({ clientId: c!.id, projectId: p!.id, repoId: r!.id, addedBy: actor.id }).onConflictDoNothing();
  });

  const out: SetupResult = { clientId: c!.id, projectId: p!.id, repoId: r!.id };

  if (input.firstWorkItem) {
    const [wi] = await withTenant(c!.id, (tx) =>
      tx
        .insert(workitem)
        .values({
          clientId: c!.id,
          projectId: p!.id,
          ownerId: actor.id,
          key: input.firstWorkItem!.key,
          title: input.firstWorkItem!.title,
          level: input.firstWorkItem!.level ?? "story",
          phase: "intake",
        })
        .returning(),
    );
    out.workitemId = wi!.id;
    out.workitemKey = wi!.key ?? undefined;
  }

  return out;
}
