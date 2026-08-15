import { db } from "@/lib/db";

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
