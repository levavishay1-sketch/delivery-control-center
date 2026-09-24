import { sql } from "drizzle-orm";
import { db, withTenant, appendEvent } from "@dcc/db";
import { client, gap, task, taskDependency, workitem, workitemDependency } from "@dcc/db/schema";
import { regenerateBrief } from "./brief/generate.ts";
import { taskRelations } from "./task-relations.ts";
import { requirementRung, structuralTypes } from "./task-types.ts";

/**
 * WorkItem-level dependencies and the project Flow graph (architecture
 * §15). A dependency is also meant to be written to ADO as a native
 * predecessor/successor link — `adoLinkSyncedAt` tracks that; the sync
 * itself is a later slice.
 */

export async function linkWorkItems(input: {
  clientId: string;
  workitemId: string;
  dependsOnWorkitemId: string;
  by: { userId: string };
  kind?: "predecessor" | "parent" | "related";
  reason?: string;
  originGapId?: string;
}) {
  if (input.workitemId === input.dependsOnWorkitemId) throw new Error("a WorkItem cannot depend on itself");
  return withTenant(input.clientId, async (tx) => {
    await tx
      .insert(workitemDependency)
      .values({
        clientId: input.clientId,
        workitemId: input.workitemId,
        dependsOnWorkitemId: input.dependsOnWorkitemId,
        kind: input.kind ?? "predecessor",
        reason: input.reason ?? null,
        originGapId: input.originGapId ?? null,
      })
      .onConflictDoNothing();

    await appendEvent({
      clientId: input.clientId,
      workitemId: input.workitemId,
      source: "manual",
      type: "status.changed",
      actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
      links: [{ rel: "ado_workitem", ref: input.dependsOnWorkitemId }],
      payload: { from: "no dependency", to: `depends on ${input.dependsOnWorkitemId}`, viaAdo: false },
    });
    await regenerateBrief(input.clientId, input.workitemId);
  });
}

export type FlowNode = {
  id: string;
  key: string | null;
  title: string;
  phase: string;
  type: string;
  parentId: string | null;
  openBlockingGaps: number;
  openBlockers: number;
  linkedAdoId: number | null;
  adoUrl: string | null;
};
export type FlowEdge = {
  from: string;
  to: string;
  kind: "predecessor" | "parent" | "related" | "spun_off";
  reason: string | null;
  adoSynced: boolean;
};

/**
 * Nodes + edges for a Flow view rooted at one requirement: the root and
 * its whole subtree (parent_id chain), plus their dependency edges.
 */
