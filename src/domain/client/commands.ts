import { db } from "@/lib/db";
import type { AuthContext } from "@/domain/shared/context";
import { requireOrgAdmin } from "@/domain/shared/authz";

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
