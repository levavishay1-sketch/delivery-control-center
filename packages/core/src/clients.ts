import { desc, eq, isNull, sql } from "drizzle-orm";
import { db, withTenant, withoutTenant } from "@dcc/db";
import { client, clientBudget, clientRepo, project, repo, serviceConnection, users, workitem } from "@dcc/db/schema";

/** Every repo in the system, for pickers. Includes which client (if any) it belongs to. */
export async function listRepos() {
  return db
    .select({
      id: repo.id, name: repo.name, adoRepoRef: repo.adoRepoRef,
      clientId: repo.clientId, clientName: client.name,
      linkedClients: sql<number>`(select count(*) from client_repo cr where cr.repo_id = ${repo.id})::int`,
    })
    .from(repo)
    .leftJoin(client, eq(client.id, repo.clientId))
    .orderBy(repo.name);
}

/** Every connection in the system, for the "reuse an existing connection" picker. */
export async function listConnections() {
  return withoutTenant((tx) =>
    tx
      .select({
        id: sql<string>`sc.id`, kind: sql<string>`sc.kind`, displayName: sql<string>`sc.display_name`,
        config: sql<Record<string, string>>`sc.config`, clientName: client.name, clientId: client.id,
        lastCheckOk: sql<string | null>`sc.last_check_ok`,
      })
      .from(sql`service_connection sc`)
      .innerJoin(client, sql`${client.id} = sc.client_id`)
      .where(sql`sc.revoked_at is null`),
  );
}

export async function listClients() {
  return db
    .select({
      id: client.id,
      name: client.name,
      projects: sql<number>`count(distinct ${project.id})::int`,
      workitems: sql<number>`count(distinct ${workitem.id})::int`,
      spent: sql<number>`coalesce(max(${clientBudget.spentUsd}),0)::float`,
      budget: sql<number>`coalesce(max(${clientBudget.monthlyUsd}),0)::float`,
    })
    .from(client)
    .leftJoin(project, eq(project.clientId, client.id))
    .leftJoin(workitem, eq(workitem.clientId, client.id))
    .leftJoin(clientBudget, eq(clientBudget.clientId, client.id))
    .where(isNull(client.archivedAt))
    .groupBy(client.id)
    .orderBy(client.name);
}

export async function clientDetail(clientId: string) {
  const [c] = await db.select().from(client).where(eq(client.id, clientId));
  if (!c) throw new Error("client not found");

  const projects = await db
    .select({
      id: project.id, name: project.name, status: project.status,
      connectorType: project.connectorType, budgetUsd: project.budgetUsd,
      items: sql<number>`count(distinct ${workitem.id})::int`,
      updatedAt: sql<Date | null>`max(${workitem.updatedAt})`,
    })
    .from(project)
    .leftJoin(workitem, eq(workitem.projectId, project.id))
    .where(sql`${project.clientId} = ${clientId} and ${project.archivedAt} is null`)
    .groupBy(project.id)
    .orderBy(project.name);

  const repos = await withTenant(clientId, (tx) =>
    tx
      .select({ id: repo.id, name: repo.name, adoRepoRef: repo.adoRepoRef, addedAt: clientRepo.addedAt })
      .from(clientRepo)
      .innerJoin(repo, eq(repo.id, clientRepo.repoId))
      .where(eq(clientRepo.clientId, clientId)),
  );

  const connections = await withTenant(clientId, (tx) =>
    tx
      .select({
        id: serviceConnection.id, kind: serviceConnection.kind, displayName: serviceConnection.displayName,
        config: serviceConnection.config, lastCheckedAt: serviceConnection.lastCheckedAt,
        lastCheckOk: serviceConnection.lastCheckOk, revokedAt: serviceConnection.revokedAt,
      })
      .from(serviceConnection)
      .where(eq(serviceConnection.clientId, clientId)),
  );

  return { client: c, projects, repos, connections };
}

/** Explicit, audited repo link (architecture §8). Repos are per-client. */
export async function linkRepoToClient(input: { clientId: string; repoId?: string; name?: string; gitUrl?: string; adoRepoRef?: string; by: { userId: string } }) {
  let r: typeof repo.$inferSelect | undefined;
  if (input.repoId) {
    [r] = await withoutTenant((tx) => tx.select().from(repo).where(eq(repo.id, input.repoId!)).limit(1));
  } else if (input.name) {
    const existing = await withoutTenant((tx) => tx.select().from(repo).where(eq(repo.name, input.name!)).limit(1));
    [r] = existing.length > 0
      ? existing
      : await db.insert(repo).values({ name: input.name, clientId: input.clientId, adoRepoRef: input.adoRepoRef ?? input.gitUrl ?? null }).returning();
  }
  if (!r) throw new Error("repoId or name is required");
  await withTenant(input.clientId, (tx) =>
    tx.insert(clientRepo).values({ clientId: input.clientId, repoId: r!.id, addedBy: input.by.userId }).onConflictDoNothing(),
  );
  return r!;
}

/**
 * Add an Azure DevOps connection for a client. For ADO you need:
 *   - orgUrl  : https://dev.azure.com/<your-org>
 *   - project : the project name inside that org
 *   - pat     : a Personal Access Token with scopes
 *               Work Items (Read, write & manage) + Code (Read)
 *               created at  <orgUrl>/_usersSettings/tokens
 */
export async function addAdoConnection(input: {
  clientId: string;
  orgUrl: string;
  project: string;
  pat: string;
  by: { userId: string };
}) {
  const [row] = await withTenant(input.clientId, (tx) =>
    tx
      .insert(serviceConnection)
      .values({
        clientId: input.clientId,
        kind: "ado",
        displayName: `Azure DevOps — ${input.project}`,
        secretRef: input.pat, // pilot: stored directly; prod: Key Vault path
        scope: ["vso.work_write", "vso.code"],
        config: { orgUrl: input.orgUrl.replace(/\/+$/, ""), project: input.project },
        createdBy: input.by.userId,
      })
      .returning(),
  );
  const check = await checkAdoConnection(input.clientId, row!.id);
  return { ...row!, check };
}

/** Live connectivity check against the ADO REST API. */
export async function checkAdoConnection(clientId: string, connectionId: string) {
  const [conn] = await withTenant(clientId, (tx) =>
    tx.select().from(serviceConnection).where(eq(serviceConnection.id, connectionId)).limit(1),
  );
  if (!conn) throw new Error("connection not found");
  const cfg = conn.config as Record<string, string>;
  const orgUrl = cfg.orgUrl ?? "";
  const proj = cfg.project ?? "";
  const url = `${orgUrl}/_apis/projects/${encodeURIComponent(proj)}?api-version=7.1`;
  let ok = false;
  let detail = "";
  try {
    const res = await fetch(url, { headers: { authorization: `Basic ${Buffer.from(`:${conn.secretRef}`).toString("base64")}` } });
    ok = res.ok;
    detail = res.ok ? `project "${proj}" reachable` : `${res.status} ${res.statusText}`;
  } catch (e) {
    detail = `network: ${String((e as Error).message)}`;
  }
  await withTenant(clientId, (tx) =>
    tx.update(serviceConnection).set({ lastCheckedAt: new Date(), lastCheckOk: ok ? detail : `FAILED — ${detail}` }).where(eq(serviceConnection.id, connectionId)),
  );
  return { ok, detail };
}

void users;
