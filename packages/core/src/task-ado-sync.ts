import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { appendEvent, db, withTenant } from "@dcc/db";
import { client, task, taskDependency, workitem } from "@dcc/db/schema";
import { adoSend } from "./ado-http.ts";
import { activeAdoConnection, adoWorkItemUrl } from "./ado-sync.ts";
import { regenerateBrief } from "./brief/generate.ts";

/**
 * TASKS are what lives in TFS — a requirement is a DCC-only pre-stage and
 * is never pushed (architecture correction: the requirement is shaping,
 * the tasks are the tracked work).
 *
 * On approval the task tree is materialised top-down: each node becomes a
 * work item whose TYPE came off the Agile ladder when the breakdown chose
 * its depth (Epic > Feature > User Story > Task), wired to its parent with
 * Hierarchy-Reverse and to its predecessors with Dependency-Reverse.
 */

export type MaterializeResult = {
  created: number;
  skipped: number;
  links: number;
  items: { taskId: string; seq: number; adoId: number; adoType: string; url: string }[];
  detail: string;
};

type TaskRow = {
  id: string; seq: number; intent: string; adoType: string | null;
  parentTaskId: string | null; linkedAdoId: number | null;
  affectedPaths: string[]; appetite: string;
};

/** Depth of a node in the parent chain (0 = root). */
function levelOf(id: string, byId: Map<string, TaskRow>, seen = new Set<string>()): number {
  const t = byId.get(id);
  if (!t?.parentTaskId || seen.has(id) || !byId.has(t.parentTaskId)) return 0;
  seen.add(id);
  return levelOf(t.parentTaskId, byId, seen) + 1;
}

