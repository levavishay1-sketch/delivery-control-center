import { db } from "@/lib/db";

export async function listRecentAuditEvents(limit = 200) {
  return db.auditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      project: true,
      pipeline: { include: { workItem: true } },
      stage: true,
    },
  });
}
