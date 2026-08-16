import { Boxes, ListTodo, Bug, GitPullRequestArrow } from "lucide-react";
import type { ComponentType } from "react";

export type WorkItemTypeValue = "PROJECT" | "TASK" | "BUG" | "CHANGE";

/**
 * Categorical (identity) colors for work-item type — distinct from the five
 * status colors in globals.css (validated with the dataviz skill's palette
 * checker: lightness band, chroma floor, CVD separation, and normal-vision
 * floor all pass in both light and dark against this app's actual surfaces).
 * Never implies health/risk — that's the status-tone system's job.
 */
export const WORK_ITEM_TYPE_TONES: Record<WorkItemTypeValue, { icon: ComponentType<{ className?: string }>; gradientVar: string; glowVar: string }> = {
  PROJECT: { icon: Boxes, gradientVar: "--gradient-type-project", glowVar: "--shadow-glow-type-project" },
  TASK: { icon: ListTodo, gradientVar: "--gradient-type-task", glowVar: "--shadow-glow-type-task" },
  BUG: { icon: Bug, gradientVar: "--gradient-type-bug", glowVar: "--shadow-glow-type-bug" },
  CHANGE: { icon: GitPullRequestArrow, gradientVar: "--gradient-type-change", glowVar: "--shadow-glow-type-change" },
};
