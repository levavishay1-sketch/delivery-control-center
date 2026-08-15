import { db } from "@/lib/db";

/** The current effective Constitution for a project, if any version has been approved. */
export function getApprovedConstitution(projectId: string) {
  return db.constitution.findFirst({ where: { projectId, status: "APPROVED" }, orderBy: { version: "desc" } });
}

/** Every version ever drafted for a project, newest first. */
export function getConstitutionHistory(projectId: string) {
  return db.constitution.findMany({ where: { projectId }, orderBy: { version: "desc" } });
}