export async function flowFor(clientId: string, rootId: string): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }> {
  return withTenant(clientId, async (tx) => {
    const subtree = await tx.execute<{ id: string }>(sql`
      with recursive tree as (
        select id from workitem where id = ${rootId}
        union all
        select w.id from workitem w join tree t on w.parent_id = t.id
      )
      select id from tree
    `);
    const treeIds = (subtree.rows ?? subtree).map((r: { id: string }) => r.id);
    if (treeIds.length === 0) return { nodes: [], edges: [] };
    const witems = await tx
      .select()
      .from(workitem)
      .where(sql`${workitem.id} in ${treeIds} and ${workitem.phase} <> 'archived'`);
    const ids = witems.map((w) => w.id);
    if (ids.length === 0) return { nodes: [], edges: [] };

    const gapAgg = await tx
      .select({
        wi: gap.workitemId,
        blockingOpen: sql<number>`count(*) filter (where ${gap.blocking} and ${gap.state} in ('proposed','verified'))::int`,
      })
      .from(gap)
      .where(sql`${gap.workitemId} in ${ids}`)
      .groupBy(gap.workitemId);
    const blkAgg = await tx.execute<{ workitem_id: string; open: number }>(
      sql`select workitem_id, count(*)::int as open from blocker where workitem_id in ${ids} and state = 'open' group by workitem_id`,
    );
    const gapMap = new Map(gapAgg.map((g) => [g.wi, g.blockingOpen]));
    const blkMap = new Map((blkAgg.rows ?? blkAgg).map((r: { workitem_id: string; open: number }) => [r.workitem_id, r.open]));

    const nodes: FlowNode[] = wims2nodes(witems, gapMap, blkMap);

    const deps = await tx.select().from(workitemDependency).where(sql`${workitemDependency.workitemId} in ${ids}`);
    const spun = await tx
      .select({ from: gap.workitemId, to: gap.spunOffTo, reason: gap.description })
      .from(gap)
      .where(sql`${gap.spunOffTo} is not null and ${gap.workitemId} in ${ids}`);

    const idSet = new Set(ids);
    const edges: FlowEdge[] = [
      // parent → child structure
      ...witems
        .filter((w) => w.parentId && idSet.has(w.parentId))
        .map((w) => ({ from: w.parentId!, to: w.id, kind: "parent" as const, reason: null, adoSynced: false })),
      ...deps.map((d) => ({
        from: d.workitemId,
        to: d.dependsOnWorkitemId,
        kind: d.kind as FlowEdge["kind"],
        reason: d.reason,
        adoSynced: d.adoLinkSyncedAt != null,
      })),
      ...spun
        .filter((s): s is { from: string; to: string; reason: string } => s.to != null)
        .map((s) => ({ from: s.from, to: s.to, kind: "spun_off" as const, reason: s.reason, adoSynced: false })),
    ];

    return { nodes, edges };
  });
}

/* ── the task tree of one requirement ──────────────────────────────── */

export type TaskFlowNode = {
  id: string;
  seq: number;
  kind: string;
  intent: string;
  appetite: string;
  state: string;
  adoType: string | null;
  level: number;
  parentTaskId: string | null;
  approved: boolean;
  /** false = deactivated (see setTaskActive) — still rendered (greyed),
   *  but excluded from edges/dependency computation below. */
  active: boolean;
  linkedAdoId: number | null;
  adoUrl: string | null;
  affectedPaths: string[];
  compiledComponents: string[];
  prompt: string | null;
  origin: string;
  approvedAt: string | null;
  adoSyncedAt: string | null;
  /** check-kind children folded into this node (never their own flow node — see the FLOW screen). */
  checks: { id: string; seq: number; intent: string; state: string; checkKind: string | null }[];
  /** It has sub-tasks: a group, never developed and never scheduled (task-relations.ts). */
  isGroup: boolean;
  /** What it really waits for — through a group, a check, or its own group. Empty on a group. */
  dependsOn: string[];
  /** How many rounds of work must finish first. Null on a group, which is not scheduled. */
  stage: number | null;
};
/** The type the requirement itself takes above its top-level tasks — a Feature over several User Stories — or null when it takes none. */
export type RequirementRung = { type: string; over: number; of: string };
export type TaskFlowEdge = { from: string; to: string; kind: "parent" | "depends"; reason: string | null };

/**
 * The proposed/approved task tree for a requirement: hierarchy edges plus
 * dependency edges. `depth` is what picked the TFS types off the ladder.
 */
