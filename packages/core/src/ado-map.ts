/** Azure DevOps / TFS ↔ DCC field mapping. Shared by import, pull and sync. */

export type ReqType = "epic" | "feature" | "story" | "bug" | "task" | "spike";
export type Phase = "intake" | "shaping" | "building" | "review" | "done" | "archived";

export const ADO_TYPE_TO_DCC: Record<string, ReqType> = {
  epic: "epic",
  feature: "feature",
  "user story": "story",
  "product backlog item": "story",
  requirement: "story",
  "change request": "story",
  bug: "bug",
  issue: "task",
  task: "task",
  "test case": "task",
  "test plan": "task",
  "test suite": "task",
};

/** DCC type → the ADO work-item type name to create (Agile process). */
export const DCC_TYPE_TO_ADO: Record<ReqType, string> = {
  epic: "Epic",
  feature: "Feature",
  story: "User Story",
  bug: "Bug",
  task: "Task",
  spike: "Task",
};

export const ADO_STATE_TO_PHASE: Record<string, Phase> = {
  new: "intake",
  proposed: "intake",
  "to do": "intake",
  approved: "shaping",
  design: "shaping",
  committed: "shaping",
  active: "building",
  "in progress": "building",
  "in development": "building",
  doing: "building",
  resolved: "review",
  "qa test": "review",
  "prod ready": "review",
  "ready for prod": "review",
  released: "done",
  closed: "done",
  done: "done",
  completed: "done",
  removed: "archived",
};

/** DCC phase → an ADO state to try (Agile). Best-effort; transitions can be rejected. */
export const PHASE_TO_ADO_STATE: Record<Phase, string> = {
  intake: "New",
  shaping: "New",
  building: "Active",
  review: "Resolved",
  done: "Closed",
  archived: "Removed",
};

/** DCC task `state` → an ADO state to try (Agile). Best-effort — a plain
 *  "Task" work item only has New/Active/Closed/Removed (no "Resolved"),
 *  while User Story/Feature/Epic also have "Resolved"; a rejected
 *  transition on the narrower Task type is caught and ignored by the
 *  caller, same as every other ADO write in this codebase. */
export const TASK_STATE_TO_ADO_STATE: Record<string, string> = {
  pending: "New",
  in_progress: "Active",
  failed_checks: "Active",
  blocked: "Active",
  done: "Closed",
  dropped: "Removed",
};

/**
 * The Agile process hierarchy, top down. A requirement never reaches TFS
 * — the TASKS it breaks into do, and the DEPTH of the task tree picks the
 * rungs, anchored at the bottom (the leaves are always Tasks):
 *   depth 1 → Task
 *   depth 2 → User Story, Task
 *   depth 3 → Feature, User Story, Task
 *   depth 4 → Epic, Feature, User Story, Task
 */
export const ADO_LADDER = ["Epic", "Feature", "User Story", "Task"] as const;
export const MAX_TASK_DEPTH = ADO_LADDER.length;

/** TFS work-item type for a node at 0-based `level` of a tree `depth` deep. */
export function adoTypeForLevel(level: number, depth: number): string {
  const d = Math.min(Math.max(depth, 1), MAX_TASK_DEPTH);
  const start = MAX_TASK_DEPTH - d;
  return ADO_LADDER[Math.min(start + level, MAX_TASK_DEPTH - 1)]!;
}

export const mapAdoType = (raw: string): ReqType => ADO_TYPE_TO_DCC[raw.trim().toLowerCase()] ?? "task";
export const mapAdoState = (raw: string): Phase => ADO_STATE_TO_PHASE[raw.trim().toLowerCase()] ?? "intake";

export const htmlToText = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
