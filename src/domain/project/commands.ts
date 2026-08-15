import { db } from "@/lib/db";
import type { IntegrationType, Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";
import { encryptIntegrationConfig } from "@/lib/integrations";
import { getOrCreateConnectorForProject } from "@/domain/connector/commands";

export interface CreateProjectInput {
  clientId: string;
  name: string;
  key: string;
  integrationType?: IntegrationType;
  integrationConfig?: Record<string, unknown>;
}

export async function createProject(ctx: AuthContext, input: CreateProjectInput) {
  requireClientRole(ctx, input.clientId, WRITE_ROLES);
  const integrationType = input.integrationType ?? "MANUAL";
  return db.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        clientId: input.clientId,
        name: input.name,
        key: input.key,
        integrationType,
        integrationConfig: encryptIntegrationConfig(integrationType, input.integrationConfig) as
          | Prisma.InputJsonValue
          | undefined,
      },
    });
    // Slice 4 — every Project gets a Connector the same moment it's created (design.md decision 1).
    await getOrCreateConnectorForProject(project.id, tx);
    return project;
  });
}

/** Sets or clears a project's AI spending limit — overrides its client's if set (design.md Decision 4). `null` means no project-level limit. */
export async function setProjectAiBudget(ctx: AuthContext, projectId: string, budgetUsd: number | null) {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  requireClientRole(ctx, project.clientId, WRITE_ROLES);
  return db.project.update({ where: { id: projectId }, data: { aiBudgetUsd: budgetUsd } });
}
