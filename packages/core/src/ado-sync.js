import { and, eq, isNull, sql } from "drizzle-orm";
import { appendEvent, db, withTenant } from "@dcc/db";
import { client, serviceConnection, workitem } from "@dcc/db/schema";
import { adoDelete, adoSend } from "./ado-http.js";
import { DCC_TYPE_TO_ADO, PHASE_TO_ADO_STATE } from "./ado-map.js";
import { regenerateBrief } from "./brief/generate.js";
export async function activeAdoConnection(clientId) {
    const rows = await withTenant(clientId, (tx) => tx
        .select({ id: serviceConnection.id, secretRef: serviceConnection.secretRef, config: serviceConnection.config })
        .from(serviceConnection)
        .where(and(eq(serviceConnection.clientId, clientId), eq(serviceConnection.kind, "ado"), isNull(serviceConnection.revokedAt)))
        .orderBy(sql `${serviceConnection.createdAt} desc`)
        .limit(1));
    const c = rows[0];
    return c ? { id: c.id, secretRef: c.secretRef, config: c.config } : null;
}
/** The human-facing URL for a work item on this server. */
export function adoWorkItemUrl(orgUrl, project, adoId) {
    return `${orgUrl.replace(/\/+$/, "")}/${encodeURIComponent(project)}/_workitems/edit/${adoId}`;
}
export async function syncRequirementToAdo(input) {
    const conn = await activeAdoConnection(input.clientId);
    if (!conn)
        throw new Error("ללקוח אין חיבור Azure DevOps פעיל");
    const orgUrl = (conn.config.orgUrl ?? "").replace(/\/+$/, "");
    const project = conn.config.project ?? "";
    if (!project)
        throw new Error("החיבור הוא ברמת collection בלבד — צריך פרויקט כדי לסנכרן");
    // work-item routes are project-scoped: {collection}/{project}/_apis/wit/...
    const projBase = `${orgUrl}/${encodeURIComponent(project)}`;
    const [c] = await db.select().from(client).where(eq(client.id, input.clientId)).limit(1);
    const [wi] = await withTenant(input.clientId, (tx) => tx.select().from(workitem).where(eq(workitem.id, input.workitemId)).limit(1));
    if (!wi)
        throw new Error("requirement not found");
    const adoType = DCC_TYPE_TO_ADO[wi.type] ?? "Task";
    // only send an AreaPath that actually lives under the connected project —
    // a path from a CSV import (e.g. "Altshul IT\GEMEL\CRM") isn't a valid
    // node here and ADO rejects the whole create (TF401347). Fall back to root.
    const wantedArea = wi.adoAreaPath || c?.adoProjectRef || "";
    const areaPath = wantedArea && wantedArea.toLowerCase().startsWith(project.toLowerCase()) ? wantedArea : project;
    // parent's ADO id, if the parent is itself synced
    let parentAdoId = null;
    if (wi.parentId) {
        const [p] = await withTenant(input.clientId, (tx) => tx.select({ a: workitem.linkedAdoId }).from(workitem).where(eq(workitem.id, wi.parentId)).limit(1));
        parentAdoId = p?.a ?? null;
    }
    if (wi.linkedAdoId) {
        // already linked → push title; then try the state (transition may be rejected — non-fatal)
        const patch = [{ op: "add", path: "/fields/System.Title", value: wi.title }];
        const res = await adoSend({ base: projBase, apiPath: `wit/workitems/${wi.linkedAdoId}`, method: "PATCH", body: patch, pat: conn.secretRef });
        if (!res.ok)
            throw new Error(`עדכון ב-ADO נכשל: ${res.detail}`);
        const wantState = PHASE_TO_ADO_STATE[wi.phase];
        if (wantState) {
            await adoSend({ base: projBase, apiPath: `wit/workitems/${wi.linkedAdoId}`, method: "PATCH", body: [{ op: "add", path: "/fields/System.State", value: wantState }], pat: conn.secretRef }).catch(() => { });
        }
        const links = res.body._links;
        const url = links?.html?.href || adoWorkItemUrl(orgUrl, project, wi.linkedAdoId);
        await withTenant(input.clientId, (tx) => tx.update(workitem).set({ adoUrl: url }).where(eq(workitem.id, input.workitemId)));
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
    const desc = wi.key?.startsWith("ADO-")
        ? `נוצר מ-DCC · יובא במקור מ-${wi.key}${wantedArea && wantedArea !== areaPath ? ` (area מקורי: ${wantedArea})` : ""}`
        : `נוצר מ-DCC · requirement ${wi.id}`;
    const patch = [
        { op: "add", path: "/fields/System.Title", value: wi.title },
        { op: "add", path: "/fields/System.AreaPath", value: areaPath },
        { op: "add", path: "/fields/System.Description", value: desc },
    ];
    if (parentAdoId) {
        patch.push({
            op: "add",
            path: "/relations/-",
            value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: `${orgUrl}/_apis/wit/workItems/${parentAdoId}` },
        });
    }
    const res = await adoSend({ base: projBase, apiPath: `wit/workitems/${encodeURIComponent("$" + adoType)}`, method: "POST", body: patch, pat: conn.secretRef });
    if (!res.ok)
        throw new Error(`יצירה ב-ADO נכשלה (${adoType}): ${res.detail}`);
    const adoId = Number(res.body.id);
    const links = res.body._links;
    const url = links?.html?.href || adoWorkItemUrl(orgUrl, project, adoId);
    await withTenant(input.clientId, (tx) => tx.update(workitem).set({ linkedAdoId: adoId, adoUrl: url, adoAreaPath: areaPath, updatedAt: new Date() }).where(eq(workitem.id, input.workitemId)));
    await appendEvent({
        clientId: input.clientId, workitemId: input.workitemId, source: "ado", type: "ado.synced",
        actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
        links: [{ rel: "ado_workitem", ref: String(adoId) }],
        payload: { direction: "to_ado", adoId, operation: parentAdoId ? "create_link" : "create_workitem", url },
    });
    await regenerateBrief(input.clientId, input.workitemId);
    return { adoId, url, created: true };
}
/**
 * Soft-delete the linked ADO work item (→ recycle bin). Best-effort:
 * returns a status string, never throws — a DCC delete shouldn't be
 * blocked by ADO being unreachable.
 */
