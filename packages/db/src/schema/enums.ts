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

/** Size of a WorkItem. Maps to ADO Epic/Feature/Story/Task on sync. */
export const workitemLevel = pgEnum("workitem_level", [
  "epic",
  "feature",
  "story",
  "task",
]);

/** Kind of work — drives the type chip in the UI. */
export const workitemKind = pgEnum("workitem_kind", [
  "project",
  "task",
  "bug",
  "change",
]);

export const priority = pgEnum("priority", ["low", "medium", "high", "critical"]);
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
