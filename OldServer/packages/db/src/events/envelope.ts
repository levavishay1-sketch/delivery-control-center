import { z } from "zod";

/**
 * The event envelope — the part of every event_log row that is the same
 * regardless of `type`. Payload is validated separately, per type, by
 * the registry in ./payloads.ts.
 */

export const eventActor = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("user"),
    userId: z.string().uuid(),
    identityType: z.literal("interactive"),
  }),
  z.object({
    kind: z.literal("delegated"),
    userId: z.string().uuid(),
    identityType: z.literal("delegated"),
    /** e.g. "system:ingestion", "system:brief-generator" */
    triggeredBy: z.string().min(1),
  }),
  z.object({
    kind: z.literal("system"),
    /** transport plumbing only — never carries reasoning */
    process: z.string().min(1),
  }),
]);
export type EventActor = z.infer<typeof eventActor>;

export const eventLink = z.object({
  rel: z.enum([
    "supersedes",
    "pull_request",
    "ado_workitem",
    "gap",
    "task",
    "blocker",
    "commit",
    "session",
    "thread",
    /** a row of the claude_call ledger — the event carries no cost, the row does */
    "claude_call",
  ]),
  ref: z.string().min(1),
});
export type EventLink = z.infer<typeof eventLink>;

export const eventSource = z.enum([
  "email",
  "slack",
  "phone",
  "meeting",
  "claude_session",
  "git",
  "ado",
  "manual",
  "system",
]);

export const eventEnvelope = z.object({
  clientId: z.string().uuid(),
  /** null ⇒ lands in the unassigned bucket */
  workitemId: z.string().uuid().nullable(),
  occurredAt: z.coerce.date(),
  source: eventSource,
  type: z.string().min(1),
  actor: eventActor,
  supersedes: z.string().uuid().nullable().default(null),
  links: z.array(eventLink).default([]),
});
export type EventEnvelope = z.infer<typeof eventEnvelope>;
