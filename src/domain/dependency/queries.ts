import { db } from "@/lib/db";
import { getProjectById } from "@/domain/project/queries";
import { requireClientRole, ALL_ROLES } from "@/domain/shared/authz";
import { NotFoundError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";

/**
 * Gets all dependencies for a work item (both upstream and downstream).
 * Returns { upstream: [...], downstream: [...] }
 */
export async function getWorkItemDependencies(workItemId: string) {
  // Upstream: items this work item depends on
  const upstream = await db.dependency.findMany({
    where: { workItemId },
    include: { dependsOnWorkItem: { include: { pipeline: true } } },
    orderBy: { createdAt: "desc" },
  });

  // Downstream: items that depend on this work item
  const downstream = await db.dependency.findMany({
    where: { dependsOnWorkItemId: workItemId },
    include: { workItem: { include: { pipeline: true } } },
    orderBy: { createdAt: "desc" },
  });

  return { upstream, downstream };
}

/**
 * Stub for Slice 2: Compute critical path through dependencies.
 * For now, returns empty array.
 */
export async function getCriticalPath(): Promise<string[]> {
  // TODO: Implement critical path analysis in Slice 2
  return [];
}

const MAX_GRAPH_NODES = 200;

/**
 * The full dependency neighborhood connected to a work item — every item reachable
 * by following dependency edges in either direction (not just its direct upstream/
 * downstream), for the Dependency Graph visualization. Bounded to MAX_GRAPH_NODES
 * as a defensive cap; a project's dependency graph is expected to stay well under
 * that in practice, and a truncated-but-labeled graph beats an unbounded query.
 */
export async function getWorkItemDependencyGraph(workItemId: string) {
  const visited = new Set<string>([workItemId]);
  const queue = [workItemId];
  const edgeIds = new Set<string>();
  const edges: { id: string; workItemId: string; dependsOnWorkItemId: string; reason: string }[] = [];

  while (queue.length > 0 && visited.size < MAX_GRAPH_NODES) {
    const batch = queue.splice(0, queue.length);
    const [outgoing, incoming] = await Promise.all([
      db.dependency.findMany({ where: { workItemId: { in: batch } } }),
      db.dependency.findMany({ where: { dependsOnWorkItemId: { in: batch } } }),
    ]);

    for (const dep of [...outgoing, ...incoming]) {
      if (!edgeIds.has(dep.id)) {
        edgeIds.add(dep.id);
        edges.push({ id: dep.id, workItemId: dep.workItemId, dependsOnWorkItemId: dep.dependsOnWorkItemId, reason: dep.reason });
      }
      for (const neighborId of [dep.workItemId, dep.dependsOnWorkItemId]) {
        if (!visited.has(neighborId) && visited.size < MAX_GRAPH_NODES) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      }
    }
  }

  const nodes = await db.workItem.findMany({
    where: { id: { in: [...visited] } },
    select: { id: true, title: true, type: true, status: true },
  });

  return { nodes, edges, truncated: visited.size >= MAX_GRAPH_NODES };
}

export interface ProjectWorkGraphNode {
  id: string;
  title: string;
  type: string;
  status: string;
  readyToStart: boolean;
}

/**
 * Slice 16 — every WorkItem in a project plus every Dependency edge among them, for the Planner's
 * Graph and Board views. Same MAX_GRAPH_NODES cap and { nodes, edges, truncated } shape as
 * getWorkItemDependencyGraph above (design.md decision 2), differing only in how nodes are
 * selected (project membership, not BFS reachability from one node).
 */
export async function getProjectWorkGraph(ctx: AuthContext, projectId: string) {
  const project = await getProjectById(projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, ALL_ROLES);

  const items = await db.workItem.findMany({
    where: { projectId },
    select: { id: true, title: true, type: true, status: true },
    take: MAX_GRAPH_NODES,
    orderBy: { createdAt: "asc" },
  });
  const itemIds = items.map((i) => i.id);

  const deps = await db.dependency.findMany({
    where: { workItemId: { in: itemIds }, dependsOnWorkItemId: { in: itemIds } },
  });

  // A WorkItem is ready to start (design.md decision 3) when it's OPEN/IN_PROGRESS and every
  // WorkItem it depends on is already COMPLETED/CLOSED — computed here, not stored, since it's a
  // pure function of already-stored facts that can drift independently of any write this slice makes.
  const statusById = new Map(items.map((i) => [i.id, i.status]));
  const upstreamOf = new Map<string, string[]>();
  for (const d of deps) {
    (upstreamOf.get(d.workItemId) ?? upstreamOf.set(d.workItemId, []).get(d.workItemId)!).push(d.dependsOnWorkItemId);
  }
  const RESOLVED_STATUSES = new Set(["COMPLETED", "CLOSED"]);
  const READY_STATUSES = new Set(["OPEN", "IN_PROGRESS"]);

  const nodes: ProjectWorkGraphNode[] = items.map((item) => {
    const upstream = upstreamOf.get(item.id) ?? [];
    const readyToStart = READY_STATUSES.has(item.status) && upstream.every((id) => RESOLVED_STATUSES.has(statusById.get(id) ?? ""));
    return { id: item.id, title: item.title, type: item.type, status: item.status, readyToStart };
  });

  const edges = deps.map((d) => ({ id: d.id, workItemId: d.workItemId, dependsOnWorkItemId: d.dependsOnWorkItemId, reason: d.reason }));

  return { nodes, edges, truncated: items.length >= MAX_GRAPH_NODES };
}
