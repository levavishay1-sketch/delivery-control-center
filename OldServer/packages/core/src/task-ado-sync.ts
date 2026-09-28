import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { appendEvent, db, withTenant } from "@dcc/db";
import { client, task, taskDependency, workitem } from "@dcc/db/schema";
import { adoSend } from "./ado-http.ts";
import { activeAdoConnection, adoWorkItemUrl } from "./ado-sync.ts";
import { regenerateBrief } from "./brief/generate.ts";
import { structuralTypes } from "./task-types.ts";

/**
 * TASKS are what lives in TFS — a requirement is a DCC-only pre-stage and
 * is never pushed (architecture correction: the requirement is shaping,
 * the tasks are the tracked work).
 *
 * On approval the task tree is materialised top-down: each "task"-kind
 * node becomes a work item whose TYPE is the role it plays in the tree — a
 * leaf is a Task, what holds Tasks is a User Story, what holds Stories a
 * Feature, what holds Features an Epic (task-types.ts) — wired to its parent
 * with Hierarchy-Reverse and to its predecessors with Dependency-Reverse.
 * The requirement itself is not written here: where it should be the Feature
 * over several User Stories is shown on the map, and putting it into TFS is a
 * separate, deliberate step.
 *
 * "check"-kind nodes (verification / regression / documentation the
 * parent task needs before it's done) never become their own work item —
 * they are folded into the parent's Discussion (System.History) as a
 * checklist once the parent exists in TFS.
 */

export type MaterializeResult = {
  created: number;
  skipped: number;
  links: number;
  checksPosted: number;
  items: { taskId: string; seq: number; adoId: number; adoType: string; url: string }[];
  detail: string;
};

