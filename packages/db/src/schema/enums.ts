import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Where an event entered the system. `type` (a free-text column on
 * event_log) says what happened; `source` says through which door.
 * New sources are rare and deliberate — hence an enum.
 */
export const eventSource = pgEnum("event_source", [
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

/**
 * Work item type — one field, 1:1 with the Azure DevOps / TFS work item
 * types. Replaces the old (kind × level) pair. A "requirement" enters as
 * one of these (default `story`); shaping refines it.
 *   epic     — a large initiative, months, several deliverables
 *   feature  — one coherent capability, a PR-series, weeks
 *   story    — one focused change, one PR, days
 *   bug      — a defect
 *   task     — a small unit of execution (often a child of a story)
 *   spike    — time-boxed investigation, throwaway output
 */
export const workitemType = pgEnum("workitem_type", [
  "epic",
  "feature",
  "story",
  "bug",
  "task",
  "spike",
]);

export const priority = pgEnum("priority", ["low", "medium", "high", "critical"]);

/** How a client's requirements sync outward. "dcc" = managed only inside DCC. */
export const connectorType = pgEnum("connector_type", ["manual", "ado", "github", "jira", "dcc"]);

export const riskLevel = pgEnum("risk_level", ["low", "medium", "high"]);

/** Who is doing the work — human, an AI agent, or both. */
export const executor = pgEnum("executor", ["human", "ai", "mixed"]);

/**
 * Status is a spectrum, not a gate (architecture §3). This enum is only
 * the coarse bucket shown in lists; the rich picture is derived from
 * open Gaps / Blockers / task state at read time.
 */
export const workitemPhase = pgEnum("workitem_phase", [
  "intake",
  "shaping",
  "building",
  "review",
  "done",
  "archived",
]);

/** A Gap is a proposal until a human verifies it (architecture §4). */
export const gapState = pgEnum("gap_state", [
  "proposed",
  "verified",
  "resolved",
  "dismissed",
  "spun_off",
]);

export const blockerState = pgEnum("blocker_state", [
  "open",
  "answered",
  "abandoned",
]);

/** Shape-Up appetite — the one field OpenSpec does not carry (architecture §5). */
export const taskAppetite = pgEnum("task_appetite", [
  "small",
  "standard",
  "large",
]);

export const taskState = pgEnum("task_state", [
  "pending",
  "in_progress",
  "blocked",
  "done",
  "dropped",
]);

/**
 * Oversight level per (action-type × client|workitem). Ordered least →
 * most autonomous. Increasing this above the client default requires
 * sign-off one level up (architecture §9).
 */
export const permissionLevel = pgEnum("permission_level", [
  "propose_only",
  "execute_notify",
  "execute_silent",
]);
