import { appendEvent } from "@dcc/db";
import { regenerateBrief } from "./brief/generate.ts";

/**
 * Normalises what the Claude Code hooks observe into events, then
 * refreshes the WorkItem's Context Brief. These are the two Phase 0
 * capture paths — the developer wedge. Zero manual effort: the hooks
 * call the API, the API calls these.
 *
 * `actor` is always the acting developer, never a service identity
 * (architecture decision 02).
 */

type Dev = { userId: string };

export async function recordSession(input: {
  clientId: string;
  workitemId: string | null;
  dev: Dev;
  session: {
    sessionId: string;
    transcriptPath?: string;
    summary: string;
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
  };
  occurredAt?: Date;
}) {
  const ev = await appendEvent({
    clientId: input.clientId,
    workitemId: input.workitemId,
    occurredAt: input.occurredAt,
    source: "claude_session",
    type: "claude.session",
    actor: { kind: "user", userId: input.dev.userId, identityType: "interactive" },
    links: [{ rel: "session", ref: input.session.sessionId }],
    payload: {
      sessionId: input.session.sessionId,
      transcriptPath: input.session.transcriptPath,
      summary: input.session.summary,
      model: input.session.model,
      tokensIn: input.session.tokensIn,
      tokensOut: input.session.tokensOut,
      costUsd: input.session.costUsd,
    },
  });
  if (input.workitemId) await regenerateBrief(input.clientId, input.workitemId);
  return ev;
}

export async function recordGitActivity(input: {
  clientId: string;
  workitemId: string | null;
  dev: Dev;
  git: {
    repo: string;
    branch: string;
    kind: "commit" | "push" | "branch_created" | "pull_request";
    count?: number;
    prNumber?: number;
    shas?: string[];
  };
  occurredAt?: Date;
}) {
  const links = [
    ...(input.git.prNumber ? [{ rel: "pull_request" as const, ref: String(input.git.prNumber) }] : []),
    ...(input.git.shas ?? []).map((sha) => ({ rel: "commit" as const, ref: sha })),
  ];
  const ev = await appendEvent({
    clientId: input.clientId,
    workitemId: input.workitemId,
    occurredAt: input.occurredAt,
    source: "git",
    type: "git.activity",
    actor: { kind: "user", userId: input.dev.userId, identityType: "interactive" },
    links,
    payload: {
      repo: input.git.repo,
      branch: input.git.branch,
      kind: input.git.kind,
      count: input.git.count,
      prNumber: input.git.prNumber,
      shas: input.git.shas,
    },
  });
  if (input.workitemId) await regenerateBrief(input.clientId, input.workitemId);
  return ev;
}

/** A plain human note (the manual "add note" affordance). */
export async function recordNote(input: {
  clientId: string;
  workitemId: string | null;
  dev: Dev;
  body: string;
  source?: "manual" | "email" | "slack" | "phone" | "meeting";
  occurredAt?: Date;
  /**
   * The id of an earlier note this one corrects. The timeline is
   * append-only (decision 01), so an "edit" or "delete" of a note is
   * really a NEW row that supersedes the old one — history stays intact.
   */
  corrects?: string;
}) {
  const ev = await appendEvent({
    clientId: input.clientId,
    workitemId: input.workitemId,
    occurredAt: input.occurredAt,
    source: input.source ?? "manual",
    type: "note.added",
    actor: { kind: "user", userId: input.dev.userId, identityType: "interactive" },
    supersedes: input.corrects,
    payload: input.corrects ? { body: input.body, corrects: input.corrects } : { body: input.body },
  });
  if (input.workitemId) await regenerateBrief(input.clientId, input.workitemId);
  return ev;
}
