import { useMemo, useState } from "react";
import { Background, MarkerType, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { TaskFlow, TaskFlowNode } from "../api.ts";
import { Pill } from "../ui.tsx";

/**
 * The FLOW: only TFS-bound tasks ("task" kind — everything that becomes a
 * real work item) get their own card here, laid out left→right by STEP —
 * the longest path through hierarchy + dependency edges, i.e. "how many
 * things have to happen before this can start". "check" nodes (never
 * their own TFS item) are folded into their parent task's card instead of
 * getting a card of their own.
 *
 * Clicking a card opens a floating detail panel; a blocked card's panel
 * additionally explains what's blocking it and how many downstream tasks
 * that holds up.
 */

const COL_W = 268;
const ROW_H = 132;

type Tone = { bg: string; border: string; dot: string; label: string };
const STATE_TONE: Record<string, Tone> = {
  done: { bg: "#EAF7F0", border: "#1B9E5C", dot: "#1B9E5C", label: "הושלם" },
  in_progress: { bg: "#EFF6FF", border: "#2563EB", dot: "#2563EB", label: "בביצוע" },
  blocked: { bg: "#FCE8ED", border: "#E14C6B", dot: "#E14C6B", label: "חסום" },
  ready: { bg: "#EAF6F7", border: "#0E9BA6", dot: "#0E9BA6", label: "מוכן להתחלה" },
  waiting: { bg: "#F5F4FA", border: "#B3B0C9", dot: "#86829C", label: "מתוכנן" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

/** Longest path (0-indexed) through hierarchy + dependency edges — both
 *  "this is inside that" and "this must wait for that" push a node right. */
function computeSteps(nodes: TaskFlowNode[], edges: TaskFlow["edges"]): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const n of nodes) incoming.set(n.id, []);
  for (const e of edges) incoming.get(e.to)?.push(e.from);
  const steps = new Map<string, number>();
  const inStack = new Set<string>();
  const stepOf = (id: string): number => {
    if (steps.has(id)) return steps.get(id)!;
    if (inStack.has(id)) return 0; // cycle guard — shouldn't happen, never hang
    inStack.add(id);
    const preds = incoming.get(id) ?? [];
    const s = preds.length === 0 ? 0 : Math.max(...preds.map((p) => stepOf(p))) + 1;
    inStack.delete(id);
    steps.set(id, s);
    return s;
  };
  for (const n of nodes) stepOf(n.id);
  return steps;
}

/** Blocked = a predecessor ("depends" edge) hasn't finished, or the task
 *  was explicitly marked blocked. Same rule TaskDetail uses. */
function blockersOf(node: TaskFlowNode, byId: Map<string, TaskFlowNode>, edges: TaskFlow["edges"]) {
  const preds = edges.filter((e) => e.kind === "depends" && e.to === node.id);
  return preds.map((e) => ({ node: byId.get(e.from), reason: e.reason })).filter((b): b is { node: TaskFlowNode; reason: string | null } => !!b.node && b.node.state !== "done");
}

/** How many nodes downstream (transitively) wait on this one — the honest
 *  version of "impact": a real count, not a made-up deadline. */
function downstreamCount(id: string, edges: TaskFlow["edges"]): number {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of edges) {
      if (e.from === cur && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
    }
  }
  return seen.size;
}

function toneOf(node: TaskFlowNode, isBlocked: boolean): Tone {
  if (node.state === "done") return STATE_TONE.done!;
  if (node.state === "in_progress") return STATE_TONE.in_progress!;
  if (isBlocked || node.state === "blocked") return STATE_TONE.blocked!;
  return node.approved ? STATE_TONE.ready! : STATE_TONE.waiting!;
}

