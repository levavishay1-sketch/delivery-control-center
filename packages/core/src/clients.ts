import { desc, eq, isNull, sql } from "drizzle-orm";
import { db, withTenant, withoutTenant } from "@dcc/db";
import { client, clientBudget, clientRepo, project, repo, serviceConnection, users, workitem } from "@dcc/db/schema";
import { normaliseAdoUrl } from "./ado-url.ts";

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

// On-prem Server ships older API surfaces (2019→5.0, 2020→6.0, 2022→7.x);
// cloud is always current. Try newest first.
const ADO_API_VERSIONS = ["7.1", "7.0", "6.0"];

function adoAuthHeader(pat: string) {
  return { authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`, accept: "application/json" };
}

/** GET an ADO REST path, walking api-versions until one isn't a 404. */
async function adoGet(base: string, path: string, pat: string) {
  const clean = base.replace(/\/+$/, "");
  let last: { status: number; statusText: string } | { network: string } | null = null;
  for (const v of ADO_API_VERSIONS) {
    try {
      const res = await fetch(`${clean}/_apis/${path}${path.includes("?") ? "&" : "?"}api-version=${v}`, {
        headers: adoAuthHeader(pat),
      });
      if (res.ok) return { ok: true as const, apiVersion: v, body: await res.json().catch(() => null) };
      if (res.status === 401) return { ok: false as const, status: 401, detail: "401 — ה-PAT נדחה. בדוק שהוא בתוקף ושיש לו Work Items + Code (Read)." };
      last = { status: res.status, statusText: res.statusText };
      // 404 on an old server can just mean "unknown api-version" — keep trying
    } catch (e) {
      last = { network: String((e as Error).message) };
      break;
    }
  }
  if (last && "network" in last) return { ok: false as const, status: 0, detail: `שגיאת רשת: ${last.network} — האם ${clean} נגיש מהשרת?` };
  return { ok: false as const, status: last?.status ?? 0, detail: last ? `${last.status} ${last.statusText}` : "no response" };
}

/**
 * List the Azure DevOps projects visible to this PAT — for the project
 * picker in the connect form. Accepts whatever the user pasted as the
 * URL (splits off a project/repo path if present).
 */
export async function listAdoProjects(input: { orgUrl: string; pat: string }) {
  const { orgUrl } = normaliseAdoUrl(input.orgUrl, "");
  const r = await adoGet(orgUrl, "projects?$top=500", input.pat);
  if (!r.ok) return { ok: false as const, orgUrl, projects: [] as string[], detail: r.detail };
  const names = (((r.body as { value?: { name?: string }[] } | null)?.value ?? [])
    .map((p) => p.name)
    .filter((n): n is string => !!n)).sort((a, b) => a.localeCompare(b));
  return { ok: true as const, orgUrl, projects: names, detail: `${names.length} פרויקטים (api ${r.apiVersion})` };
}

/**
 * Add an Azure DevOps connection for a client. Works for cloud
 * (dev.azure.com) and on-prem Azure DevOps Server.
 *   - orgUrl  : cloud   https://dev.azure.com/<org>
 *               on-prem http://<server>/<collection>   (e.g. .../DefaultCollection)
 *   - project : optional. Omit for a collection/org-level connection.
 *   - pat     : a Personal Access Token, scopes
 *               Work Items (Read, write & manage) + Code (Read).
 */
export async function addAdoConnection(input: {
  clientId: string;
  orgUrl: string;
  project?: string;
  pat: string;
  by: { userId: string };
}) {
  const { orgUrl, project } = normaliseAdoUrl(input.orgUrl, input.project ?? "");
  const displayName = project ? `Azure DevOps — ${project}` : `Azure DevOps — ${orgUrl.replace(/^https?:\/\//, "")}`;
  const config: Record<string, string> = project ? { orgUrl, project } : { orgUrl };

  const row = await withTenant(input.clientId, async (tx) => {
    // Reuse a live connection to the same org/project rather than piling
    // up a new row on every retry — update its PAT + config and re-check.
    const existing = await tx
      .select()
      .from(serviceConnection)
      .where(sql`${serviceConnection.clientId} = ${input.clientId} and ${serviceConnection.kind} = 'ado'
        and ${serviceConnection.revokedAt} is null
        and ${serviceConnection.config}->>'orgUrl' = ${orgUrl}
        and coalesce(${serviceConnection.config}->>'project','') = ${project}`)
      .limit(1);
    if (existing[0]) {
      const [u] = await tx
        .update(serviceConnection)
        .set({ secretRef: input.pat, displayName, config })
        .where(eq(serviceConnection.id, existing[0].id))
        .returning();
      return u!;
    }
    const [ins] = await tx
      .insert(serviceConnection)
      .values({
        clientId: input.clientId,
        kind: "ado",
        displayName,
        secretRef: input.pat, // pilot: stored directly; prod: Key Vault path
        scope: ["vso.work_write", "vso.code"],
        config,
        createdBy: input.by.userId,
      })
      .returning();
    return ins!;
  });
  const check = await checkAdoConnection(input.clientId, row.id);
  return { ...row, check };
}

/** Remove a connection. Pilot: hard delete (pure transport config, no dependents). */
export async function deleteConnection(clientId: string, connectionId: string) {
  await withTenant(clientId, (tx) =>
    tx.delete(serviceConnection).where(eq(serviceConnection.id, connectionId)),
  );
  return { deleted: true };
}

/** Live connectivity check against the ADO REST API (cloud or on-prem). */
export async function checkAdoConnection(clientId: string, connectionId: string) {
  const [conn] = await withTenant(clientId, (tx) =>
    tx.select().from(serviceConnection).where(eq(serviceConnection.id, connectionId)).limit(1),
  );
  if (!conn) throw new Error("connection not found");
  const cfg = conn.config as Record<string, string>;
  const orgUrl = (cfg.orgUrl ?? "").replace(/\/+$/, "");
  const proj = cfg.project ?? "";

  const r = proj
    ? await adoGet(orgUrl, `projects/${encodeURIComponent(proj)}`, conn.secretRef)
    : await adoGet(orgUrl, "projects?$top=1", conn.secretRef);

  let ok = r.ok;
  let detail: string;
  if (r.ok) {
    detail = proj ? `הפרויקט "${proj}" נגיש (api ${r.apiVersion})` : `ה-collection נגיש (api ${r.apiVersion})`;
  } else if (r.status === 404 && proj) {
    // maybe they left the project inside the URL — retry with the last segment moved out
    const m = orgUrl.match(/^(.*)\/([^/]+)$/);
    if (m && decodeURIComponent(m[2]!).toLowerCase() !== proj.toLowerCase()) {
      const alt = await adoGet(m[1]!, `projects/${encodeURIComponent(proj)}`, conn.secretRef);
      if (alt.ok) {
        await withTenant(clientId, (tx) =>
          tx.update(serviceConnection).set({ config: { orgUrl: m[1]!, project: proj } }).where(eq(serviceConnection.id, connectionId)),
        );
        detail = `הפרויקט "${proj}" נגיש (api ${alt.apiVersion}) — תיקנתי את ה-Organization URL ל-${m[1]}`;
        ok = true;
        await withTenant(clientId, (tx) =>
          tx.update(serviceConnection).set({ lastCheckedAt: new Date(), lastCheckOk: detail }).where(eq(serviceConnection.id, connectionId)),
        );
        return { ok, detail };
      }
    }
    detail = `404 — לא נמצא הפרויקט "${proj}" תחת ${orgUrl}. ודא ש-Organization URL הוא ה-org/collection בלבד ושם הפרויקט מדויק (או בחר מהרשימה).`;
  } else {
    detail = r.detail;
  }

  await withTenant(clientId, (tx) =>
    tx.update(serviceConnection).set({ lastCheckedAt: new Date(), lastCheckOk: ok ? detail : `FAILED — ${detail}` }).where(eq(serviceConnection.id, connectionId)),
  );
  return { ok, detail };
}

void users;
