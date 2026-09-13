import { useMemo, useState } from "react";
import { BaseEdge, Controls, MarkerType, Position, ReactFlow, type Edge, type EdgeProps, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { TaskFlow, TaskFlowNode } from "../api.ts";
import { CopyBtn } from "../ui.tsx";

/** The one permitted connector shape (spec, 2026-09-12): a symmetric cubic
 *  Bézier meeting at the horizontal midpoint — `C m y1, m y2, x2 y2`. Never
 *  React Flow's own default curvature, which is an internal, unaudited
 *  algorithm this doesn't rely on. sourceX/Y and targetX/Y are React
 *  Flow's own measured handle positions (right-center of the source card,
 *  left-center of the target), so this still tracks real card geometry —
 *  including size changes — without hand-rolling DOM measurement. */
function DependencyEdge({ sourceX, sourceY, targetX, targetY, style, markerEnd }: EdgeProps) {
  const m = (sourceX + targetX) / 2;
  return <BaseEdge path={`M ${sourceX},${sourceY} C ${m},${sourceY} ${m},${targetY} ${targetX},${targetY}`} style={style} markerEnd={markerEnd} />;
}
const edgeTypes = { dependency: DependencyEdge };

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

/* Design-system spec (2026-09-12): 205px column, 54px between columns,
 * 18px between cards in one column. Cards are absolutely positioned (not
 * flexbox), so the column stride bakes the inter-column gap in, and the
 * row stride bakes the inter-card gap in. */
const LAYER_W = 205;
const LAYER_GAP = 54;
const COL_W = LAYER_W + LAYER_GAP;
const CARD_MIN_H = 122;
const ROW_GAP = 18;
const ROW_H = CARD_MIN_H + ROW_GAP;

type Tone = { key: string; bg: string; border: string; label: string };
const STATE_TONE: Record<string, Tone> = {
  done: { key: "done", bg: "#f8fdfa", border: "#13835b", label: "הושלם" },
  in_progress: { key: "in_progress", bg: "#fff", border: "#246fce", label: "בביצוע" },
  blocked: { key: "blocked", bg: "#fff8f8", border: "#c93b3b", label: "חסום" },
  decision: { key: "decision", bg: "#fffaf0", border: "#ba7208", label: "ממתין להחלטה" },
  ready: { key: "ready", bg: "#fff", border: "#5556e8", label: "מוכן להתחלה" },
  waiting: { key: "waiting", bg: "#fff", border: "#98a2b3", label: "מתוכנן" },
  inactive: { key: "inactive", bg: "#f3f3f5", border: "#b6b8c2", label: "לא פעיל" },
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
  // inactive overrides every other reading — a deactivated task is, by
  // design, treated as gone from the Flow (see setTaskActive), which the
  // tone needs to say louder than whatever its last real state was.
  if (!node.active) return STATE_TONE.inactive!;
  if (node.state === "done") return STATE_TONE.done!;
  if (node.state === "in_progress") return STATE_TONE.in_progress!;
  if (isBlocked || node.state === "blocked") return STATE_TONE.blocked!;
  // "ready to start" reads the real TFS link, not the DCC-side approval
  // flag — "מאושר, טרם הוקם ב-TFS" was retired as its own status; approved
  // but not yet materialized reads as "waiting" until the link exists.
  return node.linkedAdoId ? STATE_TONE.ready! : STATE_TONE.waiting!;
}

function Badge({ tone }: { tone: Tone }) {
  return <span className={`flow-badge ${tone.key}`}><i />{tone.label}</span>;
}

function Card({ node, tone, onClick }: { node: TaskFlowNode; tone: Tone; onClick: () => void }) {
  const idLabel = node.linkedAdoId ? `#${node.linkedAdoId}` : `הצעה #${node.seq}`;
  const doneChecks = node.checks.filter((c) => c.state === "done").length;
  return (
    <div className={`flow-node ${tone.key}`} onClick={onClick} style={{ width: LAYER_W, direction: "rtl", opacity: node.active ? 1 : 0.6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <Badge tone={tone} />
        {node.adoUrl
          ? <a href={node.adoUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--status-healthy)", direction: "ltr" }}>{idLabel} ↗</a>
          : <span style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--ink-500)", direction: "ltr" }}>{idLabel}</span>}
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
        <div style={{ fontSize: 10, color: "var(--ink-500)", display: "flex", alignItems: "center", gap: 4, borderTop: "1px solid var(--divider)", paddingTop: 6 }}>
          <span>☑</span><span>{doneChecks}/{node.checks.length} בדיקות</span>
        </div>
      )}
    </div>
  );
}

function Detail({ node, tone, blockers, downstream, nav, onClose, onJump, onApprove, approving, onToggleActive, togglingActive }: {
  node: TaskFlowNode; tone: Tone; blockers: { node: TaskFlowNode; reason: string | null }[]; downstream: number;
  nav: (h: string) => void; onClose: () => void; onJump: (id: string) => void;
  onApprove?: (id: string) => void; approving?: boolean;
  onToggleActive?: (id: string, active: boolean) => void; togglingActive?: boolean;
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
          border: `1px solid #e5e8ef`, borderInlineStart: `5px solid ${tone.border}`,
          borderRadius: 16, padding: "24px 28px", direction: "rtl", textAlign: "start",
          boxShadow: "0 8px 24px rgb(27 23 65 / 0.15), 0 24px 64px rgb(27 23 65 / 0.25)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          {blocked ? (
            <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 700, color: tone.border }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: tone.border, display: "inline-block" }} />
              חסום — לא ניתן להתקדם כרגע
            </span>
          ) : <Badge tone={tone} />}
          <a onClick={onClose} title="סגור" style={{
            fontSize: 15, color: "var(--ink-500)", cursor: "pointer", width: 30, height: 30, display: "flex",
            alignItems: "center", justifyContent: "center", borderRadius: 99, background: "var(--surface)",
          }}>✕</a>
        </div>
        <p style={{ fontWeight: 700, fontSize: 18, lineHeight: 1.4, marginBottom: 6 }}>{node.intent}</p>
        {!node.active && (
          <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 10 }}>
            ⚪ לא פעילה — לא בFlow ולא בתלויות, ההיסטוריה נשארת.
          </p>
        )}
        <p style={{ fontSize: 13, color: "var(--ink-500)", marginBottom: 18 }}>
          {node.adoType ?? "Task"} · {node.appetite} ·{" "}
          {node.linkedAdoId
            ? (node.adoUrl ? <a href={node.adoUrl} target="_blank" rel="noreferrer" style={{ color: "var(--status-healthy)" }}>TFS #{node.linkedAdoId} ↗</a> : `TFS #${node.linkedAdoId}`)
            : "טרם הוקם ב-TFS"}
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
                    {b.node.adoUrl && <a href={b.node.adoUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, marginInlineStart: 8, color: "var(--status-healthy)" }}>↗ TFS</a>}
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
              <p style={{ fontSize: 12.5, color: "#c93b3b", marginTop: 6 }}>
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
              <p style={{ fontSize: 11.5, color: "var(--ink-500)", margin: 0 }}>הפרומט</p>
              <CopyBtn text={node.prompt} />
            </div>
            <p style={{ fontSize: 13.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{node.prompt}</p>
          </div>
        )}
        {node.affectedPaths.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 5 }}>קבצים צפויים</p>
            <p style={{ fontFamily: "var(--mono)", fontSize: 12.5, direction: "ltr", textAlign: "left", lineHeight: 1.7 }}>{node.affectedPaths.join(", ")}</p>
          </div>
        )}
        {node.compiledComponents.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 5 }}>רכיבים מתקמפלים</p>
            <p style={{ fontFamily: "var(--mono)", fontSize: 12.5, direction: "ltr", textAlign: "left", lineHeight: 1.7 }}>{node.compiledComponents.join(", ")}</p>
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
        <div style={{ display: "flex", gap: 10, marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--divider)" }}>
          {!node.approved && onApprove && (
            <button className="btn btn-primary" disabled={approving} onClick={() => onApprove(node.id)}>
              {approving ? "מאשר…" : "✓ אישור הקמת משימה"}
            </button>
          )}
          <button className={node.approved || !onApprove ? "btn btn-primary" : "btn btn-secondary"} onClick={() => nav(`#/task/${node.id}`)}>פתח את מסך המשימה ←</button>
          {onToggleActive && (
            <button className="btn btn-secondary" disabled={togglingActive} onClick={() => onToggleActive(node.id, !node.active)}>
              {togglingActive ? "מעדכן…" : node.active ? "◻ השבת" : "☐ הפעל מחדש"}
            </button>
          )}
          <button className="btn btn-secondary" onClick={onClose}>סגור</button>
        </div>
      </div>
    </div>
  );
}

