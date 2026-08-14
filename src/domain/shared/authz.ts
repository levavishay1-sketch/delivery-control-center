import type { Role } from "@/generated/prisma/client";
import type { AuthContext } from "@/domain/shared/context";
import { ForbiddenError } from "@/domain/shared/errors";

/** Every role except VIEWER — VIEWER is read-only by design (per-stage-type gate policy is a later slice). */
export const WRITE_ROLES: Role[] = ["MANAGER", "PROJECT_MANAGER", "TECH_LEAD", "EXECUTOR", "SECURITY_REVIEWER"];
export const ALL_ROLES: Role[] = [...WRITE_ROLES, "VIEWER"];

/** Throws ForbiddenError unless ctx is an org admin or has one of allowedRoles on clientId. */
export function requireClientRole(ctx: AuthContext, clientId: string, allowedRoles: Role[]): void {
  if (ctx.isOrgAdmin) return;
  const membership = ctx.memberships.find((m) => m.clientId === clientId);
  if (!membership || !allowedRoles.includes(membership.role)) {
    throw new ForbiddenError("You do not have access to this client.");
  }
}

/** Throws ForbiddenError unless ctx is an org admin. For org-level actions like creating clients. */
export function requireOrgAdmin(ctx: AuthContext): void {
  if (!ctx.isOrgAdmin) {
    throw new ForbiddenError("Only an org admin can perform this action.");
  }
}
