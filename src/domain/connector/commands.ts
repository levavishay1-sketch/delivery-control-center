import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { encryptIntegrationConfig } from "@/lib/integrations";
import { getProjectById } from "@/domain/project/queries";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";
import type { AuthContext } from "@/domain/shared/context";
import type { IntegrationType } from "@/generated/prisma/client";

type DbClient = typeof db | Prisma.TransactionClient;

/** Mirrors the backfill migration's authType inference — kept in one place so a newly created Connector and a backfilled one agree. */
export const DEFAULT_AUTH_TYPE: Record<IntegrationType, string> = {
  MANUAL: "none",
  JIRA: "api_token",
  AZURE_DEVOPS: "pat",
  GITHUB: "token",
};

/**
 * Every project has exactly one Connector (design.md decision 1). Existing projects were
 * backfilled by migration; this covers a project created after the backfill ran, or any other
 * gap — idempotent, so a second call for the same project is a no-op that returns the existing row.
 * Accepts an optional transaction client so createProject can create the Connector atomically
 * alongside the Project (design.md decision 1's "the same moment a Project is created").
 */
export async function getOrCreateConnectorForProject(projectId: string, client: DbClient = db) {
  const existing = await client.connector.findUnique({ where: { projectId } });
  if (existing) return existing;

  const project = await client.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError("Project not found");

  return client.connector.create({
    data: {
      projectId,
      type: project.integrationType,
      mode: "PULL",
      authType: DEFAULT_AUTH_TYPE[project.integrationType],
      syncMode: "MANUAL",
      capabilities: [],
      config: project.integrationConfig ?? undefined,
      status: project.integrationType === "MANUAL" ? "DISCONNECTED" : "CONNECTED",
    },
  });
}

const configureConnectorSchema = z.object({
  type: z.enum(["MANUAL", "JIRA", "AZURE_DEVOPS", "GITHUB"]),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  mode: z.enum(["PULL", "PUSH", "BOTH"]).optional(),
  authType: z.string().min(1).optional(),
  syncMode: z.enum(["MANUAL", "SCHEDULED"]).optional(),
});

export type ConfigureConnectorInput = z.infer<typeof configureConnectorSchema>;

/** Sets a project's connector type/config — the write path behind project settings' connector form. */
export async function configureConnector(ctx: AuthContext, projectId: string, rawInput: ConfigureConnectorInput) {
  const input = configureConnectorSchema.parse(rawInput);
  const project = await getProjectById(projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  if (input.type !== "MANUAL" && !input.config) {
    throw new ValidationError(`Configuring a ${input.type} connector requires connection config.`);
  }

  await getOrCreateConnectorForProject(projectId);

  const encryptedConfig = encryptIntegrationConfig(input.type, input.config ?? null);

  return db.connector.update({
    where: { projectId },
    data: {
      type: input.type,
      config: (encryptedConfig ?? undefined) as Prisma.InputJsonValue | undefined,
      mode: input.mode,
      authType: input.authType ?? DEFAULT_AUTH_TYPE[input.type],
      syncMode: input.syncMode,
      status: input.type === "MANUAL" ? "DISCONNECTED" : "CONNECTED",
    },
  });
}
