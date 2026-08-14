import { db } from "@/lib/db";

/**
 * Projects with their client, work items, and pipeline status, for the home
 * page list. Not yet scoped to "the current user's accessible clients" —
 * that lands with authorization in group 4. Today this lists every
 * project across every client, which is fine pre-auth but must not
 * survive past this slice.
 */
export async function listProjectsForHome() {
  return db.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      client: true,
      workItems: {
        orderBy: { createdAt: "desc" },
        include: { pipeline: true },
      },
    },
  });
}

/** Projects with a work-item count, for the projects API. */
export async function listProjectsWithCounts() {
  return db.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { workItems: true } } },
  });
}

export async function getProjectById(id: string) {
  return db.project.findUnique({ where: { id } });
}