export async function taskFlowFor(clientId: string, workitemId: string): Promise<{ depth: number; requirementRung: RequirementRung | null; nodes: TaskFlowNode[]; edges: TaskFlowEdge[] }> {
  return withTenant(clientId, async (tx) => {
    const rows = await tx
      .select({
        id: task.id, seq: task.seq, kind: task.kind, intent: task.intent, appetite: task.appetite, state: task.state,
        adoType: task.adoType, parentTaskId: task.parentTaskId, approvedAt: task.approvedAt,
        linkedAdoId: task.linkedAdoId, adoUrl: task.adoUrl, affectedPaths: task.affectedPaths,
        compiledComponents: task.compiledComponents, active: task.active,
        prompt: task.prompt, origin: task.origin, adoSyncedAt: task.adoSyncedAt, checkKind: task.checkKind,
      })
      .from(task)
      .where(sql`${task.workitemId} = ${workitemId} and ${task.state} <> 'dropped'`)
      .orderBy(task.seq);
    if (rows.length === 0) return { depth: 0, requirementRung: null, nodes: [], edges: [] };

    const byId = new Map(rows.map((r) => [r.id, r]));
    const level = (id: string, seen = new Set<string>()): number => {
      const t = byId.get(id);
      if (!t?.parentTaskId || seen.has(id) || !byId.has(t.parentTaskId)) return 0;
      seen.add(id);
      return level(t.parentTaskId, seen) + 1;
    };
    // depth (→ the ladder) is driven only by "task" nodes — a "check" leaf
    // can sit one level deeper without stretching the ladder.
    const taskLevels = rows.filter((r) => r.kind !== "check").map((r) => level(r.id));
    const depth = Math.max(0, ...taskLevels) + 1;

    // "check" rows never get their own FLOW node (never a TFS item) — they
    // fold into their parent task's card as a checklist instead.
    const checksByParent = new Map<string, TaskFlowNode["checks"]>();
    for (const r of rows) {
      if (r.kind !== "check" || !r.parentTaskId) continue;
      (checksByParent.get(r.parentTaskId) ?? checksByParent.set(r.parentTaskId, []).get(r.parentTaskId)!)
        .push({ id: r.id, seq: r.seq, intent: r.intent, state: r.state, checkKind: r.checkKind });
    }

    const nodes: TaskFlowNode[] = rows.filter((r) => r.kind !== "check").map((r) => ({
      id: r.id, seq: r.seq, kind: r.kind, intent: r.intent, appetite: r.appetite, state: r.state,
      adoType: r.adoType, level: level(r.id), parentTaskId: r.parentTaskId,
      approved: r.approvedAt != null, active: r.active, linkedAdoId: r.linkedAdoId, adoUrl: r.adoUrl,
      affectedPaths: (r.affectedPaths ?? []) as string[], compiledComponents: (r.compiledComponents ?? []) as string[], prompt: r.prompt, origin: r.origin,
      approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
      adoSyncedAt: r.adoSyncedAt ? r.adoSyncedAt.toISOString() : null,
      checks: (checksByParent.get(r.id) ?? []).sort((a, b) => a.seq - b.seq),
      isGroup: false, dependsOn: [], stage: null,
    }));

    // an inactive node still gets a (greyed) card, but never participates
    // in an edge — neither as source nor target — so it can't block or be
    // blocked by anything, and doesn't push a sibling to a later stage.
    const activeIdSet = new Set(nodes.filter((n) => n.active).map((n) => n.id)); // exposed, active nodes only
    const ids = rows.map((r) => r.id);
    const deps = await tx.select().from(taskDependency).where(sql`${taskDependency.taskId} in ${ids}`);
    const edges: TaskFlowEdge[] = [
      ...nodes.filter((n) => n.parentTaskId && activeIdSet.has(n.parentTaskId) && activeIdSet.has(n.id)).map((n) => ({ from: n.parentTaskId!, to: n.id, kind: "parent" as const, reason: null })),
      ...deps.filter((d) => activeIdSet.has(d.dependsOnTaskId) && activeIdSet.has(d.taskId))
        .map((d) => ({ from: d.dependsOnTaskId, to: d.taskId, kind: "depends" as const, reason: d.reason })),
    ];

    /*
     * The schedule, decided once here so every view answers the same way.
     * A GROUP is not scheduled — it is never developed, its sub-tasks are
     * (task-relations.ts), so it gets no stage and no dependency of its own.
     * What a task waits for is its EFFECTIVE dependencies: a dependency on a
     * group means each of its sub-tasks, and a sub-task also waits for
     * whatever its group waits for. Reading the raw edges instead is what
     * put a task one stage too early and drew a group into the columns.
     */
    const rel = taskRelations(
      rows.map((r) => ({ id: r.id, seq: r.seq, kind: r.kind, parentTaskId: r.parentTaskId, active: r.active, state: r.state })),
      deps.map((d) => ({ taskId: d.taskId, dependsOnTaskId: d.dependsOnTaskId })),
    );
    for (const n of nodes) {
      n.isGroup = rel.isGroup(n.id);
      n.dependsOn = n.isGroup ? [] : rel.effectiveDeps(n.id).map((d) => d.id).filter((id) => activeIdSet.has(id));
    }
    const byIdNode = new Map(nodes.map((n) => [n.id, n]));
    const stageOf = (id: string, seen = new Set<string>()): number => {
      const n = byIdNode.get(id);
      if (!n || n.isGroup || seen.has(id)) return 0;
      if (n.stage != null) return n.stage;
      seen.add(id);
      const s = n.dependsOn.length ? Math.max(...n.dependsOn.map((d) => stageOf(d, seen))) + 1 : 0;
      seen.delete(id);
      n.stage = s;
      return s;
    };
    for (const n of nodes) if (!n.isGroup) stageOf(n.id);

    // The TFS type of a task follows the role it plays in the tree (task-types.ts).
    // One that already exists in TFS keeps the type it was created with.
    const work = nodes.filter((n) => n.active).map((n) => ({ id: n.id, parentId: n.parentTaskId }));
    const types = structuralTypes(work);
    for (const n of nodes) if (!n.linkedAdoId) n.adoType = types.get(n.id) ?? n.adoType;

    return { depth, requirementRung: requirementRung(work), nodes, edges };
  });
}

