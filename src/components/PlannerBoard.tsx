import Link from "next/link";
import { PanelEmpty } from "@/components/ui/Panel";

export interface PlannerBoardNode {
  id: string;
  title: string;
  type: string;
  status: string;
  readyToStart: boolean;
}

const STATUS_ORDER = ["DRAFT", "OPEN", "IN_PROGRESS", "DECISION_REQUIRED", "BLOCKED", "REVIEW", "APPROVED", "COMPLETED", "CLOSED"];

/** Read-only status-lane board — Slice 16's Planner Board view. No drag-and-drop: status changes stay the WorkItem's own action. */
export function PlannerBoard({ nodes }: { nodes: PlannerBoardNode[] }) {
  if (nodes.length === 0) {
    return <PanelEmpty>No work items in this project yet.</PanelEmpty>;
  }

  const lanes = STATUS_ORDER.map((status) => ({ status, items: nodes.filter((n) => n.status === status) })).filter(
    (lane) => lane.items.length > 0
  );

  return (
    <div className="flex gap-3 overflow-x-auto pb-2" aria-label="Status board">
      {lanes.map((lane) => (
        <div key={lane.status} className="flex w-56 shrink-0 flex-col gap-2 rounded-card border border-border-hairline bg-surface-muted p-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {lane.status} ({lane.items.length})
          </p>
          <div className="flex flex-col gap-2">
            {lane.items.map((item) => (
              <Link
                key={item.id}
                href={`/work-items/${item.id}/360`}
                className="rounded-md border border-border-hairline bg-surface p-2 text-xs hover:bg-surface-muted"
              >
                <p className="font-medium text-foreground">{item.title}</p>
                <div className="mt-1 flex items-center justify-between text-neutral-500 dark:text-neutral-400">
                  <span>{item.type}</span>
                  {item.readyToStart && <span className="text-status-healthy">● Ready</span>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
