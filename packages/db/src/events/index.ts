import { sql } from "drizzle-orm";
import { eventLog } from "../schema/events.ts";
import { withTenant } from "../client.ts";
import { CURRENT_VERSION, payloadSchemaFor } from "./payloads.ts";
import { eventEnvelope, type EventEnvelope, type EventLink } from "./envelope.ts";

export * from "./envelope.ts";
export * from "./payloads.ts";

export type AppendInput = Omit<EventEnvelope, "occurredAt" | "supersedes" | "links"> & {
  occurredAt?: Date | string | undefined;
  supersedes?: string | null | undefined;
  links?: EventLink[] | undefined;
  payload: unknown;
  schemaVersion?: number | undefined;
};

/**
 * The ONE way to write an event. Validates the envelope and the
 * type-specific payload before the row touches the database. Nothing
 * else should INSERT into event_log.
 *
 * Append-only is also enforced at the DB (guards.sql triggers); this
 * function is the front door that keeps the payload honest.
 */
export async function appendEvent(input: AppendInput) {
  const version = input.schemaVersion ?? CURRENT_VERSION;

  const env = eventEnvelope.parse({
    ...input,
    occurredAt: input.occurredAt ?? new Date(),
  });

  const payload = payloadSchemaFor(env.type, version).parse(input.payload);

  return withTenant(env.clientId, async (tx) => {
    const [row] = await tx
      .insert(eventLog)
      .values({
        clientId: env.clientId,
        workitemId: env.workitemId,
        occurredAt: env.occurredAt,
        source: env.source,
        type: env.type,
        schemaVersion: version,
        actor: env.actor,
        payload: payload as Record<string, unknown>,
        supersedes: env.supersedes,
        links: env.links,
      })
      .returning();
    return row;
  });
}

/**
 * Read a WorkItem's timeline in the order things actually happened,
 * newest first. Superseded rows are still returned — the timeline shows
 * history as it was, corrections included (architecture UI §2).
 */
export async function timeline(clientId: string, workitemId: string, limit = 200) {
  return withTenant(clientId, (tx) =>
    tx
      .select()
      .from(eventLog)
      .where(sql`${eventLog.workitemId} = ${workitemId}`)
      .orderBy(sql`${eventLog.occurredAt} desc`)
      .limit(limit),
  );
}

/** Events with no WorkItem yet — the unassigned inbox. */
export async function unassigned(clientId: string, limit = 100) {
  return withTenant(clientId, (tx) =>
    tx
      .select()
      .from(eventLog)
      .where(sql`${eventLog.workitemId} is null`)
      .orderBy(sql`${eventLog.recordedAt} desc`)
      .limit(limit),
  );
}
