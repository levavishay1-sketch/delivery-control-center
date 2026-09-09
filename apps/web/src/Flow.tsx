import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type FlowNode = {
  id: string; key: string | null; title: string; phase: string; level: string;
  openBlockingGaps: number; openBlockers: number; linkedAdoId: number | null;
};
type FlowEdge = { from: string; to: string; kind: string; reason: string | null; adoSynced: boolean };

/** Layered layout: x by topological depth of `depends-on`, y by order within a layer. */
function layout(nodes: FlowNode[], edges: FlowEdge[]) {
  const dep = new Map<string, string[]>(); // id -> ids it depends on
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
  for (const [d, ids] of byLayer) ids.forEach((id, i) => pos.set(id, { x: d * 300, y: i * 150 }));
  return pos;
}

const C = {
  ai: "#a2660c", crit: "#9c382c", critBg: "#fae9e6", ok: "#2a6b4c",
  ink: "#15181c", ink3: "#767d88", rule: "#cbd0d7", surface: "#fff", sunk: "#f0f2f5",
};

export function Flow({ projectId }: { projectId: string }) {
  const [data, setData] = useState<{ nodes: FlowNode[]; edges: FlowEdge[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/flow`)
      .then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(t))))
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, [projectId]);

  const { rfNodes, rfEdges } = useMemo(() => {
    if (!data) return { rfNodes: [] as Node[], rfEdges: [] as Edge[] };
    const pos = layout(data.nodes, data.edges);
    const rfNodes: Node[] = data.nodes.map((n) => {
      const blocked = n.openBlockingGaps > 0 || n.openBlockers > 0;
      return {
        id: n.id,
        position: pos.get(n.id) ?? { x: 0, y: 0 },
        data: { label: nodeLabel(n, blocked) },
        style: {
          width: 220, borderRadius: 6, padding: 0, fontSize: 12,
          border: `1.5px solid ${blocked ? C.crit : n.phase === "done" ? C.ok : C.rule}`,
          background: blocked ? C.critBg : C.surface, color: C.ink,
        },
      };
    });
    const rfEdges: Edge[] = data.edges.map((e, i) => ({
      id: `e${i}`,
      source: e.from,
      target: e.to,
      label: e.kind === "spun_off" ? "spun off" : e.reason ? "↦ reason" : undefined,
      animated: e.kind === "spun_off",
      style: { stroke: e.kind === "spun_off" ? C.ai : C.ink3, strokeDasharray: e.adoSynced ? undefined : "5 4" },
      markerEnd: { type: MarkerType.ArrowClosed, color: e.kind === "spun_off" ? C.ai : C.ink3 },
    }));
    return { rfNodes, rfEdges };
  }, [data]);

  if (err) return <div style={{ padding: 18, color: C.crit, fontFamily: "monospace", fontSize: 12 }}>{err}</div>;
  if (!data) return <div style={{ padding: 18, color: C.ink3 }}>טוען…</div>;
  if (data.nodes.length === 0) return <div style={{ padding: 18, color: C.ink3 }}>אין WorkItems בפרויקט.</div>;

  return (
    <div style={{ position: "absolute", inset: 0, direction: "ltr" }}>
      <ReactFlow nodes={rfNodes} edges={rfEdges} fitView nodesDraggable nodesConnectable={false}>
        <Background gap={16} color="#e1e4e9" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div style={{ position: "absolute", bottom: 8, insetInlineStart: 8, fontFamily: "monospace", fontSize: 10, color: C.ink3, background: "rgba(255,255,255,.85)", padding: "4px 8px", borderRadius: 4, direction: "rtl" }}>
        קו מלא = מסונכרן ל-ADO · מקווקו = לא · כתום = הופרד מ-Gap · אדום = חוסם פתוח
      </div>
    </div>
  );
}

function nodeLabel(n: FlowNode, blocked: boolean) {
  return (
    <div style={{ padding: "8px 10px", textAlign: "start" }}>
      <div style={{ fontFamily: "monospace", fontSize: 10, color: C.ink3 }}>
        {n.key ?? "—"} · {n.phase}{n.linkedAdoId ? ` · ADO #${n.linkedAdoId}` : ""}
      </div>
      <div style={{ fontWeight: 500, marginTop: 2 }}>{n.title}</div>
      {blocked && (
        <div style={{ fontSize: 10, color: C.crit, marginTop: 3 }}>
          {n.openBlockingGaps > 0 && `${n.openBlockingGaps} gap חוסם `}
          {n.openBlockers > 0 && `${n.openBlockers} blocker`}
        </div>
      )}
    </div>
  );
}
