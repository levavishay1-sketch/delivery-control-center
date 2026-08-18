import { db } from "@/lib/db";
import { requireClientRole, ALL_ROLES } from "@/domain/shared/authz";
import { NotFoundError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";

/** A client's Requirements, newest first — regardless of status. */
export async function listRequirementsForClient(ctx: AuthContext, clientId: string) {
  requireClientRole(ctx, clientId, ALL_ROLES);
  return db.requirement.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    include: { project: { select: { id: true, name: true } }, workItem: { select: { id: true, title: true } } },
  });
}

/** A single Requirement's detail, including its linked Project/WorkItem if any. Null if not found or not accessible. */
export async function getRequirementById(ctx: AuthContext, id: string) {
  const requirement = await db.requirement.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true } },
      workItem: { select: { id: true, title: true, pipeline: { select: { id: true } } } },
    },
  });
  if (!requirement) throw new NotFoundError("Requirement not found");
  requireClientRole(ctx, requirement.clientId, ALL_ROLES);
  return requirement;
}
