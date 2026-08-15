import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { encryptIntegrationConfig } from "@/lib/integrations";
import { getProjectById } from "@/domain/project/queries";
import { getRunningSyncRun } from "@/domain/connector/queries";
import { enqueueJob } from "@/domain/job/commands";
import { ConflictError, NotFoundError, ValidationError } from "@/domain/shared/errors";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";
import type { AuthContext } from "@/domain/shared/context";
import type { IntegrationType } from "@/generated/prisma/client";
import type { SyncCounts } from "@/domain/connector/sync";

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

/**
 * The write path behind a project's "Sync now" button (or a verified webhook delivery —
 * src/domain/connector/webhooks.ts). Enqueues a SYNC_PROJECT job rather than running the sync
 * inline (design.md decision 2): retry/backoff and crash-durability come from the existing Job
 * runtime for free, the same way DRAFT_STAGE/DRAFT_CONSTITUTION already do. Refuses a second
 * trigger while one is already RUNNING for this connector rather than enqueueing a concurrent
 * SyncRun.
 */
export async function triggerSync(ctx: AuthContext, connectorId: string) {
  const connector = await db.connector.findUnique({ where: { id: connectorId } });
  if (!connector) throw new NotFoundError("Connector not found");
  const project = await getProjectById(connector.projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  const running = await getRunningSyncRun(connectorId);
  if (running) {
    throw new ConflictError("A sync is already running for this connector.");
  }

  return enqueueJob("SYNC_PROJECT", { connectorId }, `sync-project-${connectorId}-${Date.now()}`);
}

/** Convenience wrapper for the common case of triggering a sync by project id (e.g. the "Sync now" API route) rather than connectorId. */
export async function triggerSyncForProject(ctx: AuthContext, projectId: string) {
  const connector = await getOrCreateConnectorForProject(projectId);
  return triggerSync(ctx, connector.id);
}

/**
 * Creates the SyncRun for a sync job's attempt-cycle when first claimed. Idempotent per jobId —
 * same pattern startAgentRun uses (design.md decision 2 mirrors Slice 3 decision 1): a retried
 * attempt-cycle reuses the same run row rather than creating a second one.
 */
export async function startSyncRun(connectorId: string, jobId: string) {
  const existing = await db.syncRun.findFirst({ where: { jobId } });
  if (existing) return existing;
  return db.syncRun.create({ data: { connectorId, jobId, status: "RUNNING" } });
}

/** Marks a SyncRun SUCCEEDED with its final item counts, and its Connector CONNECTED/lastSyncAt. */
export async function completeSyncRun(runId: string, counts: SyncCounts) {
  return db.$transaction(async (tx) => {
    const run = await tx.syncRun.update({
      where: { id: runId },
      data: { status: "SUCCEEDED", completedAt: new Date(), ...counts },
    });
    await tx.connector.update({ where: { id: run.connectorId }, data: { status: "CONNECTED", lastSyncAt: new Date() } });
    return run;
  });
}

/**
 * Marks a SyncRun's exhausted failure (the Job's final failure, not an intermediate retry — Task
 * 3.3: a retry with attempts remaining leaves the SyncRun untouched, still RUNNING, the same
 * attempt-cycle continuing on the worker's next poll) and its Connector ERROR.
 */
export async function failSyncRun(runId: string, error: string) {
  return db.$transaction(async (tx) => {
    const run = await tx.syncRun.update({
      where: { id: runId },
      data: { status: "FAILED", error, completedAt: new Date() },
    });
    await tx.connector.update({ where: { id: run.connectorId }, data: { status: "ERROR" } });
    return run;
  });
}
