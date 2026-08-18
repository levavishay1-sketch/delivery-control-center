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

export interface UpdateClientInput {
  name?: string;
  slug?: string;
}

/** Slice 12 — updates a client's name and/or slug (org-admin only). */
export async function updateClient(ctx: AuthContext, id: string, input: UpdateClientInput) {
  requireOrgAdmin(ctx);
  return db.client.update({
    where: { id },
    data: { name: input.name, slug: input.slug },
  });
}

/**
 * Slice 12 — deactivates a client without deleting any of its data (design.md decision: a plain
 * boolean, not a delete). Excludes it from Dashboard/Attention Center; its own detail page and
 * historical data remain reachable.
 */
export async function deactivateClient(ctx: AuthContext, id: string) {
  requireOrgAdmin(ctx);
  return db.client.update({ where: { id }, data: { active: false } });
}

/** Slice 12 — reactivates a previously deactivated client, symmetric with deactivateClient. */
export async function reactivateClient(ctx: AuthContext, id: string) {
  requireOrgAdmin(ctx);
  return db.client.update({ where: { id }, data: { active: true } });
}

/** Sets or clears a client's AI spending limit (design.md's ai-cost-budgets capability). `null` means no limit. */
export async function setClientAiBudget(ctx: AuthContext, clientId: string, budgetUsd: number | null) {
  requireClientRole(ctx, clientId, WRITE_ROLES);
  return db.client.update({ where: { id: clientId }, data: { aiBudgetUsd: budgetUsd } });
}