type TaskRow = {
  id: string; seq: number; kind: string; intent: string; prompt: string | null; adoType: string | null;
  parentTaskId: string | null; linkedAdoId: number | null; adoUrl: string | null;
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
        id: task.id, seq: task.seq, kind: task.kind, intent: task.intent, prompt: task.prompt, adoType: task.adoType,
        parentTaskId: task.parentTaskId, linkedAdoId: task.linkedAdoId, adoUrl: task.adoUrl,
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
  const tasksOnly = rows.filter((r) => r.kind !== "check");
  const ordered = [...tasksOnly].sort((a, b) => levelOf(a.id, byId) - levelOf(b.id, byId) || a.seq - b.seq);

  // What a task is in TFS follows the role it plays in the tree (task-types.ts); one already in TFS keeps its type.
  const types = structuralTypes(tasksOnly.map((r) => ({ id: r.id, parentId: r.parentTaskId })));
  const res: MaterializeResult = { created: 0, skipped: 0, links: 0, checksPosted: 0, items: [], detail: "" };
  const adoIdOf = new Map<string, number>(rows.filter((r) => r.linkedAdoId).map((r) => [r.id, r.linkedAdoId!]));
  const adoUrlOf = new Map<string, string>(rows.filter((r) => r.linkedAdoId && r.adoUrl).map((r) => [r.id, r.adoUrl!]));

  for (const t of ordered) {
    if (t.linkedAdoId) { res.skipped++; continue; }
    const adoType = types.get(t.id) ?? t.adoType ?? "Task";
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
    adoUrlOf.set(t.id, url);
    await withTenant(input.clientId, (tx) =>
      tx.update(task).set({ linkedAdoId: adoId, adoUrl: url, adoType, adoSyncedAt: new Date(), updatedAt: new Date() }).where(eq(task.id, t.id)),
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

  // "check" nodes never get their own work item — approved, unposted ones
  // are folded into their parent task's Discussion as a checklist.
  const checksByParent = new Map<string, TaskRow[]>();
  for (const c of rows) {
    if (c.kind !== "check" || c.linkedAdoId || !c.parentTaskId) continue;
    (checksByParent.get(c.parentTaskId) ?? checksByParent.set(c.parentTaskId, []).get(c.parentTaskId)!).push(c);
  }
  for (const [parentTaskId, checks] of checksByParent) {
    const parentAdoId = adoIdOf.get(parentTaskId);
    if (!parentAdoId) continue; // parent itself not (yet) in TFS
    const lines = [
      "רשימת בדיקה להשלמת המשימה (מ-DCC):",
      ...checks.sort((a, b) => a.seq - b.seq).map((c) => `☐ ${c.intent}${c.prompt && c.prompt !== c.intent ? ` — ${c.prompt}` : ""}`),
    ];
    const r = await adoSend({
      base: projBase, apiPath: `wit/workitems/${parentAdoId}`, method: "PATCH",
      body: [{ op: "add", path: "/fields/System.History", value: lines.join("<br>") }],
      pat: conn.secretRef,
    });
    if (!r.ok) continue; // best-effort — the checklist still shows in DCC either way
    const parentUrl = adoUrlOf.get(parentTaskId) ?? adoWorkItemUrl(orgUrl, project, parentAdoId);
    for (const c of checks) {
      await withTenant(input.clientId, (tx) =>
        tx.update(task).set({ linkedAdoId: parentAdoId, adoUrl: parentUrl, adoSyncedAt: new Date(), updatedAt: new Date() }).where(eq(task.id, c.id)),
      );
      await appendEvent({
        clientId: input.clientId, workitemId: input.workitemId, source: "ado", type: "ado.synced",
        actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
        links: [{ rel: "ado_workitem", ref: String(parentAdoId) }, { rel: "task", ref: c.id }],
        payload: { direction: "to_ado", adoId: parentAdoId, operation: "reconcile", url: parentUrl },
      });
      res.checksPosted++;
    }
  }

  await regenerateBrief(input.clientId, input.workitemId);
  res.detail = `הוקמו ${res.created} משימות ב-TFS · ${res.links} קישורי תלות`
    + (res.checksPosted ? ` · ${res.checksPosted} בדיקות תועדו ב-Discussion` : "")
    + (res.skipped ? ` · ${res.skipped} כבר היו מסונכרנות` : "");
  return res;
}

export type EditTaskResult = { updated: boolean; adoSynced: boolean };

/**
 * Edit a task's content at any state — before OR after it's been approved,
 * materialized to TFS, or implemented. The caller (the UI) is the one who
 * decides whether the edit is "just wording" or "the scope actually
 * changed" (`scopeChanged`) — we don't try to infer that from a text diff;
 * we just record it plainly and, when it's linked to TFS already, mirror
 * the title there and leave a Discussion note so anyone looking at the
 * work item sees the scope-change flag too, not only DCC.
 */
export async function editTask(input: {
  clientId: string; taskId: string; by: { userId: string };
  patch: { intent?: string; prompt?: string; appetite?: "small" | "standard" | "large" };
  scopeChanged: boolean;
}): Promise<EditTaskResult> {
  const before = await withTenant(input.clientId, async (tx) => {
    const [row] = await tx.select().from(task).where(eq(task.id, input.taskId)).limit(1);
    return row;
  });
  if (!before) throw new Error("משימה לא נמצאה");

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.patch.intent !== undefined && input.patch.intent.trim()) set.intent = input.patch.intent.trim();
  if (input.patch.appetite !== undefined) set.appetite = input.patch.appetite;
  if (input.patch.prompt !== undefined) set.prompt = input.patch.prompt.trim() || null;
  if (Object.keys(set).length === 1) return { updated: false, adoSynced: false };

  await withTenant(input.clientId, (tx) => tx.update(task).set(set).where(eq(task.id, input.taskId)));

  const titleChanged = typeof set.intent === "string" && set.intent !== before.intent;
  let adoSynced = false;
  if (before.linkedAdoId && before.kind !== "check" && titleChanged) {
    const conn = await activeAdoConnection(input.clientId);
    if (conn) {
      const orgUrl = (conn.config.orgUrl ?? "").replace(/\/+$/, "");
      const project = conn.config.project ?? "";
      if (project) {
        const projBase = `${orgUrl}/${encodeURIComponent(project)}`;
        const r = await adoSend({
          base: projBase, apiPath: `wit/workitems/${before.linkedAdoId}`, method: "PATCH",
          body: [{ op: "add", path: "/fields/System.Title", value: (set.intent as string).slice(0, 250) }],
          pat: conn.secretRef,
        });
        adoSynced = r.ok;
      }
    }
  }

  const noteLines = [
    `✎ משימה #${before.seq} נערכה על ידי משתמש.`,
    input.scopeChanged
      ? "⚠ סומן כשינוי בהיקף העבודה — מומלץ לבדוק מחדש תלויות/בדיקות תחת המשימה."
      : "עדכון ניסוח/תוכן בלבד, ללא שינוי בהיקף.",
    adoSynced ? "כותרת ה-work item ב-TFS סונכרנה בהתאם." : "",
  ].filter(Boolean);
  await appendEvent({
    clientId: input.clientId, workitemId: before.workitemId, source: "manual", type: "note.added",
    actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
    links: [{ rel: "task", ref: input.taskId }],
    payload: { body: noteLines.join("\n") },
  });
  await regenerateBrief(input.clientId, before.workitemId);

  return { updated: true, adoSynced };
}

/** Approved tasks that have not been pushed to TFS yet. */
export async function pendingMaterializeCount(clientId: string, workitemId: string): Promise<number> {
  const [row] = await withTenant(clientId, (tx) =>
    tx.select({ n: sql<number>`count(*)::int` }).from(task)
      .where(and(eq(task.workitemId, workitemId), isNotNull(task.approvedAt), isNull(task.linkedAdoId), sql`${task.state} <> 'dropped'`)),
  );
  return row?.n ?? 0;
}