/* ── the client's whole TFS side ───────────────────────────────────── */

export type AdoTaskRow = {
  id: string;
  requirementId: string;
  requirementKey: string | null;
  requirementTitle: string;
  seq: number;
  intent: string;
  appetite: string;
  state: string;
  adoType: string | null;
  linkedAdoId: number | null;
  adoUrl: string | null;
  adoSyncedAt: string | null;
  approved: boolean;
  active: boolean;
  parentTaskId: string | null;
  level: number;
  /** approved verification/regression/doc children folded into this task's
   *  TFS Discussion instead of becoming their own work items. */
  checksCount: number;
  checksPosted: number;
};

/**
 * Every TASK (not "check") of a client, across all its requirements — a
 * true 1:1 mirror of what the client has (or will have) in TFS. Ordered
 * by requirement, then depth-first through the task hierarchy.
 */
export async function clientTaskTree(clientId: string): Promise<{ rows: AdoTaskRow[]; inTfs: number; pending: number }> {
  return withTenant(clientId, async (tx) => {
    const raw = await tx
      .select({
        id: task.id, requirementId: task.workitemId, seq: task.seq, kind: task.kind, intent: task.intent,
        appetite: task.appetite, state: task.state, adoType: task.adoType,
        linkedAdoId: task.linkedAdoId, adoUrl: task.adoUrl, adoSyncedAt: task.adoSyncedAt,
        approvedAt: task.approvedAt, parentTaskId: task.parentTaskId, active: task.active,
        requirementKey: workitem.key, requirementTitle: workitem.title,
      })
      .from(task)
      .innerJoin(workitem, sql`${workitem.id} = ${task.workitemId}`)
      .where(sql`${task.clientId} = ${clientId} and ${task.state} <> 'dropped'`)
      .orderBy(sql`${workitem.createdAt}, ${task.seq}`);

    const byId = new Map(raw.map((r) => [r.id, r]));
    const level = (id: string, seen = new Set<string>()): number => {
      const t = byId.get(id);
      if (!t?.parentTaskId || seen.has(id) || !byId.has(t.parentTaskId)) return 0;
      seen.add(id);
      return level(t.parentTaskId, seen) + 1;
    };

    const checksCount = new Map<string, number>();
    const checksPosted = new Map<string, number>();
    for (const r of raw) {
      if (r.kind !== "check" || !r.parentTaskId) continue;
      checksCount.set(r.parentTaskId, (checksCount.get(r.parentTaskId) ?? 0) + 1);
      if (r.linkedAdoId) checksPosted.set(r.parentTaskId, (checksPosted.get(r.parentTaskId) ?? 0) + 1);
    }

    const all: AdoTaskRow[] = raw.filter((r) => r.kind !== "check").map((r) => ({
      id: r.id, requirementId: r.requirementId,
      requirementKey: r.requirementKey, requirementTitle: r.requirementTitle,
      seq: r.seq, intent: r.intent, appetite: r.appetite, state: r.state,
      adoType: r.adoType, linkedAdoId: r.linkedAdoId, adoUrl: r.adoUrl,
      adoSyncedAt: r.adoSyncedAt ? new Date(r.adoSyncedAt).toISOString() : null,
      approved: r.approvedAt != null, active: r.active, parentTaskId: r.parentTaskId, level: level(r.id),
      checksCount: checksCount.get(r.id) ?? 0, checksPosted: checksPosted.get(r.id) ?? 0,
    }));

    // depth-first within each requirement so the hierarchy reads top-down
    const kids = new Map<string, AdoTaskRow[]>();
    for (const t of all) {
      const k = t.parentTaskId && byId.has(t.parentTaskId) ? t.parentTaskId : `root:${t.requirementId}`;
      (kids.get(k) ?? kids.set(k, []).get(k)!).push(t);
    }
    const rows: AdoTaskRow[] = [];
    const walk = (key: string) => {
      for (const t of (kids.get(key) ?? []).sort((a, b) => a.seq - b.seq)) {
        rows.push(t);
        walk(t.id);
      }
    };
    const seenReqs = new Set<string>();
    for (const t of all) {
      if (seenReqs.has(t.requirementId)) continue;
      seenReqs.add(t.requirementId);
      walk(`root:${t.requirementId}`);
    }

    return {
      rows,
      inTfs: rows.filter((r) => r.linkedAdoId).length,
      pending: rows.filter((r) => !r.linkedAdoId && r.active).length,
    };
  });
}

