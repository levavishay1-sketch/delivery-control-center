/** Azure DevOps / TFS ↔ DCC field mapping. Shared by import, pull and sync. */
export type ReqType = "epic" | "feature" | "story" | "bug" | "task" | "spike";
export type Phase = "intake" | "shaping" | "building" | "review" | "done" | "archived";
export declare const ADO_TYPE_TO_DCC: Record<string, ReqType>;
/** DCC type → the ADO work-item type name to create (Agile process). */
export declare const DCC_TYPE_TO_ADO: Record<ReqType, string>;
export declare const ADO_STATE_TO_PHASE: Record<string, Phase>;
/** DCC phase → an ADO state to try (Agile). Best-effort; transitions can be rejected. */
export declare const PHASE_TO_ADO_STATE: Record<Phase, string>;
/** DCC task `state` → an ADO state to try (Agile). Best-effort — a plain
 *  "Task" work item only has New/Active/Closed/Removed (no "Resolved"),
 *  while User Story/Feature/Epic also have "Resolved"; a rejected
 *  transition on the narrower Task type is caught and ignored by the
 *  caller, same as every other ADO write in this codebase. */
export declare const TASK_STATE_TO_ADO_STATE: Record<string, string>;
/**
 * The Agile process hierarchy, top down. A requirement never reaches TFS
 * — the TASKS it breaks into do, and the DEPTH of the task tree picks the
 * rungs, anchored at the bottom (the leaves are always Tasks):
 *   depth 1 → Task
 *   depth 2 → User Story, Task
 *   depth 3 → Feature, User Story, Task
 *   depth 4 → Epic, Feature, User Story, Task
 */
export declare const ADO_LADDER: readonly ["Epic", "Feature", "User Story", "Task"];
export declare const MAX_TASK_DEPTH: 4;
/** TFS work-item type for a node at 0-based `level` of a tree `depth` deep. */
export declare function adoTypeForLevel(level: number, depth: number): string;
export declare const mapAdoType: (raw: string) => ReqType;
export declare const mapAdoState: (raw: string) => Phase;
export declare const htmlToText: (s: string) => string;
//# sourceMappingURL=ado-map.d.ts.map