import { db } from "@/lib/db";

/**
 * Gets all dependencies for a work item (both upstream and downstream).
 * Returns { upstream: [...], downstream: [...] }
 */
export async function getWorkItemDependencies(workItemId: string) {
  // Upstream: items this work item depends on
  const upstream = await db.dependency.findMany({
    where: { workItemId },
    include: { dependsOnWorkItem: true },
    orderBy: { createdAt: "desc" },
  });

  // Downstream: items that depend on this work item
  const downstream = await db.dependency.findMany({
    where: { dependsOnWorkItemId: workItemId },
    include: { workItem: true },
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
