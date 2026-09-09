import { z } from "zod";

/**
 * Per-type payload schemas — the discipline that keeps `event_log.payload`
 * from becoming a junk drawer (architecture decision 01 risk).
 *
 * Every event type has an entry here. Adding a type = adding an entry,
 * NOT a migration. Changing a payload shape = a new version alongside the
 * old, so historical rows still validate against the version they were
 * written with (`event_log.schema_version`).
 *
 * Key: `${type}` → { [version]: ZodSchema }.
 */

const messageIngested = z.object({
  channel: z.enum(["email", "slack", "phone", "meeting"]),
  from: z.string(),
  excerpt: z.string(),
  externalRef: z.string().optional(),
  /** AI match suggestion, if any — a proposal, needs human confirm (architecture §11). */
  matchSuggestion: z
    .object({
      workitemId: z.string().uuid(),
      confidence: z.number().min(0).max(1),
      rationale: z.string(),
    })
    .nullable()
    .default(null),
});

const claudeSession = z.object({
  sessionId: z.string(),
  transcriptPath: z.string().optional(),
  summary: z.string(),
  model: z.string().optional(),
  tokensIn: z.number().int().nonnegative().optional(),
  tokensOut: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});

const gitActivity = z.object({
  repo: z.string(),
  branch: z.string(),
  kind: z.enum(["commit", "push", "branch_created", "pull_request"]),
  count: z.number().int().positive().optional(),
  prNumber: z.number().int().positive().optional(),
  shas: z.array(z.string()).optional(),
});

const gapProposed = z.object({
  description: z.string(),
  blocking: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const gapVerified = z.object({
  gapId: z.string().uuid(),
  outcome: z.enum(["verified", "dismissed", "spun_off"]),
  spunOffTo: z.string().uuid().optional(),
});

const tasksProposed = z.object({
  openspecChangeId: z.string().optional(),
  taskCount: z.number().int().positive(),
  dependencyCount: z.number().int().nonnegative(),
  appetite: z.enum(["small", "standard", "large"]),
});

const blockerRaised = z.object({
  questionType: z.string(),
  question: z.string(),
  taskId: z.string().uuid().optional(),
});

const blockerAnswered = z.object({
  blockerId: z.string().uuid(),
  answer: z.string(),
});

const statusChanged = z.object({
  from: z.string(),
  to: z.string(),
  /** true when the change was made directly in ADO and mirrored back (architecture §14). */
  viaAdo: z.boolean().default(false),
});

const modelRouted = z.object({
  capability: z.string(), // "brief" | "matching" | "gap_detection" | "execution" | "review" | ...
  model: z.string(),
  budgetUsd: z.number().nonnegative().optional(),
  rationale: z.string(),
});

const adoSynced = z.object({
  direction: z.enum(["to_ado", "from_ado"]),
  adoId: z.number().int().positive(),
  operation: z.enum(["create_workitem", "update_state", "create_link", "reconcile"]),
});

const noteAdded = z.object({
  body: z.string(),
});

const matchConfirmed = z.object({
  eventId: z.string().uuid(),
  workitemId: z.string().uuid(),
  wasSuggested: z.boolean(),
});

type Registry = Record<string, Record<number, z.ZodTypeAny>>;

export const payloadSchemas: Registry = {
  "message.ingested": { 1: messageIngested },
  "message.match_confirmed": { 1: matchConfirmed },
  "claude.session": { 1: claudeSession },
  "git.activity": { 1: gitActivity },
  "gap.proposed": { 1: gapProposed },
  "gap.verified": { 1: gapVerified },
  "tasks.proposed": { 1: tasksProposed },
  "blocker.raised": { 1: blockerRaised },
  "blocker.answered": { 1: blockerAnswered },
  "status.changed": { 1: statusChanged },
  "model.routed": { 1: modelRouted },
  "ado.synced": { 1: adoSynced },
  "note.added": { 1: noteAdded },
};

export const CURRENT_VERSION = 1;

export class UnknownEventType extends Error {
  constructor(type: string) {
    super(`No payload schema registered for event type "${type}". Add one to payloads.ts.`);
  }
}

export function payloadSchemaFor(type: string, version: number): z.ZodTypeAny {
  const byVersion = payloadSchemas[type];
  if (!byVersion) throw new UnknownEventType(type);
  const schema = byVersion[version];
  if (!schema) {
    throw new Error(`event type "${type}" has no schema for version ${version}`);
  }
  return schema;
}
