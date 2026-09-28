import { and, eq, sql } from "drizzle-orm";
import { db as dbAny, withTenant, withoutTenant, appendEvent } from "@dcc/db";
import { task, taskDependency, workitem } from "@dcc/db/schema";
import { regenerateBrief } from "./brief/generate.ts";
import { activeAdoConnection } from "./ado-sync.ts";
import { adoGet, adoSend } from "./ado-http.ts";
import { TASK_STATE_TO_ADO_STATE } from "./ado-map.ts";
import { recordDecision } from "./decisions.ts";
import { storedStateAfterChecks } from "./task-status.ts";
import { taskRelations, type DepVia } from "./task-relations.ts";

/**
 * Task decomposition (architecture §5). The contract is
 * { intent, acceptance (Given/When/Then), appetite, dependencies }.
 * OpenSpec is the X behind this Y — the `task-breakdown` skill runs
 * OpenSpec to produce spec → plan → tasks, then registers the result
 * here so it lands on the timeline and the Context Brief.
 */

export type TaskInput = {
  intent: string;
  acceptance: { given: string; when: string; then: string }[];
  appetite?: "small" | "standard" | "large";
  /** indices (into this same array) of tasks this one depends on */
  dependsOn?: number[];
  /** why the dependency exists — links back to a Requirement/Gap */
  dependencyReason?: string;
};

/** Thrown by `progressTask(..., { to: "done" })` when checks are still
 *  unresolved and no override was given. A plain `Error` gets flattened
 *  to an opaque 500 by the API's default error handler — this needs its
 *  own class so the route can catch it and hand the real message (and
 *  which checks) back to the UI. */
export class ChecksNotPassed extends Error {
  constructor(message: string, public unresolved: { id: string; seq: number; intent: string }[]) { super(message); }
}

const dominant = (xs: (string | undefined)[]): "small" | "standard" | "large" => {
  if (xs.includes("large")) return "large";
  if (xs.includes("standard")) return "standard";
  return "small";
};

export async function proposeTasks(input: {
  clientId: string;
  workitemId: string;
  by: { userId: string };
  tasks: TaskInput[];
  openspecChangeId?: string;
}) {
  if (input.tasks.length === 0) throw new Error("no tasks");

  return withTenant(input.clientId, async (tx) => {
    const [wi] = await tx.select({ id: workitem.id }).from(workitem).where(sql`${workitem.id} = ${input.workitemId}`).limit(1);
    if (!wi) throw new Error("workitem not found");

    const startSeq =
      (await tx.select({ n: sql<number>`coalesce(max(${task.seq}), 0)::int` }).from(task).where(sql`${task.workitemId} = ${input.workitemId}`))[0]!.n;

    const ids: string[] = [];
    for (const [i, t] of input.tasks.entries()) {
      const [row] = await tx
        .insert(task)
        .values({
          clientId: input.clientId,
          workitemId: input.workitemId,
          seq: startSeq + i + 1,
          intent: t.intent,
          acceptance: t.acceptance,
          appetite: t.appetite ?? "standard",
          openspecChangeId: input.openspecChangeId ?? null,
        })
        .returning({ id: task.id });
      ids.push(row!.id);
    }

    let depCount = 0;
    for (const [i, t] of input.tasks.entries()) {
      for (const dep of t.dependsOn ?? []) {
        if (dep < 0 || dep >= ids.length || dep === i) continue;
        await tx.insert(taskDependency).values({
          clientId: input.clientId,
          taskId: ids[i]!,
          dependsOnTaskId: ids[dep]!,
          reason: t.dependencyReason ?? null,
        });
        depCount++;
      }
    }

    await appendEvent({
      clientId: input.clientId,
      workitemId: input.workitemId,
      source: "claude_session",
      type: "tasks.proposed",
      actor: { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "skill:task-breakdown" },
      links: ids.map((id) => ({ rel: "task" as const, ref: id })),
      payload: {
        openspecChangeId: input.openspecChangeId,
        taskCount: ids.length,
        dependencyCount: depCount,
        appetite: dominant(input.tasks.map((t) => t.appetite)),
      },
    });

    await regenerateBrief(input.clientId, input.workitemId);
    return { taskIds: ids, dependencyCount: depCount };
  });
}

