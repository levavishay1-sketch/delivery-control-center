"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DependencyGraph } from "@/components/DependencyGraph";
import { PlannerBoard, type PlannerBoardNode } from "@/components/PlannerBoard";

type PlannerNode = PlannerBoardNode;

interface PlannerEdge {
  id: string;
  workItemId: string;
  dependsOnWorkItemId: string;
  reason: string;
}

/** Graph ⇄ Board view switcher for the project-wide Planner (Slice 16). */
export function PlannerView({ nodes, edges, truncated }: { nodes: PlannerNode[]; edges: PlannerEdge[]; truncated: boolean }) {
  const [view, setView] = useState<"graph" | "board">("graph");
  const readyIds = useMemo(() => new Set(nodes.filter((n) => n.readyToStart).map((n) => n.id)), [nodes]);

  if (nodes.length === 0) {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">No work items in this project yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant={view === "graph" ? "primary" : "secondary"} size="sm" onClick={() => setView("graph")}>
          Graph
        </Button>
        <Button variant={view === "board" ? "primary" : "secondary"} size="sm" onClick={() => setView("board")}>
          Board
        </Button>
      </div>

      {view === "graph" ? (
        <DependencyGraph nodes={nodes} edges={edges} focusNodeId="" truncated={truncated} readyIds={readyIds} />
      ) : (
        <PlannerBoard nodes={nodes} />
      )}
    </div>
  );
}
