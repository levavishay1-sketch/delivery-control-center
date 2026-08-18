import { db } from "@/lib/db";
import type { ConfigScope } from "@/generated/prisma/client";

export interface EffectiveBudget {
  /** The value this scope actually uses right now — its own override, or an inherited ancestor's. Null means unbounded. */
  value: string | null;
  /** Which scope the effective value actually comes from — the scope itself, or the nearest ancestor with its own override. Null when nothing in the chain has a value. */
  sourceScope: ConfigScope | null;
  /** Whether this scope has its own override (true) or is inheriting (false). */
  isOverride: boolean;
}

/** A scope's effective AI budget, its source, and whether it's this scope's own override or inherited (configuration-center spec's "effective value shows its source"). */
export async function getEffectiveBudget(scope: ConfigScope, scopeId: string): Promise<EffectiveBudget> {
  if (scope === "PROJECT") {
    const project = await db.project.findUniqueOrThrow({ where: { id: scopeId }, include: { client: true } });
    if (project.aiBudgetUsd !== null) {
      return { value: project.aiBudgetUsd.toString(), sourceScope: "PROJECT", isOverride: true };
    }
    return resolveFromClient(project.client, false);
  }

  if (scope === "CLIENT") {
    const client = await db.client.findUniqueOrThrow({ where: { id: scopeId } });
    return resolveFromClient(client, true);
  }

  const organization = await db.organization.findUniqueOrThrow({ where: { id: scopeId } });
  if (organization.aiBudgetUsd !== null) {
    return { value: organization.aiBudgetUsd.toString(), sourceScope: "ORGANIZATION", isOverride: true };
  }
  return { value: null, sourceScope: null, isOverride: false };
}

async function resolveFromClient(
  client: { aiBudgetUsd: { toString(): string } | null; organizationId: string },
  isClientScope: boolean
): Promise<EffectiveBudget> {
  if (client.aiBudgetUsd !== null) {
    return { value: client.aiBudgetUsd.toString(), sourceScope: "CLIENT", isOverride: isClientScope };
  }
  const organization = await db.organization.findUniqueOrThrow({ where: { id: client.organizationId } });
  if (organization.aiBudgetUsd !== null) {
    return { value: organization.aiBudgetUsd.toString(), sourceScope: "ORGANIZATION", isOverride: false };
  }
  return { value: null, sourceScope: null, isOverride: false };
}

/** A scope's AI-budget change history, most recent first (configuration-center spec's version-history requirement). */
export function listConfigHistory(scope: ConfigScope, scopeId: string) {
  const where =
    scope === "ORGANIZATION" ? { scope, organizationId: scopeId } : scope === "CLIENT" ? { scope, clientId: scopeId } : { scope, projectId: scopeId };
  return db.configChange.findMany({
    where,
    include: { changedByUser: true },
    orderBy: { createdAt: "desc" },
  });
}
