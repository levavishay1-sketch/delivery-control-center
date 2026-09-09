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
