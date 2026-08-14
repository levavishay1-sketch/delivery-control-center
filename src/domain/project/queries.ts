import { db } from "@/lib/db";

/** Projects with their work items and pipeline status, for the home page list. */
export async function listProjectsForHome() {
  return db.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
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
