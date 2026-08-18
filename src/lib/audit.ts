import type { AuditActor, Prisma } from "@/generated/prisma/client";

type DbClient = Prisma.TransactionClient;

export interface AuditEventInput {
  /** At least one of projectId/pipelineId/workItemId should be set so the event can be traced back to something. */
  projectId?: string;
  pipelineId?: string;
  stageId?: string;
  workItemId?: string;
  actor: AuditActor;
  /** Real user identity for USER-actor events; null for SYSTEM/AI, which have no User row. */
  userId?: string;
  actorName?: string;
  action: string;
  detail?: Record<string, unknown>;
}

/**
 * Single choke point for the audit trail: every meaningful pipeline
 * transition must go through here so nothing decision-worthy goes unlogged.
 * Accepts a transaction client so the audit write commits atomically with
 * whatever state change it's describing.
 */
export async function recordAuditEvent(db: DbClient, input: AuditEventInput) {
  return db.auditEvent.create({
    data: {
      projectId: input.projectId,
      pipelineId: input.pipelineId,
      stageId: input.stageId,
      workItemId: input.workItemId,
      actor: input.actor,
      userId: input.userId,
      actorName: input.actorName,
      action: input.action,
      detail: input.detail as Prisma.InputJsonValue | undefined,
    },
  });
}