export function TaskGraph({ flow, height = 420, nav, title, subtitle, onApprove, approvingId, onToggleActive, togglingActiveId, zoomable, workitemId }: {
  flow: TaskFlow; height?: number; nav: (h: string) => void; title?: string; subtitle?: string;
  /** Reachable from the floating Detail popup — same "אישור הקמת משימה"
   *  action as the approve step's own row list, so approving doesn't
   *  require leaving the popup first. */
  onApprove?: (id: string) => void; approvingId?: string | null;
  /** Deactivate/reactivate directly from the popup — greys the card,
   *  drops it from edges/dependency computation, cascades to children. */
  onToggleActive?: (id: string, active: boolean) => void; togglingActiveId?: string | null;
  /** Scroll/pinch zoom + visible +/−/fit controls. Off by default — the
   *  embedded, in-context views (inside a requirement's own page) keep
   *  today's behavior unless a caller opts in (the full-page Flow view
   *  always does). */
  zoomable?: boolean;
  /** When set (and a title/subtitle header is shown), the header gets a
   *  link to open this requirement's Flow full-page, in a new tab. */
  workitemId?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(flow.nodes.map((n) => [n.id, n])), [flow.nodes]);

  const { rfNodes, rfEdges, steps, stats } = useMemo(() => {
    // Stage/column is a SCHEDULE position — it must answer "what real work
    // has to finish before this can start", nothing else. "parent" edges
    // are Work Breakdown Structure (this task belongs under that story),
    // not a predecessor relationship, and were pushing a task to a later
    // stage purely because of where it sits in the hierarchy — not because
    // anything downstream of it. Two independent, unblocked tasks belong
    // in the same starting stage even if one happens to be nested deeper.
    const steps = computeSteps(flow.nodes, flow.edges.filter((e) => e.kind === "depends"));
    const byStep = new Map<number, TaskFlowNode[]>();
    for (const n of flow.nodes) {
      const s = steps.get(n.id) ?? 0;
      (byStep.get(s) ?? byStep.set(s, []).get(s)!).push(n);
    }

    const pos = new Map<string, { x: number; y: number }>();
    for (const [s, list] of byStep) list.forEach((n, i) => pos.set(n.id, { x: s * COL_W, y: i * ROW_H }));

    // Computed once, shared by card tone AND arrow color — an arrow into a
    // blocked task must be red for exactly the tasks whose card is red,
    // never a separate "is either end unfinished" heuristic.
    const blockedSet = new Set(
      flow.nodes.filter((n) => blockersOf(n, byId, flow.edges).length > 0 || n.state === "blocked").map((n) => n.id),
    );

    const rfNodes: Node[] = flow.nodes.map((n) => {
      const tone = toneOf(n, blockedSet.has(n.id));
      return {
        id: n.id,
        position: pos.get(n.id) ?? { x: 0, y: 0 },
        draggable: false,
        // the canvas is forced LTR (stage 1→N left→right) regardless of the
        // page's own direction, so the connector must leave a card's RIGHT
        // edge and arrive at the next one's LEFT edge — React Flow's
        // default (bottom→top) is what produced the looping arcs above the
        // cards instead of a flat S-curve between them.
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: { label: <Card node={n} tone={tone} onClick={() => setOpenId(n.id)} /> },
        style: { width: LAYER_W, padding: 0, border: "none", background: "transparent" },
      };
    });

    // "parent" edges (hierarchy — this task is a subtask of that one) feed
    // computeSteps() above so a subtask still lands a column after its
    // parent, but they are not a dependency and were never meant to be a
    // visible arrow — drawing them alongside "depends" edges is exactly
    // what read as duplicate/unexplained arrows. Also: exactly one path per
    // (source, target) pair, and only when both ends actually have a card
    // rendered — a dependency on a folded-in "check" node, or on anything
    // filtered out of `flow.nodes`, draws nothing rather than a ghost edge.
    const seenPairs = new Set<string>();
    const rfEdges: Edge[] = flow.edges
      .filter((e) => e.kind === "depends" && byId.has(e.from) && byId.has(e.to))
      .filter((e) => {
        const key = `${e.from}->${e.to}`;
        if (seenPairs.has(key)) return false;
        seenPairs.add(key);
        return true;
      })
      .map((e, i) => {
        // color/style is derived ONLY from the target's own blocked state —
        // never from whether some other task in the diagram is blocked.
        const isBlocking = blockedSet.has(e.to);
        return {
          id: `e${i}`, source: e.from, target: e.to, type: "dependency", animated: false,
          style: isBlocking
            ? { stroke: "#c93b3b", strokeWidth: 2.2, strokeDasharray: "6 4" }
            : { stroke: "#aab0c2", strokeWidth: 1.8 },
          markerEnd: { type: MarkerType.ArrowClosed, color: isBlocking ? "#c93b3b" : "#aab0c2", width: 16, height: 16 },
        };
      });

    const stats = {
      total: flow.nodes.length,
      done: flow.nodes.filter((n) => n.state === "done").length,
      inProgress: flow.nodes.filter((n) => n.state === "in_progress").length,
      blocked: blockedSet.size,
      deps: flow.edges.filter((e) => e.kind === "depends").length,
    };

    return { rfNodes, rfEdges, steps, stats };
  }, [flow, byId]);

  const colCount = Math.max(...steps.values(), 0) + 1;
  const open = openId ? byId.get(openId) : null;

  const chips = (
    <div className="chips">
      <span className="flow-chip">{stats.total} משימות</span>
      <span className="flow-chip">{stats.deps} תלויות</span>
      <span className="flow-chip">{stats.inProgress} בביצוע</span>
      <span className="flow-chip">{stats.blocked} חסומות</span>
      <span className="flow-chip">{stats.done} הושלמו</span>
    </div>
  );

  return (
    <div className="flow-shell">
      {(title || subtitle) && (
        <>
          <div className="flow-shell-header">
            <div>
              {title && <div className="title">{title}</div>}
              {subtitle && <div className="subtitle">{subtitle}</div>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {chips}
              {workitemId && (
                <a
                  href={`#/flow/${workitemId}`} target="_blank" rel="noreferrer"
                  className="btn btn-secondary btn-sm" style={{ whiteSpace: "nowrap" }}
                >
                  ⤢ פתח במסך מלא
                </a>
              )}
            </div>
          </div>
          <div className="flow-shell-divider" />
        </>
      )}
      <div style={{ padding: 16 }}>
        {!title && !subtitle && <div style={{ marginBottom: 10 }}>{chips}</div>}

        {flow.nodes.length === 0 ? (
          <div className="empty">אין משימות TFS עדיין — בדיקות/משימות פנימיות לא מופיעות כאן, רק מה שהופך לפריט TFS.</div>
        ) : (
          <>
            {/* five legend items only, per spec — "planned" (waiting) is a
                real card state but deliberately not part of the legend. */}
            <div className="flow-legend">
              <span className="done"><i />{STATE_TONE.done!.label}</span>
              <span className="progress"><i />{STATE_TONE.in_progress!.label}</span>
              <span className="blocked"><i />{STATE_TONE.blocked!.label}</span>
              <span className="decision"><i />{STATE_TONE.decision!.label}</span>
              <span className="ready"><i />{STATE_TONE.ready!.label}</span>
            </div>

            {/* stage flow direction is fixed left→right regardless of the
                page's RTL layout — forced explicitly, not inherited. */}
            <div style={{ display: "flex", marginTop: 10, marginBottom: 4, direction: "ltr" }}>
              {Array.from({ length: colCount }, (_, i) => (
                <div key={i} className="flow-layer-label" style={{ width: COL_W }}>שלב {i + 1}</div>
              ))}
            </div>

            <div className="flow-canvas" style={{ position: "relative", height, direction: "ltr", border: "1px solid #e5e8ef", borderRadius: 12, overflow: "hidden" }}>
              <ReactFlow
                nodes={rfNodes} edges={rfEdges} edgeTypes={edgeTypes} nodesDraggable={false} nodesConnectable={false}
                onNodeClick={(_, n) => setOpenId(n.id)}
                panOnDrag zoomOnScroll={!!zoomable} zoomOnPinch={!!zoomable} zoomOnDoubleClick={!!zoomable}
                proOptions={{ hideAttribution: true }}
                defaultViewport={{ x: 20, y: 20, zoom: 1 }}
              >
                {zoomable && <Controls position="bottom-left" showInteractive={false} />}
              </ReactFlow>
              {open && (
                <Detail
                  node={open} tone={toneOf(open, blockersOf(open, byId, flow.edges).length > 0)}
                  blockers={blockersOf(open, byId, flow.edges)} downstream={downstreamCount(open.id, flow.edges)}
                  nav={nav} onClose={() => setOpenId(null)} onJump={(id) => setOpenId(id)}
                  onApprove={onApprove} approving={approvingId === open.id}
                  onToggleActive={onToggleActive} togglingActive={togglingActiveId === open.id}
                />
              )}
            </div>
            <p style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 6 }}>
              קו אפור = סדר/היררכיה · קו אדום מקווקו = חסימה בפועל · בדיקות פנימיות לא מקבלות כרטיס משלהן — הן מופיעות בתוך כרטיס המשימה שלהן.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
