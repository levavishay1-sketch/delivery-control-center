import { db } from "@/lib/db";
import { Prisma, type IntegrationType } from "@/generated/prisma/client";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";
import { encryptIntegrationConfig } from "@/lib/integrations";
import { DEFAULT_AUTH_TYPE } from "@/domain/connector/commands";

export interface CreateProjectInput {
  clientId: string;
  name: string;
  key: string;
  integrationType?: IntegrationType;
  integrationConfig?: Record<string, unknown>;
}

/**
 * Creates the Project and its Connector together, in the same transaction (design.md decision 1
 * — every Project has exactly one Connector "the same moment it's created"). The connector, not
 * Project, is the sole source of truth for how this project's external tracker is reached
 * (design.md Migration Plan step 4 — Project.integrationType/integrationConfig were dropped once
 * the cutover was verified).
 */
export async function createProject(ctx: AuthContext, input: CreateProjectInput) {
  requireClientRole(ctx, input.clientId, WRITE_ROLES);
  const integrationType = input.integrationType ?? "MANUAL";
  return db.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: { clientId: input.clientId, name: input.name, key: input.key },
    });
    await tx.connector.create({
      data: {
        projectId: project.id,
        type: integrationType,
        mode: "PULL",
        authType: DEFAULT_AUTH_TYPE[integrationType],
        syncMode: "MANUAL",
        capabilities: [],
        config: encryptIntegrationConfig(integrationType, input.integrationConfig) as Prisma.InputJsonValue | undefined,
        status: integrationType === "MANUAL" ? "DISCONNECTED" : "CONNECTED",
      },
    });
    return project;
  });
}

/** Sets or clears a project's AI spending limit — overrides its client's if set (design.md Decision 4). `null` means no project-level limit. */
export async function setProjectAiBudget(ctx: AuthContext, projectId: string, budgetUsd: number | null) {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  requireClientRole(ctx, project.clientId, WRITE_ROLES);
  return db.project.update({ where: { id: projectId }, data: { aiBudgetUsd: budgetUsd } });
}
