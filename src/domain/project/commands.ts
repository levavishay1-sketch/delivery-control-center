import { db } from "@/lib/db";
import type { IntegrationType, Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";

export interface CreateProjectInput {
  clientId: string;
  name: string;
  key: string;
  integrationType?: IntegrationType;
  integrationConfig?: Record<string, unknown>;
}

export async function createProject(ctx: AuthContext, input: CreateProjectInput) {
  requireClientRole(ctx, input.clientId, WRITE_ROLES);
  return db.project.create({
    data: {
      clientId: input.clientId,
      name: input.name,
      key: input.key,
      integrationType: input.integrationType ?? "MANUAL",
      integrationConfig: input.integrationConfig as Prisma.InputJsonValue | undefined,
    },
  });
}
