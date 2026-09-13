import { and, eq, isNotNull } from "drizzle-orm";
import { appendEvent, withTenant } from "@dcc/db";
import { attachment, workitem } from "@dcc/db/schema";
import { adoGet, adoSend, adoUpload } from "./ado-http.ts";
import { activeAdoConnection } from "./ado-sync.ts";
import { htmlToText, mapAdoState, mapAdoType } from "./ado-map.ts";
import { regenerateBrief } from "./brief/generate.ts";

/**
 * Azure DevOps / TFS is the mirror. This pulls the connected project's
 * work items INTO DCC:
 *   - new in TFS      → created in DCC (linked)
 *   - changed in TFS  → title / type / state updated in DCC (TFS wins)
 *   - gone from TFS   → the DCC requirement is deleted
 *   - attachments     → recorded in DCC with a link back to TFS
 */

type AdoWi = {
  id: number;
  fields: Record<string, unknown>;
  relations?: { rel: string; url: string; attributes?: Record<string, unknown> }[];
  _links?: { html?: { href?: string } };
};

async function wiqlIds(base: string, pat: string): Promise<number[]> {
  const clean = base.replace(/\/+$/, "");
  const q = { query: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project" };
  for (const v of ["5.0", "4.1", "6.0", "7.0", "7.1"]) {
    try {
      const res = await fetch(`${clean}/_apis/wit/wiql?api-version=${v}`, {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(q),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const b = (await res.json()) as { workItems?: { id: number }[] };
        return (b.workItems ?? []).map((w) => w.id);
      }
      if (res.status === 401) throw new Error("401 — PAT rejected");
    } catch (e) {
      if (String(e).includes("401")) throw e;
    }
  }
  throw new Error("WIQL query failed on every api-version");
}

async function getWorkItems(base: string, ids: number[], pat: string): Promise<AdoWi[]> {
  const out: AdoWi[] = [];
  for (let i = 0; i < ids.length; i += 190) {
    const batch = ids.slice(i, i + 190).join(",");
    const r = await adoGet(base, `wit/workitems?ids=${batch}&$expand=relations`, pat);
    if (!r.ok) throw new Error(`work item fetch failed: ${r.detail}`);
    out.push(...(((r.body as { value?: AdoWi[] }).value ?? [])));
  }
  return out;
}

type DccRow = { id: string; adoId: number | null; title: string; type: string; phase: string };

/** Reconcile ONE ADO work item into DCC: fields (TFS wins) + attachments. */
async function reconcileOne(
  clientId: string, w: AdoWi, existing: DccRow | undefined,
  orgUrl: string, project: string, by: { userId: string }, res: { created: number; updated: number; attachmentsAdded: number },
): Promise<string> {
  const f = w.fields;
  const title = String(f["System.Title"] ?? "").trim() || `#${w.id}`;
  const type = mapAdoType(String(f["System.WorkItemType"] ?? ""));
  const phase = mapAdoState(String(f["System.State"] ?? ""));
  const area = String(f["System.AreaPath"] ?? "") || null;
  const url = w._links?.html?.href ?? `${orgUrl}/${encodeURIComponent(project)}/_workitems/edit/${w.id}`;

  let wiId: string;
  if (existing) {
    wiId = existing.id;
    if (existing.title !== title || existing.type !== type || existing.phase !== phase) {
      await withTenant(clientId, (tx) =>
        tx.update(workitem).set({ title, type, phase, adoUrl: url, adoAreaPath: area, updatedAt: new Date() }).where(eq(workitem.id, existing.id)),
      );
      await appendEvent({
        clientId, workitemId: existing.id, source: "ado", type: "ado.synced",
        actor: { kind: "user", userId: by.userId, identityType: "interactive" },
        links: [{ rel: "ado_workitem", ref: String(w.id) }],
        payload: { direction: "from_ado", adoId: w.id, operation: "reconcile", url },
      });
      res.updated++;
    }
  } else {
    const [ins] = await withTenant(clientId, (tx) =>
      tx.insert(workitem).values({
        clientId, ownerId: by.userId, title, type, phase,
        key: `ADO-${w.id}`, linkedAdoId: w.id, adoUrl: url, adoAreaPath: area,
      }).returning(),
    );
    wiId = ins!.id;
    const desc = htmlToText(String(f["System.Description"] ?? ""));
    await appendEvent({
      clientId, workitemId: wiId, source: "ado", type: "ado.synced",
      actor: { kind: "user", userId: by.userId, identityType: "interactive" },
      links: [{ rel: "ado_workitem", ref: String(w.id) }],
      payload: { direction: "from_ado", adoId: w.id, operation: "create_workitem", url },
    });
    if (desc) await appendEvent({
      clientId, workitemId: wiId, source: "ado", type: "note.added",
      actor: { kind: "user", userId: by.userId, identityType: "interactive" },
      payload: { body: `תיאור מ-ADO:\n${desc}` },
    });
    res.created++;
  }

  // attachments — TFS is the mirror; new ones show up here with a link back
  const atts = (w.relations ?? []).filter((r) => r.rel === "AttachedFile");
  const known = new Set(
    (await withTenant(clientId, (tx) =>
      tx.select({ a: attachment.adoAttachmentId }).from(attachment).where(eq(attachment.workitemId, wiId)),
    )).map((r) => r.a),
  );
  for (const a of atts) {
    const attId = a.url.split("/").pop()?.split("?")[0] ?? a.url;
    if (known.has(attId)) continue;
    await withTenant(clientId, (tx) =>
      tx.insert(attachment).values({
        clientId, workitemId: wiId, name: String(a.attributes?.name ?? attId),
        adoAttachmentId: attId, adoUrl: a.url,
        sizeBytes: typeof a.attributes?.resourceSize === "number" ? a.attributes.resourceSize : null,
        source: "ado", addedBy: by.userId,
      }),
    );
    res.attachmentsAdded++;
  }
  return wiId;
}

/**
 * Reconcile a single linked requirement against its TFS work item —
 * fields + attachments. Returns "gone" if the TFS item was deleted (the
 * caller mirrors that by deleting the DCC row).
 */
export async function pullOneFromAdo(clientId: string, workitemId: string, by: { userId: string }): Promise<"ok" | "gone" | "skip"> {
  const conn = await activeAdoConnection(clientId);
  if (!conn) return "skip";
  const orgUrl = (conn.config.orgUrl ?? "").replace(/\/+$/, "");
  const project = conn.config.project ?? "";
  if (!project) return "skip";
  const projBase = `${orgUrl}/${encodeURIComponent(project)}`;

  const [row] = await withTenant(clientId, (tx) =>
    tx.select({ id: workitem.id, adoId: workitem.linkedAdoId, title: workitem.title, type: workitem.type, phase: workitem.phase })
      .from(workitem).where(eq(workitem.id, workitemId)).limit(1),
  );
  if (!row?.adoId) return "skip";

  const r = await adoGet(projBase, `wit/workitems/${row.adoId}?$expand=relations`, conn.secretRef);
  // Only "gone" when ADO explicitly said the item does not exist — never
  // off a bare 404, which on old on-prem servers just means the probed
  // api-version is unknown. A transient/ambiguous failure is "skip".
  if (!r.ok) return r.resourceMissing ? "gone" : "skip";
  const w = r.body as AdoWi;
  const res = { created: 0, updated: 0, attachmentsAdded: 0 };
  await reconcileOne(clientId, w, row as DccRow, orgUrl, project, by, res);
  if (res.updated || res.attachmentsAdded) await regenerateBrief(clientId, row.id);
  return "ok";
}

export type PullResult = {
  created: number;
  updated: number;
  deleted: number;
  attachmentsAdded: number;
  detail: string;
};

export async function pullFromAdo(clientId: string, by: { userId: string }): Promise<PullResult> {
  const conn = await activeAdoConnection(clientId);
  if (!conn) throw new Error("ללקוח אין חיבור Azure DevOps פעיל");
  const orgUrl = (conn.config.orgUrl ?? "").replace(/\/+$/, "");
  const project = conn.config.project ?? "";
  if (!project) throw new Error("החיבור הוא ברמת collection בלבד");
  const projBase = `${orgUrl}/${encodeURIComponent(project)}`;

  const ids = await wiqlIds(projBase, conn.secretRef);
  const items = ids.length ? await getWorkItems(projBase, ids, conn.secretRef) : [];
  const adoById = new Map(items.map((w) => [w.id, w]));

  const dccRows = await withTenant(clientId, (tx) =>
    tx.select({ id: workitem.id, adoId: workitem.linkedAdoId, title: workitem.title, type: workitem.type, phase: workitem.phase })
      .from(workitem).where(and(eq(workitem.clientId, clientId), isNotNull(workitem.linkedAdoId))),
  );
  const dccByAdo = new Map(dccRows.map((r) => [r.adoId!, r]));

  const res: PullResult = { created: 0, updated: 0, deleted: 0, attachmentsAdded: 0, detail: "" };

  // gone from TFS → delete in DCC. Guard rails: an empty WIQL result is
  // almost always a query hiccup, not "the project was emptied", so never
  // delete off it. For anything missing from a non-empty result, confirm
  // with a direct GET that ADO really says it's gone before mirroring.
  if (ids.length > 0) {
    for (const r of dccRows) {
      if (adoById.has(r.adoId!)) continue;
      const chk = await adoGet(projBase, `wit/workitems/${r.adoId}`, conn.secretRef);
      if (chk.ok || !chk.resourceMissing) continue; // still there, or can't tell — keep it
      await withTenant(clientId, (tx) => tx.delete(workitem).where(eq(workitem.id, r.id)));
      res.deleted++;
    }
  }

  for (const w of items) {
    const wiId = await reconcileOne(clientId, w, dccByAdo.get(w.id) as DccRow | undefined, orgUrl, project, by, res);
    await regenerateBrief(clientId, wiId);
  }

  res.detail = `נוצרו ${res.created} · עודכנו ${res.updated} · נמחקו ${res.deleted} · ${res.attachmentsAdded} צרופות`;
  return res;
}

/** Does the linked TFS work item still exist? Used to mirror a delete-in-TFS. */
export async function adoWorkItemExists(clientId: string, adoId: number): Promise<boolean | null> {
  const conn = await activeAdoConnection(clientId);
  if (!conn) return null;
  const orgUrl = (conn.config.orgUrl ?? "").replace(/\/+$/, "");
  const project = conn.config.project ?? "";
  if (!project) return null;
  const r = await adoGet(`${orgUrl}/${encodeURIComponent(project)}`, `wit/workitems/${adoId}`, conn.secretRef);
  if (r.ok) return true;
  if (r.resourceMissing) return false;
  return null; // couldn't tell (network / auth / bad api-version) — don't delete on a maybe
}

/* ── attachments: DCC → TFS ─────────────────────────────────────────── */

export async function attachmentsFor(clientId: string, workitemId: string) {
  return withTenant(clientId, (tx) =>
    tx.select().from(attachment).where(eq(attachment.workitemId, workitemId)).orderBy(attachment.createdAt),
  );
}

/**
 * Add a file to a requirement: upload the bytes to ADO, attach them to
 * the linked work item, and record it in DCC with a link back. The file
 * ends up visible in TFS (the mirror) and listed in DCC.
 */
export async function addAttachment(input: {
  clientId: string; workitemId: string; name: string; bytes: Buffer; by: { userId: string };
}): Promise<{ id: string; name: string; adoUrl: string | null }> {
  const conn = await activeAdoConnection(input.clientId);
  const [wi] = await withTenant(input.clientId, (tx) =>
    tx.select({ ado: workitem.linkedAdoId }).from(workitem).where(eq(workitem.id, input.workitemId)).limit(1),
  );
  if (!wi) throw new Error("requirement not found");

  // A requirement is DCC-only, so there is usually no work item to hang
  // the file on. The bytes still go to the TFS attachment store (that
  // endpoint stands alone) so the link works; when the requirement
  // happens to carry a legacy ADO link we also attach the relation.
  let adoUrl: string | null = null;
  let adoAttId: string | null = null;
  if (!conn) throw new Error("צריך חיבור Azure DevOps פעיל כדי לאחסן צרופות");
  {
    const orgUrl = (conn.config.orgUrl ?? "").replace(/\/+$/, "");
    const project = conn.config.project ?? "";
    const projBase = project ? `${orgUrl}/${encodeURIComponent(project)}` : orgUrl;
    const up = await adoUpload({ base: projBase, fileName: input.name, bytes: input.bytes, pat: conn.secretRef });
    if (!up.ok) throw new Error(`העלאת הקובץ נכשלה: ${up.detail}`);
    adoUrl = up.url; adoAttId = up.id;
    if (wi.ado) {
      const patch = [{ op: "add", path: "/relations/-", value: { rel: "AttachedFile", url: up.url, attributes: { name: input.name, comment: "הועלה דרך DCC" } } }];
      await adoSend({ base: projBase, apiPath: `wit/workitems/${wi.ado}`, method: "PATCH", body: patch, pat: conn.secretRef }).catch(() => {});
    }
  }

  const [row] = await withTenant(input.clientId, (tx) =>
    tx.insert(attachment).values({
      clientId: input.clientId, workitemId: input.workitemId, name: input.name,
      adoAttachmentId: adoAttId, adoUrl, sizeBytes: input.bytes.length, source: "dcc", addedBy: input.by.userId,
    }).returning(),
  );
  await appendEvent({
    clientId: input.clientId, workitemId: input.workitemId, source: "manual", type: "note.added",
    actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
    payload: { body: `📎 צורף קובץ: ${input.name}` },
  });
  await regenerateBrief(input.clientId, input.workitemId);
  return { id: row!.id, name: row!.name, adoUrl: row!.adoUrl };
}
