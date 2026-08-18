import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { triggerSyncFromWebhook } from "@/domain/connector/commands";
import { NotFoundError } from "@/domain/shared/errors";

export type ReceiveWebhookResult =
  | { status: "duplicate" }
  | { status: "processed"; jobId: string }
  | { status: "recorded" };

/**
 * Idempotent webhook intake (design.md decision 5): inserts a dedup receipt keyed by
 * [connectorId, deliveryId] before doing any work. A redelivered id sees the insert no-op
 * (unique constraint violation) and returns "duplicate" without enqueueing a second sync — the
 * caller (an API route) is expected to have already verified the delivery's signature/auth
 * before calling this.
 *
 * `triggerSync` defaults to true (the pre-Slice-5 behavior — every genuinely new delivery syncs
 * work items). The GitHub route passes false for evidence-only event types (push/pull_request/
 * check_run/deployment_status — Slice 5), which record engineering evidence instead and have
 * nothing to do with work-item sync.
 */
export async function receiveWebhook(
  connectorId: string,
  deliveryId: string,
  triggerSync = true
): Promise<ReceiveWebhookResult> {
  const connector = await db.connector.findUnique({ where: { id: connectorId } });
  if (!connector) throw new NotFoundError("Connector not found");

  try {
    await db.webhookDelivery.create({ data: { connectorId, deliveryId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { status: "duplicate" };
    }
    throw err;
  }

  if (!triggerSync) return { status: "recorded" };

  const job = await triggerSyncFromWebhook(connectorId);
  return { status: "processed", jobId: job.id };
}