export async function materializeTasksToAdo(input: { clientId: string; workitemId: string; by: { userId: string } }): Promise<MaterializeResult> {
  const conn = await activeAdoConnection(input.clientId);
  if (!conn) throw new Error("ללקוח אין חיבור Azure DevOps פעיל");
  const orgUrl = (conn.config.orgUrl ?? "").replace(/\/+$/, "");
  const project = conn.config.project ?? "";
  if (!project) throw new Error("החיבור הוא ברמת collection בלבד — צריך פרויקט כדי להקים משימות");
  const projBase = `${orgUrl}/${encodeURIComponent(project)}`;

  const [c] = await db.select().from(client).where(eq(client.id, input.clientId)).limit(1);
  const wantedArea = c?.adoProjectRef || "";
  const areaPath = wantedArea && wantedArea.toLowerCase().startsWith(project.toLowerCase()) ? wantedArea : project;

  const { rows, deps, reqKey, reqTitle } = await withTenant(input.clientId, async (tx) => {
    const [wi] = await tx.select({ key: workitem.key, title: workitem.title }).from(workitem).where(eq(workitem.id, input.workitemId)).limit(1);
    const rows = (await tx
      .select({
        id: task.id, seq: task.seq, intent: task.intent, adoType: task.adoType,
        parentTaskId: task.parentTaskId, linkedAdoId: task.linkedAdoId,
        affectedPaths: task.affectedPaths, appetite: task.appetite,
      })
      .from(task)
      .where(and(eq(task.workitemId, input.workitemId), isNotNull(task.approvedAt), sql`${task.state} <> 'dropped'`))
      .orderBy(task.seq)) as TaskRow[];
    const ids = rows.map((r) => r.id);
    const deps = ids.length
      ? await tx.select().from(taskDependency).where(sql`${taskDependency.taskId} in ${ids}`)
      : [];
    return { rows, deps, reqKey: wi?.key ?? null, reqTitle: wi?.title ?? "" };
  });

  if (rows.length === 0) throw new Error("אין משימות מאושרות להקמה");

  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = [...rows].sort((a, b) => levelOf(a.id, byId) - levelOf(b.id, byId) || a.seq - b.seq);

  const res: MaterializeResult = { created: 0, skipped: 0, links: 0, items: [], detail: "" };
  const adoIdOf = new Map<string, number>(rows.filter((r) => r.linkedAdoId).map((r) => [r.id, r.linkedAdoId!]));

  for (const t of ordered) {
    if (t.linkedAdoId) { res.skipped++; continue; }
    const adoType = t.adoType || "Task";
    const parentAdoId = t.parentTaskId ? adoIdOf.get(t.parentTaskId) ?? null : null;

    const descLines = [
      `נוצר מ-DCC · דרישה ${reqKey ?? input.workitemId}: ${reqTitle}`,
      `appetite: ${t.appetite}`,
      ...(t.affectedPaths.length ? [`קבצים צפויים: ${t.affectedPaths.join(", ")}`] : []),
    ];
    const patch: Array<Record<string, unknown>> = [
      { op: "add", path: "/fields/System.Title", value: t.intent.slice(0, 250) },
      { op: "add", path: "/fields/System.AreaPath", value: areaPath },
      { op: "add", path: "/fields/System.Description", value: descLines.join("<br>") },
    ];
    if (parentAdoId) {
      patch.push({
        op: "add", path: "/relations/-",
        value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: `${orgUrl}/_apis/wit/workItems/${parentAdoId}` },
      });
    }

    const r = await adoSend({ base: projBase, apiPath: `wit/workitems/${encodeURIComponent("$" + adoType)}`, method: "POST", body: patch, pat: conn.secretRef });
    if (!r.ok) throw new Error(`הקמת "${t.intent.slice(0, 40)}" כ-${adoType} נכשלה: ${r.detail}`);
    const adoId = Number(r.body.id);
    const links = r.body._links as { html?: { href?: string } } | undefined;
    const url = links?.html?.href || adoWorkItemUrl(orgUrl, project, adoId);

    adoIdOf.set(t.id, adoId);
    await withTenant(input.clientId, (tx) =>
      tx.update(task).set({ linkedAdoId: adoId, adoUrl: url, adoSyncedAt: new Date(), updatedAt: new Date() }).where(eq(task.id, t.id)),
    );
    await appendEvent({
      clientId: input.clientId, workitemId: input.workitemId, source: "ado", type: "ado.synced",
      actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
      links: [{ rel: "ado_workitem", ref: String(adoId) }, { rel: "task", ref: t.id }],
      payload: { direction: "to_ado", adoId, operation: parentAdoId ? "create_link" : "create_workitem", url },
    });
    res.created++;
    res.items.push({ taskId: t.id, seq: t.seq, adoId, adoType, url });
  }

  // predecessor links between the created items (ordering, not hierarchy)
  for (const d of deps) {
    const from = adoIdOf.get(d.taskId);
    const to = adoIdOf.get(d.dependsOnTaskId);
    if (!from || !to || from === to) continue;
    const r = await adoSend({
      base: projBase, apiPath: `wit/workitems/${from}`, method: "PATCH",
      body: [{ op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Dependency-Reverse", url: `${orgUrl}/_apis/wit/workItems/${to}` } }],
      pat: conn.secretRef,
    });
    if (r.ok) res.links++;
  }

  await regenerateBrief(input.clientId, input.workitemId);
  res.detail = `הוקמו ${res.created} פריטים ב-TFS · ${res.links} קישורי תלות${res.skipped ? ` · ${res.skipped} היו מסונכרנים` : ""}`;
  return res;
}

/** Approved tasks that have not been pushed to TFS yet. */
export async function pendingMaterializeCount(clientId: string, workitemId: string): Promise<number> {
  const [row] = await withTenant(clientId, (tx) =>
    tx.select({ n: sql<number>`count(*)::int` }).from(task)
      .where(and(eq(task.workitemId, workitemId), isNotNull(task.approvedAt), isNull(task.linkedAdoId), sql`${task.state} <> 'dropped'`)),
  );
  return row?.n ?? 0;
}