export async function progressTask(input: {
  clientId: string;
  taskId: string;
  by: { userId: string };
  mode: "delegated" | "interactive";
  to: "pending" | "in_progress" | "blocked" | "failed_checks" | "done" | "dropped";
  /** Explicit human override to mark done despite a check that hasn't
   *  passed — the only way past the gate below. Recorded on the checks
   *  themselves, not just accepted silently. */
  overrideChecks?: boolean;
  /** Why override — a course-changing decision, captured via
   *  `recordDecision` (design notes, `decision-history`). Optional so
   *  callers that predate this still work, but the UI always asks. */
  overrideReason?: string;
  /** Why a `done` task is moving to any other state — a reopen. Same
   *  capture pattern as `overrideReason`. */
  reopenReason?: string;
}) {
  // A dependent task is closed only after what it depends on is done and its checks ran on top of it.
  // Read before the transaction: it reads git and every task of the requirement. (Imported here, not at
  // the top: ai-assist.ts imports this module.)
  const depBlockers = input.to === "done" ? await (await import("./ai-assist.ts")).taskDoneBlockers(input.clientId, input.taskId) : [];
  const out = await withTenant(input.clientId, async (tx) => {
    const [t] = await tx.select().from(task).where(sql`${task.id} = ${input.taskId}`).limit(1);
    if (!t) throw new Error("task not found");
    const from = t.state;

    if (from === "done" && input.to !== "done" && input.reopenReason?.trim()) {
      await recordDecision({
        clientId: input.clientId, workitemId: t.workitemId, by: input.by,
        trigger: "task_reopened", reason: input.reopenReason,
        links: [{ rel: "task", ref: input.taskId }],
      });
    }

    if (input.to === "done") {
      const unresolved = await tx.select({ id: task.id, seq: task.seq, intent: task.intent, checkResult: task.checkResult }).from(task)
        .where(and(eq(task.parentTaskId, input.taskId), eq(task.kind, "check"), eq(task.active, true), sql`${task.state} <> 'dropped'`, sql`${task.checkResult} is distinct from 'passed'`));
      if ((unresolved.length > 0 || depBlockers.length > 0) && !input.overrideChecks) {
        const waiting = unresolved.filter((u) => u.checkResult === "waiting");
        const notPassed = unresolved.filter((u) => u.checkResult !== "waiting");
        throw new ChecksNotPassed(
          `אי אפשר לסמן כהושלם — ${[
            notPassed.length ? `${notPassed.length} בדיקות לא עברו: ${notPassed.map((u) => `#${u.seq}`).join(", ")}` : "",
            waiting.length ? `${waiting.length} בדיקות מחכות לתלות שעוד לא פותחה: ${waiting.map((u) => `#${u.seq}`).join(", ")}` : "",
            ...depBlockers,
          ].filter(Boolean).join("; ")}`,
          unresolved,
        );
      }
      if (depBlockers.length > 0 && input.overrideChecks && unresolved.length === 0 && input.overrideReason?.trim()) {
        // Closed before its dependency was done — a decision, recorded with its reason.
        await recordDecision({
          clientId: input.clientId, workitemId: t.workitemId, by: input.by,
          trigger: "task_closed_override", reason: `${input.overrideReason} (נסגרה למרות: ${depBlockers.join("; ")})`,
          links: [{ rel: "task", ref: input.taskId }],
        });
      }
      if (unresolved.length > 0 && input.overrideChecks) {
        const now = new Date();
        await tx.update(task).set({ checkResolvedBy: input.by.userId, checkResolvedAt: now, updatedAt: now })
          .where(sql`${task.id} in ${unresolved.map((u) => u.id)}`);
        if (input.overrideReason?.trim()) {
          await recordDecision({
            clientId: input.clientId, workitemId: t.workitemId, by: input.by,
            trigger: "task_closed_override", reason: input.overrideReason,
            links: [{ rel: "task", ref: input.taskId }],
          });
        }
      }
    }

    await tx.update(task).set({ state: input.to, updatedAt: new Date() }).where(sql`${task.id} = ${input.taskId}`);

    await appendEvent({
      clientId: input.clientId,
      workitemId: t.workitemId,
      source: input.mode === "delegated" ? "claude_session" : "manual",
      type: "task.progressed",
      actor:
        input.mode === "delegated"
          ? { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "session" }
          : { kind: "user", userId: input.by.userId, identityType: "interactive" },
      links: [{ rel: "task", ref: input.taskId }],
      payload: { taskId: input.taskId, from, to: input.to, intent: t.intent },
    });

    await regenerateBrief(input.clientId, t.workitemId);
    return { taskId: input.taskId, from, to: input.to };
  });
  // The run it was closed on went through review — the task's steps draw it that way.
  if (input.to === "done") await (await import("./ai-assist.ts")).markLatestRun(input.taskId, { closedAt: new Date().toISOString() });
  return out;
}