export async function deleteAdoForRequirement(clientId, linkedAdoId) {
    try {
        const conn = await activeAdoConnection(clientId);
        if (!conn)
            return { ok: false, detail: "no ADO connection" };
        const orgUrl = (conn.config.orgUrl ?? "").replace(/\/+$/, "");
        const project = conn.config.project ?? "";
        const base = project ? `${orgUrl}/${encodeURIComponent(project)}` : orgUrl;
        const r = await adoDelete(base, `wit/workitems/${linkedAdoId}`, conn.secretRef);
        return r.ok ? { ok: true, detail: `ADO #${linkedAdoId} deleted` } : { ok: false, detail: `ADO delete failed (${r.status})` };
    }
    catch (e) {
        return { ok: false, detail: String(e.message) };
    }
}
/**
 * Push every not-yet-linked requirement of a client into the connected
 * ADO project (create). Used after a CSV import. Returns per-item outcome.
 */
export async function syncAllToAdo(clientId, by) {
    const rows = await withTenant(clientId, (tx) => tx.select({ id: workitem.id, title: workitem.title }).from(workitem)
        .where(and(eq(workitem.clientId, clientId), isNull(workitem.linkedAdoId)))
        .orderBy(workitem.createdAt));
    const out = { total: rows.length, created: 0, failed: 0, items: [] };
    for (const r of rows) {
        try {
            const res = await syncRequirementToAdo({ clientId, workitemId: r.id, by });
            out.created++;
            out.items.push({ title: r.title, ok: true, adoId: res.adoId, url: res.url });
        }
        catch (e) {
            out.failed++;
            out.items.push({ title: r.title, ok: false, error: String(e.message) });
        }
    }
    return out;
}
/** Best-effort sync used right after creating a requirement. Never throws. */
export async function trySyncNewRequirement(clientId, workitemId, by) {
    try {
        const [c] = await db.select({ ct: client.connectorType }).from(client).where(eq(client.id, clientId)).limit(1);
        if (c?.ct !== "ado")
            return { synced: false };
        const out = await syncRequirementToAdo({ clientId, workitemId, by });
        return { synced: true, ...out };
    }
    catch (e) {
        return { synced: false, error: String(e.message) };
    }
}
//# sourceMappingURL=ado-sync.js.map