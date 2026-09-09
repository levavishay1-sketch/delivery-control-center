import { sql } from "drizzle-orm";
import { withTenant, appendEvent } from "@dcc/db";
import { gap, workitem, workitemDependency } from "@dcc/db/schema";
import { regenerateBrief } from "./brief/generate.ts";

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

function wims2nodes(
  witems: { id: string; key: string | null; title: string; phase: string; type: string; parentId: string | null; linkedAdoId: number | null }[],
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
  }));
}