function Card({ node, tone, onClick }: { node: TaskFlowNode; tone: Tone; onClick: () => void }) {
  const idLabel = node.linkedAdoId ? `#${node.linkedAdoId}` : `הצעה #${node.seq}`;
  const doneChecks = node.checks.filter((c) => c.state === "done").length;
  return (
    <div
      onClick={onClick}
      style={{
        width: COL_W - 24, borderRadius: 12, padding: "11px 13px", cursor: "pointer",
        background: tone.bg, border: `1.5px solid ${tone.border}`, direction: "rtl", textAlign: "start",
        boxShadow: "0 1px 2px rgb(27 23 65 / 0.06)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: tone.border }}>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: tone.dot, display: "inline-block" }} />
          {tone.label}
        </span>
        <span style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--ink-500)", direction: "ltr" }}>{idLabel}</span>
      </div>
      <div style={{
        fontWeight: 650, fontSize: 12.5, lineHeight: 1.4, color: "var(--ink-900)",
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", marginBottom: 5,
      }}>{node.intent}</div>
      <div style={{ fontSize: 10.5, color: "var(--ink-500)", marginBottom: node.checks.length ? 6 : 0, display: "flex", justifyContent: "space-between" }}>
        <span>{node.adoType ?? "Task"} · {node.appetite} · {node.origin === "ai" ? "🤖 AI" : "👤 אדם"}</span>
        {(node.adoSyncedAt || node.approvedAt) && <span>{fmtDate(node.adoSyncedAt ?? node.approvedAt)}</span>}
      </div>
      {node.checks.length > 0 && (
        <div style={{ fontSize: 10, color: "var(--ink-500)", display: "flex", alignItems: "center", gap: 4, borderTop: `1px solid ${tone.border}22`, paddingTop: 6 }}>
          <span>☑</span><span>{doneChecks}/{node.checks.length} בדיקות</span>
        </div>
      )}
    </div>
  );
}

function Detail({ node, tone, blockers, downstream, nav, onClose, onJump }: {
  node: TaskFlowNode; tone: Tone; blockers: { node: TaskFlowNode; reason: string | null }[]; downstream: number;
  nav: (h: string) => void; onClose: () => void; onJump: (id: string) => void;
}) {
  const blocked = blockers.length > 0 || node.state === "blocked";
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgb(27 23 65 / 0.45)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 1000,
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(680px, 92vw)", maxHeight: "88vh", overflowY: "auto", background: tone.bg,
          border: `1.5px solid ${tone.border}`, borderRadius: 16, padding: "24px 28px", direction: "rtl", textAlign: "start",
          boxShadow: "0 8px 24px rgb(27 23 65 / 0.15), 0 24px 64px rgb(27 23 65 / 0.25)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 700, color: tone.border }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: tone.dot, display: "inline-block" }} />
            {blocked ? "חסום — לא ניתן להתקדם כרגע" : tone.label}
          </span>
          <a onClick={onClose} title="סגור" style={{
            fontSize: 15, color: "var(--ink-500)", cursor: "pointer", width: 30, height: 30, display: "flex",
            alignItems: "center", justifyContent: "center", borderRadius: 99, background: "var(--surface)",
          }}>✕</a>
        </div>
        <p style={{ fontWeight: 700, fontSize: 18, lineHeight: 1.4, marginBottom: 6 }}>{node.intent}</p>
        <p style={{ fontSize: 13, color: "var(--ink-500)", marginBottom: 18 }}>
          {node.adoType ?? "Task"} · {node.appetite} · {node.linkedAdoId ? `TFS #${node.linkedAdoId}` : "טרם הוקם ב-TFS"}
        </p>

        {blocked && (
          <div style={{ background: "var(--surface)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            {blockers.length > 0 ? blockers.map((b) => (
              <div key={b.node.id} style={{ marginBottom: 12 }}>
                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 3 }}>מי חוסם?</p>
                    <a onClick={() => onJump(b.node.id)} style={{ fontSize: 14, cursor: "pointer" }}>
                      {b.node.linkedAdoId ? `#${b.node.linkedAdoId}` : `הצעה #${b.node.seq}`} — {b.node.intent.slice(0, 60)}
                    </a>
                  </div>
                  <div>
                    <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 3 }}>מה צריך לקרות?</p>
                    <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>{b.reason || `להשלים את "${b.node.intent.slice(0, 50)}" (כרגע: ${b.node.state === "in_progress" ? "בביצוע" : "טרם התחיל"})`}</p>
                  </div>
                </div>
              </div>
            )) : (
              <p style={{ fontSize: 13.5 }}>המשימה סומנה כחסומה ידנית.</p>
            )}
            {downstream > 0 && (
              <p style={{ fontSize: 12.5, color: "var(--status-critical)", marginTop: 6 }}>
                השפעה: {downstream} משימות בהמשך ה-flow ממתינות לפתיחת החסימה הזו.
              </p>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              {blockers[0] && (
                <a onClick={() => onJump(blockers[0]!.node.id)} className="btn btn-secondary btn-sm">פתח גורם חוסם</a>
              )}
            </div>
          </div>
        )}

        {node.prompt && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 5 }}>הפרומט</p>
            <p style={{ fontSize: 13.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{node.prompt}</p>
          </div>
        )}
        {node.affectedPaths.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 5 }}>קבצים צפויים</p>
            <p style={{ fontFamily: "var(--mono)", fontSize: 12.5, direction: "ltr", textAlign: "left", lineHeight: 1.7 }}>{node.affectedPaths.join(", ")}</p>
          </div>
        )}
        {node.checks.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 6 }}>רשימת בדיקה ({node.checks.filter((c) => c.state === "done").length}/{node.checks.length})</p>
            {node.checks.map((c) => (
              <p key={c.id} style={{ fontSize: 13.5, margin: "4px 0", textDecoration: c.state === "done" ? "line-through" : "none", color: c.state === "done" ? "var(--ink-400)" : "var(--ink-700)" }}>
                {c.state === "done" ? "☑" : "☐"} {c.intent}
              </p>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${tone.border}33` }}>
          <button className="btn btn-primary" onClick={() => nav(`#/task/${node.id}`)}>פתח את מסך המשימה ←</button>
          <button className="btn btn-secondary" onClick={onClose}>סגור</button>
        </div>
      </div>
    </div>
  );
}

export function TaskGraph({ flow, height = 420, nav }: { flow: TaskFlow; height?: number; nav: (h: string) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(flow.nodes.map((n) => [n.id, n])), [flow.nodes]);

  const { rfNodes, rfEdges, steps, stats } = useMemo(() => {
    const steps = computeSteps(flow.nodes, flow.edges);
    const byStep = new Map<number, TaskFlowNode[]>();
    for (const n of flow.nodes) {
      const s = steps.get(n.id) ?? 0;
      (byStep.get(s) ?? byStep.set(s, []).get(s)!).push(n);
    }

    const pos = new Map<string, { x: number; y: number }>();
    for (const [s, list] of byStep) list.forEach((n, i) => pos.set(n.id, { x: s * COL_W, y: i * ROW_H }));

    const rfNodes: Node[] = flow.nodes.map((n) => {
      const blocked = blockersOf(n, byId, flow.edges).length > 0 || n.state === "blocked";
      const tone = toneOf(n, blocked);
      return {
        id: n.id,
        position: pos.get(n.id) ?? { x: 0, y: 0 },
        draggable: false,
        data: { label: <Card node={n} tone={tone} onClick={() => setOpenId(n.id)} /> },
        style: { width: COL_W - 24, padding: 0, border: "none", background: "transparent" },
      };
    });

    const rfEdges: Edge[] = flow.edges.map((e, i) => {
      const isBlocking = e.kind === "depends" && byId.get(e.to)?.state !== "done" && byId.get(e.from)?.state !== "done";
      return {
        id: `e${i}`, source: e.from, target: e.to, animated: false,
        style: isBlocking
          ? { stroke: "var(--status-critical)", strokeWidth: 1.5, strokeDasharray: "5 4" }
          : { stroke: "#9698b3", strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: isBlocking ? "var(--status-critical)" : "#9698b3" },
      };
    });

    const stats = {
      total: flow.nodes.length,
      done: flow.nodes.filter((n) => n.state === "done").length,
      inProgress: flow.nodes.filter((n) => n.state === "in_progress").length,
      blocked: flow.nodes.filter((n) => blockersOf(n, byId, flow.edges).length > 0 || n.state === "blocked").length,
      deps: flow.edges.filter((e) => e.kind === "depends").length,
    };

    return { rfNodes, rfEdges, steps, stats };
  }, [flow, byId]);

  if (flow.nodes.length === 0) return <div className="empty">אין משימות TFS עדיין — בדיקות/משימות פנימיות לא מופיעות כאן, רק מה שהופך לפריט TFS.</div>;

  const colCount = Math.max(...steps.values(), 0) + 1;
  const open = openId ? byId.get(openId) : null;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <Pill tone="inactive">{stats.total} משימות</Pill>
        <Pill tone="inactive">{stats.deps} תלויות</Pill>
        <Pill tone="active">{stats.inProgress} בביצוע</Pill>
        <Pill tone={stats.blocked ? "critical" : "inactive"}>{stats.blocked} חסומות</Pill>
        <Pill tone="healthy">{stats.done} הושלמו</Pill>
      </div>

      <div style={{ display: "flex", marginBottom: 6, paddingInlineStart: 4 }}>
        {Array.from({ length: colCount }, (_, i) => (
          <div key={i} style={{ width: COL_W, fontSize: 11, fontWeight: 650, color: "var(--ink-500)" }}>שלב {i + 1}</div>
        ))}
      </div>

      <div style={{ position: "relative", height, border: "1px solid var(--border-hairline)", borderRadius: 10, overflow: "hidden", background: "var(--surface)" }}>
        <ReactFlow
          nodes={rfNodes} edges={rfEdges} nodesDraggable={false} nodesConnectable={false}
          onNodeClick={(_, n) => setOpenId(n.id)}
          panOnDrag zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }}
          defaultViewport={{ x: 20, y: 20, zoom: 1 }}
        >
          <Background gap={16} color="#e7e8f2" />
        </ReactFlow>
        {open && (
          <Detail
            node={open} tone={toneOf(open, blockersOf(open, byId, flow.edges).length > 0)}
            blockers={blockersOf(open, byId, flow.edges)} downstream={downstreamCount(open.id, flow.edges)}
            nav={nav} onClose={() => setOpenId(null)} onJump={(id) => setOpenId(id)}
          />
        )}
      </div>
      <p style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 6 }}>
        קו אפור = סדר/היררכיה · קו אדום מקווקו = חסימה בפועל · בדיקות פנימיות לא מקבלות כרטיס משלהן — הן מופיעות בתוך כרטיס המשימה שלהן.
      </p>
    </div>
  );
}
