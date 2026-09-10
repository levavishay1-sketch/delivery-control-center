import { useMemo } from "react";
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { TaskFlow } from "../api.ts";

/**
 * The task tree of one requirement. Hierarchy runs left→right by level
 * (the level is what picked the TFS type off the Agile ladder); dependency
 * edges are dashed and purple so ordering reads apart from hierarchy.
 */

const TYPE_TONE: Record<string, { bg: string; border: string }> = {
  Epic: { bg: "#f5f3ff", border: "#7c3aed" },
  Feature: { bg: "#eff6ff", border: "#2563eb" },
  "User Story": { bg: "#f0fdf4", border: "#059669" },
  Task: { bg: "#ffffff", border: "#c9cade" },
};
// a "check" is never its own TFS item — folded into its parent task's
// Discussion instead, so it gets a distinct neutral/dashed look, not a
// ladder-type color.
const CHECK_TONE = { bg: "#F5F4FA", border: "#B3B0C9" };

export function TaskGraph({ flow, height = 380 }: { flow: TaskFlow; height?: number }) {
  const { rfNodes, rfEdges } = useMemo(() => {
    const byLevel = new Map<number, string[]>();
    for (const n of flow.nodes) {
      const arr = byLevel.get(n.level) ?? [];
      arr.push(n.id);
      byLevel.set(n.level, arr);
    }
    const pos = new Map<string, { x: number; y: number }>();
    for (const [lvl, ids] of byLevel) ids.forEach((id, i) => pos.set(id, { x: lvl * 260, y: i * 96 }));

    const rfNodes: Node[] = flow.nodes.map((n) => {
      const isCheck = n.kind === "check";
      const tone = isCheck ? CHECK_TONE : TYPE_TONE[n.adoType ?? "Task"] ?? TYPE_TONE.Task!;
      return {
        id: n.id,
        position: pos.get(n.id) ?? { x: 0, y: 0 },
        data: {
          label: (
            <div style={{ padding: "8px 10px", textAlign: "start", direction: "rtl" }}>
              <div style={{ fontSize: 10, color: "#6b6d8a", display: "flex", gap: 6, justifyContent: "space-between" }}>
                <span style={{ fontFamily: "ui-monospace, monospace" }}>#{n.seq}</span>
                <span style={{ fontWeight: 600, direction: "ltr" }}>{isCheck ? "✓ בדיקה" : n.adoType ?? "Task"}</span>
              </div>
              <div title={n.intent} style={{
                fontWeight: 500, marginTop: 3, fontSize: 11.5, lineHeight: 1.4,
                display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
              }}>{n.intent}</div>
              <div style={{ fontSize: 9.5, color: "#6b6d8a", marginTop: 4, display: "flex", gap: 6 }}>
                <span>{n.appetite}</span>
                {isCheck
                  ? (n.linkedAdoId ? <span style={{ color: "#059669" }}>תועד ב-Discussion</span> : n.approved ? <span style={{ color: "#2563eb" }}>מאושר</span> : <span style={{ color: "#b45309" }}>ממתין</span>)
                  : n.linkedAdoId
                    ? <span style={{ color: "#059669" }}>TFS #{n.linkedAdoId}</span>
                    : n.approved ? <span style={{ color: "#2563eb" }}>מאושר</span> : <span style={{ color: "#b45309" }}>ממתין</span>}
              </div>
            </div>
          ),
        },
        style: {
          width: 210, borderRadius: 10, padding: 0, fontSize: 12,
          border: `1.5px ${n.approved ? (isCheck ? "dashed" : "solid") : "dashed"} ${tone.border}`,
          background: tone.bg, color: "#10122b",
        },
      };
    });

    const rfEdges: Edge[] = flow.edges.map((e, i) => ({
      id: `e${i}`, source: e.from, target: e.to,
      animated: false,
      style: e.kind === "parent"
        ? { stroke: "#9698b3", strokeWidth: 1.5 }
        : { stroke: "#7c3aed", strokeWidth: 1.5, strokeDasharray: "5 4" },
      markerEnd: { type: MarkerType.ArrowClosed, color: e.kind === "parent" ? "#9698b3" : "#7c3aed" },
    }));
    return { rfNodes, rfEdges };
  }, [flow]);

  if (flow.nodes.length === 0) return <div className="empty">אין משימות.</div>;

  return (
    <div>
      <div style={{ height, border: "1px solid var(--border-hairline)", borderRadius: 10, overflow: "hidden" }}>
        <ReactFlow nodes={rfNodes} edges={rfEdges} fitView nodesDraggable nodesConnectable={false} proOptions={{ hideAttribution: true }}>
          <Background gap={16} color="#e7e8f2" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 6 }}>
        קו אפור = היררכיה · קו סגול מקווקו = תלות (מה חייב להסתיים קודם) · מסגרת מקווקוות = טרם אושר · תיבה אפורה "✓ בדיקה" = לא הופכת ל-work item, מתועדת בהדיסקשן של המשימה שלה
      </p>
    </div>
  );
}
