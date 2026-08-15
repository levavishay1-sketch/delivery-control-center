import { db } from "@/lib/db";
import type { AuthContext } from "@/domain/shared/context";
import { requireOrgAdmin, requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";

export interface CreateClientInput {
  organizationId: string;
  name: string;
  slug: string;
}

export async function createClient(ctx: AuthContext, input: CreateClientInput) {
  requireOrgAdmin(ctx);
  return db.client.create({
    data: { organizationId: input.organizationId, name: input.name, slug: input.slug },
  });
}

/** Sets or clears a client's AI spending limit (design.md's ai-cost-budgets capability). `null` means no limit. */
export async function setClientAiBudget(ctx: AuthContext, clientId: string, budgetUsd: number | null) {
  requireClientRole(ctx, clientId, WRITE_ROLES);
  return db.client.update({ where: { id: clientId }, data: { aiBudgetUsd: budgetUsd } });
}