/**
 * Every client's task tree in one list — the org-wide TFS mirror behind
 * the Azure DevOps nav screen. `client` has no RLS, so we enumerate it
 * and run the tenant-scoped walk per client (sequentially: PGlite has a
 * single connection).
 */
export async function allAdoTasks(): Promise<{
  clients: { clientId: string; clientName: string; rows: AdoTaskRow[]; inTfs: number; pending: number }[];
  inTfs: number;
  pending: number;
}> {
  const cs = await db.select({ id: client.id, name: client.name }).from(client).orderBy(client.name);
  const out: { clientId: string; clientName: string; rows: AdoTaskRow[]; inTfs: number; pending: number }[] = [];
  for (const c of cs) {
    const t = await clientTaskTree(c.id);
    if (t.rows.length === 0) continue;
    out.push({ clientId: c.id, clientName: c.name, ...t });
  }
  return {
    clients: out,
    inTfs: out.reduce((n, c) => n + c.inTfs, 0),
    pending: out.reduce((n, c) => n + c.pending, 0),
  };
}

function wims2nodes(
  witems: { id: string; key: string | null; title: string; phase: string; type: string; parentId: string | null; linkedAdoId: number | null; adoUrl: string | null }[],
  gapMap: Map<string, number>,
  blkMap: Map<string, number>,
): FlowNode[] {
  return witems.map((w) => ({
    id: w.id,
    key: w.key,
    title: w.title,
    phase: w.phase,
    type: w.type,
    parentId: w.parentId,
    openBlockingGaps: gapMap.get(w.id) ?? 0,
    openBlockers: blkMap.get(w.id) ?? 0,
    linkedAdoId: w.linkedAdoId,
    adoUrl: w.adoUrl,
  }));
}