/**
 * Re-evaluates a task's own stored `state` from its active checks, after
 * anything that could have changed which checks count or what they
 * reported: a check's active/inactive toggle, or a check finishing — on
 * its own or in a run (`runImplement`'s per-check write only ever touches
 * the check's own row, never its task, so without this call the task's
 * state goes stale). The rule is `storedStateAfterChecks`: failed_checks
 * only while a check actually failed — never for one that has not run yet.
 */
export async function syncTaskStateAfterCheckChange(clientId: string, parentTaskId: string) {
  return withTenant(clientId, async (tx) => {
    const [parent] = await tx.select().from(task).where(sql`${task.id} = ${parentTaskId}`).limit(1);
    if (!parent || parent.kind === "check") return;
    const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(task).where(
      and(eq(task.parentTaskId, parentTaskId), eq(task.kind, "check"), eq(task.active, true), sql`${task.state} <> 'dropped'`, eq(task.checkResult, "failed")),
    );
    const next = storedStateAfterChecks(parent.state, parent.wasDone, row?.n ?? 0);
    if (next) await tx.update(task).set({ state: next.state as typeof parent.state, wasDone: next.wasDone, updatedAt: new Date() }).where(eq(task.id, parentTaskId));
  });
}

/**
 * Once, at startup: every task's stored state brought to that same rule — the
 * ones an earlier rule left in failed_checks with nothing failed (a build that
 * failed and then passed on a rerun, its other checks not run yet). One query
 * and nothing to do after the first time.
 */
export async function resyncTaskStates(): Promise<number> {
  const rows = await withoutTenant((tx) => tx.select({ id: task.id, clientId: task.clientId }).from(task).where(sql`${task.kind} = 'task' and ${task.state} = 'failed_checks'
      and not exists (select 1 from task c where c.parent_task_id = ${task.id} and c.kind = 'check' and c.active = true and c.state <> 'dropped' and c.check_result = 'failed')`));
  for (const r of rows) await syncTaskStateAfterCheckChange(r.clientId, r.id);
  return rows.length;
}

/** Best-effort mirror of a DCC-side active/inactive toggle to the real
 *  TFS work item's `System.State`. Deactivating sends `"Removed"` — a
 *  real, first-class ADO state category (verified live against the
 *  connected server for Task/User Story/Feature/Epic, not a guess or a
 *  custom field); reactivating restores whatever state the task's own
 *  DCC `state` maps to (`TASK_STATE_TO_ADO_STATE`). Never throws — a
 *  DCC-side toggle must never be blocked by ADO being unreachable, same
 *  as every other ADO write in this codebase. */
async function syncTaskActiveToAdo(clientId: string, linkedAdoId: number, active: boolean, dccState: string): Promise<void> {
  try {
    const conn = await activeAdoConnection(clientId);
    if (!conn) return;
    const orgUrl = (conn.config.orgUrl ?? "").replace(/\/+$/, "");
    const project = conn.config.project ?? "";
    if (!project) return;
    const projBase = `${orgUrl}/${encodeURIComponent(project)}`;
    const wantState = active ? (TASK_STATE_TO_ADO_STATE[dccState] ?? "New") : "Removed";
    await adoSend({
      base: projBase, apiPath: `wit/workitems/${linkedAdoId}`, method: "PATCH",
      body: [{ op: "add", path: "/fields/System.State", value: wantState }],
      pat: conn.secretRef,
    });
  } catch { /* best-effort — DCC's own toggle already committed */ }
}

/** Toggle a task or check in or out of play. Deactivating drops it from
 *  the Flow graph's edges, from dependency computation, from the next
 *  preview/run of a parent's prompt, and from the completion gate — but
 *  keeps its row and history, and still renders (greyed) everywhere it
 *  already did. Reactivating a check clears its prior result (needs
 *  fresh verification); reactivating a task does not touch its
 *  children — they may have been deactivated for their own reasons.
 *
 *  Deactivating CASCADES to every descendant (a child under a removed
 *  task can't stand alone); reactivating touches only this one row.
 *  When the row (or a cascaded check) has a parent task, that parent's
 *  own completion status is re-evaluated. When the row itself is a
 *  TFS-linked task, the real work item's `System.State` is mirrored
 *  (best-effort, non-blocking). */
