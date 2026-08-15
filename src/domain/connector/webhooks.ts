import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { triggerSyncFromWebhook } from "@/domain/connector/commands";
import { NotFoundError } from "@/domain/shared/errors";

export type ReceiveWebhookResult = { status: "duplicate" } | { status: "processed"; jobId: string };

/**
 * Idempotent webhook intake (design.md decision 5): inserts a dedup receipt keyed by
 * [connectorId, deliveryId] before doing any work. A redelivered id sees the insert no-op
 * (unique constraint violation) and returns "duplicate" without enqueueing a second sync — the
 * caller (an API route) is expected to have already verified the delivery's signature/auth
 * before calling this.
 */
export async function receiveWebhook(connectorId: string, deliveryId: string): Promise<ReceiveWebhookResult> {
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

  const job = await triggerSyncFromWebhook(connectorId);
  return { status: "processed", jobId: job.id };
}
