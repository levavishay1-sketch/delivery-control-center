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
  /** Wall-clock time the `claude -p` call itself took, and how many
   *  agentic turns it used — pulled from the CLI's own result line
   *  alongside cost/tokens (design notes, cost-visibility). Optional so
   *  rows written before this field existed still validate. */
  durationMs: z.number().int().nonnegative().optional(),
  numTurns: z.number().int().nonnegative().optional(),
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
  outcome: z.enum(["verified", "resolved", "dismissed", "spun_off"]),
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

const taskProgressed = z.object({
  taskId: z.string().uuid(),
  from: z.string(),
  to: z.string(),
  intent: z.string().optional(),
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

/** A call to Claude on this work item happened. The ledger row it links to
 *  (`links: [{rel: "claude_call"}]`) holds who, which model, tokens and
 *  cost — deliberately none of that here, so money is counted once
 *  (claude-in-dcc §8.2). */
const claudeCall = z.object({
  callId: z.string().uuid(),
  capability: z.string(),
  label: z.string().default(""),
  outcome: z.string().default("ok"),
});

const reviewCompleted = z.object({
  verdict: z.enum(["pass", "changes_requested"]),
  findingCount: z.number().int().nonnegative(),
  blockingCount: z.number().int().nonnegative(),
  overlapFocus: z.array(z.string()).default([]),
});

const adoSynced = z.object({
  direction: z.enum(["to_ado", "from_ado"]),
  adoId: z.number().int().positive(),
  operation: z.enum(["create_workitem", "update_state", "create_link", "reconcile"]),
  /** the human-facing work item URL (server-provided; format varies by ADO version) */
  url: z.string().optional(),
});

const noteAdded = z.object({
  body: z.string(),
  /** set when this note corrects an earlier one (the row also sets `supersedes`) */
  corrects: z.string().uuid().optional(),
});

const requirementUpdated = z.object({
  summary: z.string(),
  fields: z.array(z.string()).default([]),
});

const repoLinked = z.object({
  repoName: z.string(),
  linkKind: z.enum(["declared", "auto"]).default("declared"),
});

const repoUnlinked = z.object({
  repoName: z.string(),
});

/** A course-changing decision, with its reason — re-breakdown, a task
 *  closed/reopened despite something unresolved, a requirement
 *  reopened, or a direction change that doesn't fit those. Distinct
 *  from `note.added` on purpose: this is the one event type meant to
 *  be highlighted in history/final-summary views as "why", not just
 *  "what" (design notes, `decision-history`). */
const decisionMade = z.object({
  trigger: z.enum(["rebreakdown", "task_closed_override", "task_reopened", "requirement_reopened", "direction_changed"]),
  reason: z.string(),
});

/** A composed (never sent) message to the requirement's requester,
 *  listing open gaps in business language — `composeClientLetter`. Saved
 *  so it survives navigating away before copying it (a real gap a user
 *  hit live: losing an unsaved letter meant re-running the AI call just
 *  to get the same text back). `gapIds` are the gaps it was composed
 *  from, for context — not itself a source of truth for gap state. */
const clientLetterComposed = z.object({
  subject: z.string(),
  body: z.string(),
  gapCount: z.number().int().nonnegative(),
  gapIds: z.array(z.string()).optional(),
  /** This letter's own cost, duplicated here (alongside the separate
   *  `claude.session` event every run also gets) so the letter-history
   *  view can show each past letter's cost without correlating two
   *  event streams (design notes, cost-visibility). */
  costUsd: z.number().nonnegative().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  model: z.string().optional(),
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
  "task.progressed": { 1: taskProgressed },
  "review.completed": { 1: reviewCompleted },
  "blocker.raised": { 1: blockerRaised },
  "blocker.answered": { 1: blockerAnswered },
  "status.changed": { 1: statusChanged },
  "claude.call": { 1: claudeCall },
  "ado.synced": { 1: adoSynced },
  "note.added": { 1: noteAdded },
  "requirement.updated": { 1: requirementUpdated },
  "repo.linked": { 1: repoLinked },
  "repo.unlinked": { 1: repoUnlinked },
  "decision.made": { 1: decisionMade },
  "client_letter.composed": { 1: clientLetterComposed },
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
