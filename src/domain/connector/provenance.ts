import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

type DbClient = typeof db | Prisma.TransactionClient;

/** Upserts a synced field's current provenance: source SYNC, the external id it came from, no human actor. */
export async function recordSyncProvenance(workItemId: string, field: string, externalId: string, client: DbClient = db) {
  return client.fieldProvenance.upsert({
    where: { workItemId_field: { workItemId, field } },
    create: { workItemId, field, source: "SYNC", externalId },
    update: { source: "SYNC", externalId, actorUserId: null },
  });
}

/** Upserts a manually-edited field's current provenance: source MANUAL, the editing user as actor. */
export async function recordManualProvenance(workItemId: string, field: string, actorUserId: string, client: DbClient = db) {
  return client.fieldProvenance.upsert({
    where: { workItemId_field: { workItemId, field } },
    create: { workItemId, field, source: "MANUAL", actorUserId },
    update: { source: "MANUAL", actorUserId, externalId: null },
  });
}
