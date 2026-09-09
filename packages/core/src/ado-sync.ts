import { and, eq, isNull, sql } from "drizzle-orm";
import { appendEvent, db, withTenant } from "@dcc/db";
import { client, serviceConnection, workitem } from "@dcc/db/schema";
import { adoSend } from "./ado-http.ts";
import { regenerateBrief } from "./brief/generate.ts";

/**
 * Push a DCC requirement into Azure DevOps as a work item and link it
 * back (linkedAdoId + a `ado.synced` event carrying the URL). Once
 * linked, ADO is the source of truth for the work item's state
 * (architecture §8) — later edits PATCH it.
 *
 * Not yet: pulling state changes back from ADO, iteration paths,
 * rich field mapping. This is the create + parent-link slice.
 */

/** DCC type → Azure DevOps work-item type. Agile process names; falls back to Task. */
const TYPE_MAP: Record<string, string> = {
  epic: "Epic",
  feature: "Feature",
  story: "User Story",
  bug: "Bug",
  task: "Task",
  spike: "Task",
};

type AdoConn = { id: string; secretRef: string; config: Record<string, string> };

async function activeAdoConnection(clientId: string): Promise<AdoConn | null> {
  const rows = await withTenant(clientId, (tx) =>
    tx
      .select({ id: serviceConnection.id, secretRef: serviceConnection.secretRef, config: serviceConnection.config })
      .from(serviceConnection)
      .where(and(eq(serviceConnection.clientId, clientId), eq(serviceConnection.kind, "ado"), isNull(serviceConnection.revokedAt)))
      .orderBy(sql`${serviceConnection.createdAt} desc`)
      .limit(1),
  );
  const c = rows[0];
  return c ? { id: c.id, secretRef: c.secretRef, config: c.config as Record<string, string> } : null;
}

/** The human-facing URL for a work item on this server. */
export function adoWorkItemUrl(orgUrl: string, project: string, adoId: number): string {
  return `${orgUrl.replace(/\/+$/, "")}/${encodeURIComponent(project)}/_workitems/edit/${adoId}`;
}

export async function syncRequirementToAdo(input: { clientId: string; workitemId: string; by: { userId: string } }) {
  const conn = await activeAdoConnection(input.clientId);
  if (!conn) throw new Error("ללקוח אין חיבור Azure DevOps פעיל");
  const orgUrl = (conn.config.orgUrl ?? "").replace(/\/+$/, "");
  const project = conn.config.project ?? "";
  if (!project) throw new Error("החיבור הוא ברמת collection בלבד — צריך פרויקט כדי לסנכרן");
  // work-item routes are project-scoped: {collection}/{project}/_apis/wit/...
  const projBase = `${orgUrl}/${encodeURIComponent(project)}`;

  const [c] = await db.select().from(client).where(eq(client.id, input.clientId)).limit(1);
  const [wi] = await withTenant(input.clientId, (tx) => tx.select().from(workitem).where(eq(workitem.id, input.workitemId)).limit(1));
  if (!wi) throw new Error("requirement not found");

  const adoType = TYPE_MAP[wi.type] ?? "Task";
  const areaPath = wi.adoAreaPath || c?.adoProjectRef || project;

  // parent's ADO id, if the parent is itself synced
  let parentAdoId: number | null = null;
  if (wi.parentId) {
    const [p] = await withTenant(input.clientId, (tx) => tx.select({ a: workitem.linkedAdoId }).from(workitem).where(eq(workitem.id, wi.parentId!)).limit(1));
    parentAdoId = p?.a ?? null;
  }

  if (wi.linkedAdoId) {
    // already linked → patch the title (state mapping is a later slice)
    const patch = [{ op: "add", path: "/fields/System.Title", value: wi.title }];
    const res = await adoSend({ base: projBase, apiPath: `wit/workitems/${wi.linkedAdoId}`, method: "PATCH", body: patch, pat: conn.secretRef });
    if (!res.ok) throw new Error(`עדכון ב-ADO נכשל: ${res.detail}`);
    const links = res.body._links as { html?: { href?: string } } | undefined;
    const url = links?.html?.href || adoWorkItemUrl(orgUrl, project, wi.linkedAdoId);
    await appendEvent({
      clientId: input.clientId, workitemId: input.workitemId, source: "ado", type: "ado.synced",
      actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
      links: [{ rel: "ado_workitem", ref: String(wi.linkedAdoId) }],
      payload: { direction: "to_ado", adoId: wi.linkedAdoId, operation: "update_state", url },
    });
    await regenerateBrief(input.clientId, input.workitemId);
    return { adoId: wi.linkedAdoId, url, created: false };
  }

  // create
  const patch: Array<Record<string, unknown>> = [
    { op: "add", path: "/fields/System.Title", value: wi.title },
    { op: "add", path: "/fields/System.AreaPath", value: areaPath },
    { op: "add", path: "/fields/System.Description", value: `נוצר מ-DCC · requirement ${wi.id}` },
  ];
  if (parentAdoId) {
    patch.push({
      op: "add",
      path: "/relations/-",
      value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: `${orgUrl}/_apis/wit/workItems/${parentAdoId}` },
    });
  }
  const res = await adoSend({ base: projBase, apiPath: `wit/workitems/${encodeURIComponent("$" + adoType)}`, method: "POST", body: patch, pat: conn.secretRef });
  if (!res.ok) throw new Error(`יצירה ב-ADO נכשלה (${adoType}): ${res.detail}`);
  const adoId = Number(res.body.id);
  const links = res.body._links as { html?: { href?: string } } | undefined;
  const url = links?.html?.href || adoWorkItemUrl(orgUrl, project, adoId);

  await withTenant(input.clientId, (tx) =>
    tx.update(workitem).set({ linkedAdoId: adoId, adoAreaPath: areaPath, updatedAt: new Date() }).where(eq(workitem.id, input.workitemId)),
  );
  await appendEvent({
    clientId: input.clientId, workitemId: input.workitemId, source: "ado", type: "ado.synced",
    actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
    links: [{ rel: "ado_workitem", ref: String(adoId) }],
    payload: { direction: "to_ado", adoId, operation: parentAdoId ? "create_link" : "create_workitem", url },
  });
  await regenerateBrief(input.clientId, input.workitemId);
  return { adoId, url, created: true };
}

/** Best-effort sync used right after creating a requirement. Never throws. */
export async function trySyncNewRequirement(clientId: string, workitemId: string, by: { userId: string }) {
  try {
    const [c] = await db.select({ ct: client.connectorType }).from(client).where(eq(client.id, clientId)).limit(1);
    if (c?.ct !== "ado") return { synced: false as const };
    const out = await syncRequirementToAdo({ clientId, workitemId, by });
    return { synced: true as const, ...out };
  } catch (e) {
    return { synced: false as const, error: String((e as Error).message) };
  }
}
