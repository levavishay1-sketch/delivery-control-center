import { db } from "@/lib/db";
import type { AuthContext } from "@/domain/shared/context";
import { requireOrgAdmin } from "@/domain/shared/authz";

export async function createOrganization(ctx: AuthContext, name: string, slug: string) {
  requireOrgAdmin(ctx);
  return db.organization.create({ data: { name, slug } });
}
