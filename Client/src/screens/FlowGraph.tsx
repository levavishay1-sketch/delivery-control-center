import { useEffect, useMemo, useState } from "react";
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { getFlow, type FlowData } from "../api.ts";

function layout(nodes: FlowData["nodes"], edges: FlowData["edges"]) {
  const dep = new Map<string, string[]>();
  nodes.forEach((n) => dep.set(n.id, []));
  edges.filter((e) => e.kind !== "spun_off").forEach((e) => dep.get(e.from)?.push(e.to));
  const depth = new Map<string, number>();
  const visit = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const d = (dep.get(id) ?? []).reduce((m, p) => Math.max(m, visit(p, seen) + 1), 0);
    depth.set(id, d);
    return d;
  };
  nodes.forEach((n) => visit(n.id));
  const byLayer = new Map<number, string[]>();
  nodes.forEach((n) => {
    const d = depth.get(n.id) ?? 0;
    (byLayer.get(d) ?? byLayer.set(d, []).get(d)!).push(n.id);
  });
  const pos = new Map<string, { x: number; y: number }>();
  for (const [d, ids] of byLayer) ids.forEach((id, i) => pos.set(id, { x: d * 300, y: i * 140 }));
  return pos;
}

export function FlowGraph({ requirementId }: { requirementId: string }) {
  const [data, setData] = useState<FlowData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getFlow(requirementId).then(setData).catch((e) => setErr(String(e))); }, [requirementId]);

  const { rfNodes, rfEdges } = useMemo(() => {
    if (!data) return { rfNodes: [] as Node[], rfEdges: [] as Edge[] };
    const pos = layout(data.nodes, data.edges);
    const rfNodes: Node[] = data.nodes.map((n) => {
      const blocked = n.openBlockingGaps > 0 || n.openBlockers > 0;
      return {
        id: n.id,
        position: pos.get(n.id) ?? { x: 0, y: 0 },
        data: {
          label: (
            <div style={{ padding: "8px 10px", textAlign: "left" }}>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, color: "#9698b3" }}>
                {n.key ?? "—"} · {n.type} · {n.phase}
                {n.linkedAdoId ? (
                  n.adoUrl
                    ? <> · <a href={n.adoUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#059669" }}>ADO #{n.linkedAdoId} ↗</a></>
                    : ` · ADO #${n.linkedAdoId}`
                ) : ""}
              </div>
              <div style={{ fontWeight: 500, marginTop: 2, fontSize: 12 }}>{n.title}</div>
              {blocked && <div style={{ fontSize: 10, color: "#dc2626", marginTop: 3 }}>{n.openBlockingGaps ? `${n.openBlockingGaps} blocking gap ` : ""}{n.openBlockers ? `${n.openBlockers} blocker` : ""}</div>}
            </div>
          ),
        },
        style: {
          width: 210, borderRadius: 10, padding: 0, fontSize: 12,
          border: `1.5px solid ${blocked ? "#dc2626" : n.phase === "done" ? "#059669" : "#e7e8f2"}`,
          background: blocked ? "#fef2f2" : "#fff", color: "#10122b",
        },
      };
    });
    const rfEdges: Edge[] = data.edges.map((e, i) => ({
      id: `e${i}`, source: e.from, target: e.to,
      label: e.kind === "spun_off" ? "spun off" : e.reason ? "↦ reason" : undefined,
      animated: e.kind === "spun_off",
      style: { stroke: e.kind === "spun_off" ? "#7c3aed" : "#9698b3", strokeDasharray: e.adoSynced ? undefined : "5 4" },
      markerEnd: { type: MarkerType.ArrowClosed, color: e.kind === "spun_off" ? "#7c3aed" : "#9698b3" },
    }));
    return { rfNodes, rfEdges };
  }, [data]);

  if (err) return <div className="empty">{err}</div>;
  if (!data) return <div className="spin">Loading…</div>;
  if (data.nodes.length === 0) return <div className="empty">אין תת-דרישות.</div>;

  return (
    <ReactFlow nodes={rfNodes} edges={rfEdges} fitView nodesDraggable nodesConnectable={false}>
      <Background gap={16} color="#e7e8f2" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