export async function setTaskActive(clientId: string, taskId: string, active: boolean, by: { userId: string }) {
  const { row, descendantCount } = await withTenant(clientId, async (tx) => {
    const [t] = await tx.select().from(task).where(sql`${task.id} = ${taskId}`).limit(1);
    if (!t) throw new Error("task not found");
    const set: Record<string, unknown> = { active, updatedAt: new Date() };
    if (active && t.kind === "check") Object.assign(set, { checkResult: null, checkResolvedBy: null, checkResolvedAt: null });
    await tx.update(task).set(set).where(eq(task.id, taskId));

    let descendantCount = 0;
    if (!active) {
      const ids: string[] = [];
      const queue = [taskId];
      while (queue.length) {
        const cur = queue.shift()!;
        const kids = await tx.select({ id: task.id }).from(task).where(eq(task.parentTaskId, cur));
        for (const k of kids) { ids.push(k.id); queue.push(k.id); }
      }
      if (ids.length) {
        await tx.update(task).set({ active: false, updatedAt: new Date() }).where(sql`${task.id} in ${ids}`);
        descendantCount = ids.length;
      }
    }
    return { row: t, descendantCount };
  });

  if (row.kind === "check" && row.parentTaskId) await syncTaskStateAfterCheckChange(clientId, row.parentTaskId);
  if (row.kind === "task" && row.linkedAdoId) await syncTaskActiveToAdo(clientId, row.linkedAdoId, active, row.state);

  const label = row.kind === "check" ? "בדיקה" : "משימה";
  await appendEvent({
    clientId, workitemId: row.workitemId,
    source: "manual", type: "note.added",
    actor: { kind: "user", userId: by.userId, identityType: "interactive" },
    links: [{ rel: "task", ref: taskId }],
    payload: {
      body: active
        ? `${label} #${row.seq} הופעלה מחדש${row.kind === "check" ? " — זקוקה לאימות חדש" : ""}.`
        : `${label} #${row.seq} הושבתה${descendantCount ? ` (וכן ${descendantCount} תת-פריטים תחתיה)` : ""} — לא תופיע ב-Flow/תלויות, ${row.kind === "task" && row.linkedAdoId ? "עודכנה ב-TFS ל-Removed, " : ""}ההיסטוריה נשארת.`,
    },
  });
  await regenerateBrief(clientId, row.workitemId);
  return { active };
}

/** On-demand TFS → DCC pull: reads the linked work item's live
 *  `System.State`; if it reads `"Removed"` and DCC still shows the task
 *  active, syncs DCC down through the same path a DCC-initiated
 *  deactivate takes (cascade included), logged as system-detected. No
 *  poller or webhook exists in this codebase — this is the "someone
 *  looked" trigger, not a background job. */
export async function checkAdoRemovedState(clientId: string, taskId: string, by: { userId: string }): Promise<{ checked: boolean; changed: boolean; adoState?: string }> {
  const [row] = await withTenant(clientId, (tx) =>
    tx.select({ linkedAdoId: task.linkedAdoId, active: task.active, kind: task.kind }).from(task).where(eq(task.id, taskId)).limit(1),
  );
  if (!row?.linkedAdoId || row.kind === "check") return { checked: false, changed: false };
  const conn = await activeAdoConnection(clientId);
  if (!conn) return { checked: false, changed: false };
  const orgUrl = (conn.config.orgUrl ?? "").replace(/\/+$/, "");
  const project = conn.config.project ?? "";
  if (!project) return { checked: false, changed: false };
  const projBase = `${orgUrl}/${encodeURIComponent(project)}`;
  const r = await adoGet(projBase, `wit/workitems/${row.linkedAdoId}`, conn.secretRef);
  if (!r.ok) return { checked: false, changed: false };
  const fields = (r.body as { fields?: Record<string, unknown> } | null)?.fields ?? {};
  const adoState = String(fields["System.State"] ?? "");
  if (adoState === "Removed" && row.active) {
    await setTaskActive(clientId, taskId, false, by);
    return { checked: true, changed: true, adoState };
  }
  return { checked: true, changed: false, adoState };
}

export async function tasksFor(clientId: string, workitemId: string) {
  return withTenant(clientId, async (tx) => {
    const rows = await tx.select().from(task).where(sql`${task.workitemId} = ${workitemId}`).orderBy(task.seq);
    const deps = await tx
      .select()
      .from(taskDependency)
      .where(sql`${taskDependency.taskId} in (select id from ${task} where ${task.workitemId} = ${workitemId})`);
    return { tasks: rows, dependencies: deps };
  });
}

