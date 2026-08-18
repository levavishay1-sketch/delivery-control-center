import { db } from "@/lib/db";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, ALL_ROLES } from "@/domain/shared/authz";

/** The current effective Constitution for a project, if any version has been approved. */
export function getApprovedConstitution(projectId: string) {
  return db.constitution.findFirst({ where: { projectId, status: "APPROVED" }, orderBy: { version: "desc" } });
}

/** Every version ever drafted for a project, newest first. */
export function getConstitutionHistory(projectId: string) {
  return db.constitution.findMany({ where: { projectId }, orderBy: { version: "desc" } });
}

/** A Constitution's current status, for ConstitutionDraftButton's lightweight status poll while a draft is in flight. Requires at least read access. */
export async function getConstitutionStatus(ctx: AuthContext, constitutionId: string) {
  const constitution = await db.constitution.findUnique({ where: { id: constitutionId }, include: { project: true } });
  if (!constitution) return null;
  requireClientRole(ctx, constitution.project.clientId, ALL_ROLES);
  return constitution;
}

/** Project header + latest version + full history, for the /projects/[id]/constitution page. Requires at least read access. */
export async function getProjectConstitutionDetail(ctx: AuthContext, projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) return null;
  requireClientRole(ctx, project.clientId, ALL_ROLES);

  const history = await getConstitutionHistory(projectId);
  return { project, latest: history[0] ?? null, history };
}
