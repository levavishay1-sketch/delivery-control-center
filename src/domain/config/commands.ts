import { z } from "zod";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { getProjectById } from "@/domain/project/queries";
import { NotFoundError } from "@/domain/shared/errors";
import { requireClientRole, requireOrgAdmin, WRITE_ROLES } from "@/domain/shared/authz";
import type { AuthContext } from "@/domain/shared/context";
import type { ConfigScope } from "@/generated/prisma/client";

export interface BudgetImpactPreview {
  affectedClients: number;
  affectedProjects: number;
}

/**
 * Counts descendants that have no override of their own and would see their effective AI budget
 * change as a result of a change at this scope (configuration-center spec's impact-preview
 * requirement). A Project scope has no descendants — always zero, no preview needed
 * (design.md decision 4).
 */
export async function previewBudgetImpact(scope: ConfigScope, scopeId: string): Promise<BudgetImpactPreview> {
  if (scope === "PROJECT") {
    return { affectedClients: 0, affectedProjects: 0 };
  }

  if (scope === "CLIENT") {
    const affectedProjects = await db.project.count({ where: { clientId: scopeId, aiBudgetUsd: null } });
    return { affectedClients: 0, affectedProjects };
  }

  const [affectedClients, affectedProjects] = await Promise.all([
    db.client.count({ where: { organizationId: scopeId, aiBudgetUsd: null } }),
    db.project.count({ where: { client: { organizationId: scopeId, aiBudgetUsd: null }, aiBudgetUsd: null } }),
  ]);
  return { affectedClients, affectedProjects };
}

const setBudgetSchema = z.object({ budgetUsd: z.number().min(0).nullable() });

/**
 * Sets or clears (design.md decision 3: same endpoint, no separate confirm-token step — the
 * caller's own confirm-after-preview UI flow is what stands between preview and save) a scope's
 * AI budget override, recording a ConfigChange row and an audit event in the same transaction.
 */
export async function setBudget(ctx: AuthContext, scope: ConfigScope, scopeId: string, rawBudgetUsd: number | null) {
  const { budgetUsd } = setBudgetSchema.parse({ budgetUsd: rawBudgetUsd });

  if (scope === "ORGANIZATION") {
    requireOrgAdmin(ctx);
    const organization = await db.organization.findUnique({ where: { id: scopeId } });
    if (!organization) throw new NotFoundError("Organization not found");
    return applyBudgetChange(ctx, "ORGANIZATION", scopeId, organization.aiBudgetUsd?.toNumber() ?? null, budgetUsd, {
      organizationId: scopeId,
    });
  }

  if (scope === "CLIENT") {
    const client = await db.client.findUnique({ where: { id: scopeId } });
    if (!client) throw new NotFoundError("Client not found");
    requireClientRole(ctx, scopeId, WRITE_ROLES);
    return applyBudgetChange(ctx, "CLIENT", scopeId, client.aiBudgetUsd?.toNumber() ?? null, budgetUsd, { clientId: scopeId });
  }

  const project = await getProjectById(scopeId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);
  return applyBudgetChange(ctx, "PROJECT", scopeId, project.aiBudgetUsd?.toNumber() ?? null, budgetUsd, {
    projectId: scopeId,
  });
}

async function applyBudgetChange(
  ctx: AuthContext,
  scope: ConfigScope,
  scopeId: string,
  oldValueUsd: number | null,
  newValueUsd: number | null,
  fk: { organizationId?: string; clientId?: string; projectId?: string }
) {
  return db.$transaction(async (tx) => {
    if (scope === "ORGANIZATION") {
      await tx.organization.update({ where: { id: scopeId }, data: { aiBudgetUsd: newValueUsd } });
    } else if (scope === "CLIENT") {
      await tx.client.update({ where: { id: scopeId }, data: { aiBudgetUsd: newValueUsd } });
    } else {
      await tx.project.update({ where: { id: scopeId }, data: { aiBudgetUsd: newValueUsd } });
    }

    const change = await tx.configChange.create({
      data: {
        scope,
        organizationId: fk.organizationId ?? null,
        clientId: fk.clientId ?? null,
        projectId: fk.projectId ?? null,
        field: "aiBudgetUsd",
        oldValueUsd,
        newValueUsd,
        changedByUserId: ctx.userId,
      },
    });

    await recordAuditEvent(tx, {
      projectId: fk.projectId,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} ${newValueUsd === null ? "reset" : "set"} the ${scope.toLowerCase()} AI budget${newValueUsd === null ? " to inherited" : ` to $${newValueUsd}`}`,
      detail: { scope, oldValueUsd, newValueUsd, configChangeId: change.id },
    });

    return change;
  });
}

/** Clears a scope's own AI-budget override — an explicit action, distinct from saving an empty value (configuration-center spec's reset-to-inherited requirement). */
export async function resetToInherited(ctx: AuthContext, scope: ConfigScope, scopeId: string) {
  return setBudget(ctx, scope, scopeId, null);
}

export type { ConfigScope };