/* ── one task, with everything the task screen needs ───────────────── */

export type TaskDetail = {
  task: typeof task.$inferSelect;
  requirement: { id: string; key: string | null; title: string; phase: string; clientId: string };
  parent: { id: string; seq: number; intent: string; adoType: string | null } | null;
  children: { id: string; seq: number; intent: string; adoType: string | null; kind: string; state: string; linkedAdoId: number | null; checkResult: string | null; checkResolvedBy: string | null; active: boolean; checkKind: string | null }[];
  /** The developed tasks this one waits for (task-relations.ts) — through a group, a check or its own group too, as `via` says. */
  blockedBy: { id: string; seq: number; intent: string; state: string; kind: string; linkedAdoId: number | null; via?: DepVia }[];
  /** Rows that wait for this one — tasks, or a group's check. */
  blocks: { id: string; seq: number; intent: string; state: string; kind: string }[];
  /** A task with sub-tasks: its work is theirs, it is never developed itself. */
  isGroup: boolean;
  repos: { id: string; name: string; adoRepoRef: string | null }[];
};

export async function taskDetail(clientId: string, taskId: string): Promise<TaskDetail> {
  return withTenant(clientId, async (tx) => {
    const [t] = await tx.select().from(task).where(sql`${task.id} = ${taskId}`).limit(1);
    if (!t) throw new Error("task not found");
    const [wi] = await tx
      .select({ id: workitem.id, key: workitem.key, title: workitem.title, phase: workitem.phase, clientId: workitem.clientId })
      .from(workitem).where(sql`${workitem.id} = ${t.workitemId}`).limit(1);

    const slim = { id: task.id, seq: task.seq, intent: task.intent, adoType: task.adoType, kind: task.kind, state: task.state, linkedAdoId: task.linkedAdoId, checkResult: task.checkResult, checkResolvedBy: task.checkResolvedBy, active: task.active, approvedAt: task.approvedAt, checkKind: task.checkKind };
    const parent = t.parentTaskId
      ? (await tx.select(slim).from(task).where(sql`${task.id} = ${t.parentTaskId}`).limit(1))[0] ?? null
      : null;
    const children = await tx.select(slim).from(task).where(sql`${task.parentTaskId} = ${taskId} and ${task.state} <> 'dropped'`).orderBy(task.seq);

    // The same relations the status and the branch base are decided by (task-relations.ts):
    // dropped and inactive rows are not there; a group stands for its sub-tasks, a check for its task.
    const rows = await tx.select({ ...slim, parentTaskId: task.parentTaskId }).from(task).where(sql`${task.workitemId} = ${t.workitemId}`);
    const deps = await tx.select({ taskId: taskDependency.taskId, dependsOnTaskId: taskDependency.dependsOnTaskId }).from(taskDependency)
      .where(sql`${taskDependency.taskId} in (select id from task where workitem_id = ${t.workitemId})`);
    const rel = taskRelations(rows, deps);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const blockedBy = rel.effectiveDeps(taskId).map((d) => ({ ...byId.get(d.id)!, ...(d.via ? { via: d.via } : {}) })).sort((a, b) => a.seq - b.seq);
    const blocks = rel.waitingOn(taskId).map((id) => byId.get(id)!).sort((a, b) => a.seq - b.seq);

    const repos = await tx
      .select({ id: sql<string>`r.id`, name: sql<string>`r.name`, adoRepoRef: sql<string | null>`r.ado_repo_ref` })
      .from(sql`workitem_repo wr join repo r on r.id = wr.repo_id`)
      .where(sql`wr.workitem_id = ${t.workitemId}`);

    return {
      task: t,
      requirement: wi ?? { id: t.workitemId, key: null, title: "", phase: "", clientId },
      parent: parent ? { id: parent.id, seq: parent.seq, intent: parent.intent, adoType: parent.adoType } : null,
      children, blockedBy, blocks, isGroup: rel.isGroup(taskId),
      repos: repos as { id: string; name: string; adoRepoRef: string | null }[],
    };
  });
}

/** Which client owns a task — the API needs it before a tenant-scoped read. */
export async function clientOfTask(taskId: string): Promise<string | null> {
  const [row] = await dbAny.select({ c: task.clientId }).from(task).where(sql`${task.id} = ${taskId}`).limit(1);
  return row?.c ?? null;
}
