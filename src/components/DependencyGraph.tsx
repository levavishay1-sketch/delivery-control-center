"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

interface GraphNode {
  id: string;
  title: string;
  type: string;
  status: string;
}

interface GraphEdge {
  id: string;
  workItemId: string;
  dependsOnWorkItemId: string;
  reason: string;
}

const NODE_W = 160;
const NODE_H = 44;
const COL_GAP = 220;
const ROW_GAP = 64;

/**
 * Directed dependency graph, laid out left-to-right by topological depth (leaf
 * dependencies on the left, their dependents to the right) with no external graph
 * library — this app has no graph dependency yet and the expected node count per
 * item's connected neighborhood (see getWorkItemDependencyGraph's cap) is small
 * enough that a hand-rolled layered layout + SVG render is simpler than pulling in
 * Cytoscape/D3 for it.
 */
export function DependencyGraph({ nodes, edges, focusNodeId, truncated }: { nodes: GraphNode[]; edges: GraphEdge[]; focusNodeId: string; truncated: boolean }) {
  const [selectedId, setSelectedId] = useState(focusNodeId);
  const [transform, setTransform] = useState({ x: 40, y: 40, scale: 1 });
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { positions } = useMemo(() => layout(nodes, edges), [nodes, edges]);

  const { upstream, downstream } = useMemo(() => {
    const dependsOn = new Map<string, string[]>(); // workItemId -> [dependsOnWorkItemId]
    const dependedOnBy = new Map<string, string[]>(); // dependsOnWorkItemId -> [workItemId]
    for (const e of edges) {
      (dependsOn.get(e.workItemId) ?? dependsOn.set(e.workItemId, []).get(e.workItemId)!).push(e.dependsOnWorkItemId);
      (dependedOnBy.get(e.dependsOnWorkItemId) ?? dependedOnBy.set(e.dependsOnWorkItemId, []).get(e.dependsOnWorkItemId)!).push(e.workItemId);
    }
    return { upstream: bfs(selectedId, dependsOn), downstream: bfs(selectedId, dependedOnBy) };
  }, [selectedId, edges]);

  function nodeColor(id: string) {
    if (id === selectedId) return { fill: "#10b981", text: "#fff" }; // emerald
    if (upstream.has(id)) return { fill: "#3b82f6", text: "#fff" }; // blue
    if (downstream.has(id)) return { fill: "#a855f7", text: "#fff" }; // purple
    return { fill: "var(--graph-node-bg, #e5e7eb)", text: "var(--graph-node-text, #374151)" };
  }

  function nodeOpacity(id: string) {
    return id === selectedId || upstream.has(id) || downstream.has(id) ? 1 : 0.35;
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setTransform((t) => ({ ...t, scale: Math.min(2.5, Math.max(0.3, t.scale + delta)) }));
  }

  function onPointerDown(e: React.PointerEvent) {
    // Only start a pan-drag (and capture the pointer) when the press starts on the
    // svg background itself — capturing on a node's press would redirect its
    // synthesized click event away from the node in some browsers, breaking selection.
    if (e.target !== svgRef.current) return;
    dragState.current = { startX: e.clientX, startY: e.clientY, originX: transform.x, originY: transform.y };
    svgRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setTransform((t) => ({ ...t, x: dragState.current!.originX + dx, y: dragState.current!.originY + dy }));
  }

  function onPointerUp() {
    dragState.current = null;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setTransform((t) => ({ ...t, scale: Math.min(2.5, t.scale + 0.2) }))}
          aria-label="Zoom in"
        >
          +
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setTransform((t) => ({ ...t, scale: Math.max(0.3, t.scale - 0.2) }))}
          aria-label="Zoom out"
        >
          −
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setTransform({ x: 40, y: 40, scale: 1 })}>
          Reset view
        </Button>
        {truncated && <span className="text-xs text-status-warning">Graph truncated — too many connected items to show all.</span>}
      </div>

      <svg
        ref={svgRef}
        viewBox="0 0 600 320"
        className="h-80 w-full touch-none rounded-card border border-border-hairline bg-surface-muted"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        role="img"
        aria-label={`Dependency graph, ${nodes.length} items, ${edges.length} dependencies`}
      >
        <defs>
          <marker id="dep-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="fill-black/40 dark:fill-white/40" />
          </marker>
        </defs>
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {edges.map((e) => {
            const from = positions.get(e.workItemId);
            const to = positions.get(e.dependsOnWorkItemId);
            if (!from || !to) return null;
            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2;
            const midX = (x1 + x2) / 2;
            const dimmed = !(e.workItemId === selectedId || e.dependsOnWorkItemId === selectedId || (upstream.has(e.workItemId) && upstream.has(e.dependsOnWorkItemId)) || (downstream.has(e.workItemId) && downstream.has(e.dependsOnWorkItemId)));
            return (
              <path
                key={e.id}
                d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                fill="none"
                strokeWidth={1.5}
                markerEnd="url(#dep-arrow)"
                className={dimmed ? "stroke-black/15 dark:stroke-white/15" : "stroke-black/40 dark:stroke-white/40"}
              >
                <title>{e.reason}</title>
              </path>
            );
          })}
          {nodes.map((n) => {
            const pos = positions.get(n.id);
            if (!pos) return null;
            const colors = nodeColor(n.id);
            return (
              <g
                key={n.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                opacity={nodeOpacity(n.id)}
                onClick={() => setSelectedId(n.id)}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-label={`${n.title}, ${n.type}, ${n.status}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(n.id);
                  }
                }}
              >
                <rect width={NODE_W} height={NODE_H} rx={6} fill={colors.fill} stroke="currentColor" strokeOpacity={0.15} />
                <title>{`${n.title} — ${n.status}`}</title>
                <text x={8} y={18} fontSize={11} fontWeight={600} fill={colors.text}>
                  {truncate(n.title, 20)}
                </text>
                <text x={8} y={33} fontSize={9} fill={colors.text} opacity={0.85}>
                  {n.type} · {n.status}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="flex flex-wrap gap-3 text-xs opacity-70">
        <Legend color="#10b981" label="Selected" />
        <Legend color="#3b82f6" label="Upstream (depends on)" />
        <Legend color="#a855f7" label="Downstream (depends on this)" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function bfs(startId: string, adjacency: Map<string, string[]>): Set<string> {
  const visited = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

/** Column = longest chain of dependencies from this node down to a leaf (nodes with no deps are column 0). */
function layout(nodes: GraphNode[], edges: GraphEdge[]) {
  const dependsOn = new Map<string, string[]>();
  for (const e of edges) {
    (dependsOn.get(e.workItemId) ?? dependsOn.set(e.workItemId, []).get(e.workItemId)!).push(e.dependsOnWorkItemId);
  }

  const colOf = new Map<string, number>();
  function colFor(id: string, seen: Set<string>): number {
    if (colOf.has(id)) return colOf.get(id)!;
    if (seen.has(id)) return 0; // defensive: pre-existing cycle shouldn't infinite-loop
    seen.add(id);
    const deps = dependsOn.get(id) ?? [];
    const col = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((d) => colFor(d, seen)));
    colOf.set(id, col);
    return col;
  }
  for (const n of nodes) colFor(n.id, new Set());

  const byColumn = new Map<number, string[]>();
  for (const n of nodes) {
    const col = colOf.get(n.id) ?? 0;
    (byColumn.get(col) ?? byColumn.set(col, []).get(col)!).push(n.id);
  }

  const positions = new Map<string, { x: number; y: number; col: number }>();
  for (const [col, ids] of byColumn) {
    ids.forEach((id, row) => {
      positions.set(id, { x: col * COL_GAP, y: row * ROW_GAP, col });
    });
  }

  return { positions, columns: byColumn.size };
}
