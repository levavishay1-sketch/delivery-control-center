import { openInNewTab } from "../openTab.ts";
import { useMemo, useState } from "react";
import { BaseEdge, Controls, MarkerType, Position, ReactFlow, type Edge, type EdgeProps, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { TaskBrief } from "./TaskBrief.tsx";
import type { TaskFlow, TaskFlowNode } from "../api.ts";
import { CopyBtn, DependencyTagPill } from "../ui.tsx";
import { Info } from "../claude/Info.tsx";

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
  review: { key: "review", bg: "#fbf9ff", border: "#7c3aed", label: "ממתינה לסקירה" },
};

/** The colour of each status tone (task-status.ts) on a card — one status, the same one the task screen shows. */
const TONE_CLASS: Record<string, string> = { healthy: "done", active: "in_progress", critical: "blocked", warning: "decision", ai: "review", neutral: "ready", inactive: "waiting" };

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
  if (node.status) {
    const key = !node.active ? "inactive" : TONE_CLASS[node.status.tone] ?? "waiting";
    return { ...STATE_TONE[key]!, label: node.status.label };
  }
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

function Card({ node, tone, onClick, onDetails, mark = "" }: { node: TaskFlowNode; tone: Tone; onClick: () => void; onDetails?: () => void; mark?: string }) {
  const idLabel = node.linkedAdoId ? `#${node.linkedAdoId}` : `הצעה #${node.seq}`;
  // Counted from each check's own status — the same one its row on the task screen shows; a check set aside is not counted.
  const activeChecks = node.checks.filter((c) => c.status?.key !== "inactive");
  const passedChecks = activeChecks.filter((c) => c.status?.key === "check_passed").length;
  return (
    <div className={`flow-node ${tone.key}${mark ? " " + mark : ""}`} onClick={onClick} style={{ width: LAYER_W, direction: "rtl", opacity: node.active ? 1 : 0.6, cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: node.status?.dependency ? 4 : 6, flexWrap: "wrap", gap: 4 }}>
        <Badge tone={tone} />
        {onDetails && <a className="flow-arrow" role="button" title="פרטי המשימה" onClick={(e) => { e.stopPropagation(); onDetails(); }}>◂</a>}
        {node.adoUrl
          ? <a href={node.adoUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--status-healthy)", direction: "ltr" }}>{idLabel} ↗</a>
          : <span style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--ink-500)", direction: "ltr" }}>{idLabel}</span>}
      </div>
      {node.status?.dependency && (
        <div style={{ marginBottom: 6 }} title={node.status.dependency.reason}>
          <span className={`flow-badge ${node.status.dependency.tone}`} style={{ fontSize: 10 }}><i />{node.status.dependency.label}</span>
        </div>
      )}
      <div style={{
        fontWeight: 650, fontSize: 12.5, lineHeight: 1.4, color: "var(--ink-900)",
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", marginBottom: 5,
      }}>{node.intent}</div>
      <div style={{ fontSize: 10.5, color: "var(--ink-500)", marginBottom: node.checks.length ? 6 : 0, display: "flex", justifyContent: "space-between" }}>
        <span>{node.isGroup ? "קבוצה" : node.adoType ?? "Task"} · {node.appetite} · {node.origin === "ai" ? "🤖 AI" : "👤 אדם"}</span>
        {(node.adoSyncedAt || node.approvedAt) && <span>{fmtDate(node.adoSyncedAt ?? node.approvedAt)}</span>}
      </div>
      {activeChecks.length > 0 && (
        <div style={{ fontSize: 10, color: "var(--ink-500)", display: "flex", alignItems: "center", gap: 4, borderTop: "1px solid var(--divider)", paddingTop: 6 }}>
          <span>☑</span><span>{passedChecks}/{activeChecks.length} בדיקות עברו</span>
        </div>
      )}
    </div>
  );
}

function Detail({ node, tone, blockers, downstream, onClose, onJump, onApprove, approving, onToggleActive, togglingActive }: {
  node: TaskFlowNode; tone: Tone; blockers: { node: TaskFlowNode; reason: string | null }[]; downstream: number;
  onClose: () => void; onJump: (id: string) => void;
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
          {/* The status, the same one the task screen shows — a dependency is shown, never "cannot progress": a dependent task can be developed. */}
          {blocked && !node.status ? (
            <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 700, color: tone.border }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: tone.border, display: "inline-block" }} />
              קיימת תלות
            </span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Badge tone={tone} />
              {node.status?.dependency && <><DependencyTagPill tag={node.status.dependency} /><Info k="task_dependency_tag" /></>}
            </span>
          )}
          <a onClick={onClose} title="סגור" style={{
            fontSize: 15, color: "var(--ink-500)", cursor: "pointer", width: 30, height: 30, display: "flex",
            alignItems: "center", justifyContent: "center", borderRadius: 99, background: "var(--surface)",
          }}>✕</a>
        </div>
        <p style={{ fontWeight: 700, fontSize: 18, lineHeight: 1.4, marginBottom: 4 }}>{node.intent}</p>
        {node.linkedAdoId && node.kind !== "check" && (
          <p style={{ marginBottom: 8 }}>
            {node.adoUrl
              ? <a href={node.adoUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 650, color: "var(--color-accent)", textDecoration: "underline" }}>🔗 TFS #{node.linkedAdoId} ↗</a>
              : <span style={{ fontSize: 13, fontWeight: 650, color: "var(--color-accent)" }}>🔗 TFS #{node.linkedAdoId}</span>}
          </p>
        )}
        {node.status?.reason && <p style={{ fontSize: 12.5, color: tone.border, marginBottom: 6 }}>{node.status.reason}</p>}
        {node.status?.dependency && <p style={{ fontSize: 12.5, color: node.status.dependency.tone === "critical" ? "var(--status-critical)" : "var(--status-warning)", marginBottom: 10 }}>{node.status.dependency.reason}</p>}
        {!node.active && (
          <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 10 }}>
            ⚪ לא פעילה — לא בFlow ולא בתלויות, ההיסטוריה נשארת.
          </p>
        )}
        <p style={{ fontSize: 13, color: "var(--ink-500)", marginBottom: 18 }}>
          {node.adoType ?? "Task"} · {node.appetite}{node.linkedAdoId ? "" : " · טרם הוקם ב-TFS"}
        </p>

        {blocked && (
          <div style={{ background: "var(--surface)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            {blockers.length > 0 ? blockers.map((b) => (
              <div key={b.node.id} style={{ marginBottom: 12 }}>
                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 3 }}>תלויה ב</p>
                    <a onClick={() => onJump(b.node.id)} style={{ fontSize: 14, cursor: "pointer" }}>
                      {b.node.linkedAdoId ? `#${b.node.linkedAdoId}` : `הצעה #${b.node.seq}`} — {b.node.intent.slice(0, 60)}
                    </a>
                    {b.node.adoUrl && <a href={b.node.adoUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, marginInlineStart: 8, color: "var(--status-healthy)" }}>↗ TFS</a>}
                  </div>
                  <div>
                    <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 3 }}>מה צריך לקרות?</p>
                    <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>{b.reason || `להשלים את "${b.node.intent.slice(0, 50)}" (כרגע: ${b.node.status?.label ?? b.node.state})`}</p>
                  </div>
                </div>
              </div>
            )) : (
              <p style={{ fontSize: 13.5 }}>המשימה סומנה כחסומה ידנית.</p>
            )}
            {downstream > 0 && (
              <p style={{ fontSize: 12.5, color: "#c93b3b", marginTop: 6 }}>
                {downstream} משימות בהמשך ה-flow מחכות לתלות הזו.
              </p>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              {blockers[0] && (
                <a onClick={() => onJump(blockers[0]!.node.id)} className="btn btn-secondary btn-sm">פתח את התלות</a>
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
            <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 6 }}>בדיקות ({node.checks.filter((c) => c.status?.key === "check_passed").length}/{node.checks.filter((c) => c.status?.key !== "inactive").length} עברו)</p>
            {node.checks.map((c) => (
              <p key={c.id} style={{ fontSize: 13.5, margin: "4px 0", color: c.status?.key === "inactive" ? "var(--ink-400)" : "var(--ink-700)" }}>
                {c.status?.key === "check_passed" ? "☑" : "☐"} {c.intent}{c.status && <span style={{ fontSize: 11.5, color: "var(--ink-500)" }}> — {c.status.label}</span>}
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
          <button className={node.approved || !onApprove ? "btn btn-primary" : "btn btn-secondary"} onClick={() => openInNewTab(`#/task/${node.id}`)}>{node.isGroup ? "פתח את מסך הקבוצה ←" : "פתח את מסך המשימה ←"}</button>
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

export function TaskGraph({ flow, height = 420, title, subtitle, onApprove, approvingId, onToggleActive, togglingActiveId, zoomable, workitemId, mode = "dep", selectedId = null, relatedIds, onSelect, implementedBy = null }: {
  flow: TaskFlow; height?: number; title?: string; subtitle?: string;
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
  /**
   * What the cards are laid out by. "dep" (the default) is the schedule:
   * columns of what can start once the column before it is done. "hier" is
   * composition: one zone per group, its sub-tasks inside it. A group is
   * never a scheduled card — it is not developed, its sub-tasks are — so in
   * "dep" it does not appear at all.
   */
  mode?: "dep" | "hier";
  /** Driven from outside (the requirement screen): which card is chosen, and which belong with it. */
  selectedId?: string | null;
  relatedIds?: Set<string>;
  onSelect?: (id: string) => void;
  /** The requirements in the spec a task carries out — null when the spec has not been marked yet. */
  implementedBy?: ((taskId: string) => { anchor: string; title: string }[]) | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  // The small brief a card's arrow opens, over the canvas — beside the spec the full popup would cover the answer.
  const [briefId, setBriefId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(flow.nodes.map((n) => [n.id, n])), [flow.nodes]);

  const { rfNodes, rfEdges, steps, stats, cols } = useMemo(() => {
    // The column is a SCHEDULE position — "what real work has to finish
    // before this can start", nothing else — and the server decides it once,
    // for every view (flow.ts): from the EFFECTIVE dependencies, and never
    // for a group, which is not developed and so is not scheduled. Reading
    // the raw edges here instead is what used to put a task a stage too
    // early and draw a group into the columns.
    const shown = mode === "hier" ? flow.nodes : flow.nodes.filter((n) => !n.isGroup);
    const steps = new Map(shown.map((n) => [n.id, n.stage ?? 0]));
    const pos = new Map<string, { x: number; y: number }>();
    // What sits above each column — a schedule position in one view, a group in the other.
    const cols: string[] = [];
    if (mode === "hier") {
      // Composition: a column per group, its sub-tasks under it, and whatever belongs to no group first.
      const groups = [null, ...shown.filter((n) => n.isGroup).map((n) => n.id)];
      let col = 0;
      for (const g of groups) {
        const members = shown.filter((n) => (g === null ? !n.parentTaskId && !n.isGroup : n.id === g || n.parentTaskId === g))
          .sort((a, b) => (a.isGroup ? -1 : 0) - (b.isGroup ? -1 : 0) || a.seq - b.seq);
        if (!members.length) continue;
        members.forEach((n, i) => pos.set(n.id, { x: col * COL_W, y: i * ROW_H }));
        for (const n of members) steps.set(n.id, col);
        const head = g === null ? null : shown.find((n) => n.id === g);
        cols.push(head ? `#${head.seq} ${head.intent}` : "ללא קבוצה");
        col++;
      }
    } else {
      const byStep = new Map<number, TaskFlowNode[]>();
      for (const n of shown) {
        const s = n.stage ?? 0;
        (byStep.get(s) ?? byStep.set(s, []).get(s)!).push(n);
      }
      for (const [s, list] of byStep) list.forEach((n, i) => pos.set(n.id, { x: s * COL_W, y: i * ROW_H }));
      for (let s = 0; s <= Math.max(...byStep.keys(), 0); s++) cols.push(`שלב ${s + 1}`);
    }

    // Computed once, shared by card tone AND arrow color — an arrow into a
    // blocked task must be red for exactly the tasks whose card is red,
    // never a separate "is either end unfinished" heuristic.
    const blockedSet = new Set(
      flow.nodes.filter((n) => blockersOf(n, byId, flow.edges).length > 0 || n.state === "blocked").map((n) => n.id),
    );

    const rfNodes: Node[] = shown.map((n) => {
      const tone = toneOf(n, blockedSet.has(n.id));
      const mark = selectedId === n.id ? "sel" : relatedIds?.has(n.id) ? "rel" : "";
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
        data: { label: <Card node={n} tone={tone} mark={mark} onClick={() => (onSelect ? onSelect(n.id) : setOpenId(n.id))} onDetails={onSelect ? () => setBriefId((cur) => (cur === n.id ? null : n.id)) : undefined} /> },
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
    // In the hierarchy view the arrows are the belonging itself (group → sub-task);
    // in the schedule view they are what the server says each task really waits for.
    const drawn = new Set(shown.map((n) => n.id));
    const wires = mode === "hier"
      ? shown.filter((n) => n.parentTaskId && drawn.has(n.parentTaskId)).map((n) => ({ from: n.parentTaskId!, to: n.id, kind: "parent" as const, reason: null }))
      : shown.flatMap((n) => n.dependsOn.filter((d) => drawn.has(d)).map((d) => ({ from: d, to: n.id, kind: "depends" as const, reason: null })));
    const seenPairs = new Set<string>();
    const rfEdges: Edge[] = wires
      .filter((e) => byId.has(e.from) && byId.has(e.to))
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
      // The counts read the same colour every card shows — never the stored state beneath it.
      done: flow.nodes.filter((n) => toneOf(n, blockedSet.has(n.id)).key === "done").length,
      inProgress: flow.nodes.filter((n) => toneOf(n, blockedSet.has(n.id)).key === "in_progress").length,
      failed: flow.nodes.filter((n) => n.active && toneOf(n, blockedSet.has(n.id)).key === "blocked").length,
      deps: flow.edges.filter((e) => e.kind === "depends").length,
    };

    return { rfNodes, rfEdges, steps, stats, cols };
  }, [flow, byId, mode, selectedId, relatedIds, onSelect]);

  const colCount = Math.max(cols.length, Math.max(...steps.values(), 0) + 1);
  const open = openId ? byId.get(openId) : null;

  const chips = (
    <div className="chips">
      <span className="flow-chip">{stats.total} משימות</span>
      <span className="flow-chip">{stats.deps} תלויות</span>
      <span className="flow-chip">{stats.inProgress} בעבודה</span>
      <span className="flow-chip">{stats.failed} נפלו</span>
      <span className="flow-chip">{stats.done} הסתיימו</span>
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
              <span className="done"><i />הסתיימה</span>
              <span className="progress"><i />בעבודה</span>
              <span className="blocked"><i />נפלה</span>
              <span className="decision"><i />ממתינה לפעולה (Build, בדיקות, תלות)</span>
              <span className="review"><i />ממתינה לסקירה</span>
              <span className="ready"><i />מוכנה לפיתוח</span>
            </div>

            {/* stage flow direction is fixed left→right regardless of the
                page's RTL layout — forced explicitly, not inherited. */}
            <div style={{ display: "flex", marginTop: 10, marginBottom: 4, direction: "ltr" }}>
              {Array.from({ length: colCount }, (_, i) => (
                <div key={i} className="flow-layer-label" style={{ width: COL_W }} title={cols[i] ?? ""}>{cols[i] ?? `שלב ${i + 1}`}</div>
              ))}
            </div>

            <div className="flow-canvas" style={{ position: "relative", height, direction: "ltr", border: "1px solid #e5e8ef", borderRadius: 12, overflow: "hidden" }}>
              <ReactFlow
                nodes={rfNodes} edges={rfEdges} edgeTypes={edgeTypes} nodesDraggable={false} nodesConnectable={false}
                // The card's own handler is what answers a click — React Flow's
                // onNodeClick does not fire for these cards. Where the cards sit
                // beside the spec the card selects instead of opening the detail
                // panel, which would cover the answer; the empty canvas clears
                // the choice, and choosing is never a toggle, so a click that
                // arrives twice still leaves that task chosen.
                onNodeClick={(_, n) => { if (!onSelect) setOpenId(n.id); }}
                onPaneClick={() => onSelect?.("")}
                panOnDrag zoomOnScroll={!!zoomable} zoomOnPinch={!!zoomable} zoomOnDoubleClick={!!zoomable}
                proOptions={{ hideAttribution: true }}
                defaultViewport={{ x: 20, y: 20, zoom: 1 }}
              >
                {zoomable && <Controls position="bottom-left" showInteractive={false} />}
              </ReactFlow>
              {briefId && byId.get(briefId) && (
                <div className="flow-brief">
                  <TaskBrief
                    node={byId.get(briefId)!}
                    waitsFor={byId.get(briefId)!.dependsOn.map((d) => byId.get(d)).filter((d): d is TaskFlowNode => !!d)}
                    implemented={implementedBy ? implementedBy(briefId) : null}
                    onOpen={() => openInNewTab(`#/task/${briefId}`)}
                    onClose={() => setBriefId(null)}
                  />
                </div>
              )}
              {open && (
                <Detail
                  node={open} tone={toneOf(open, blockersOf(open, byId, flow.edges).length > 0)}
                  blockers={blockersOf(open, byId, flow.edges)} downstream={downstreamCount(open.id, flow.edges)}
                  onClose={() => setOpenId(null)} onJump={(id) => setOpenId(id)}
                  onApprove={onApprove} approving={approvingId === open.id}
                  onToggleActive={onToggleActive} togglingActive={togglingActiveId === open.id}
                />
              )}
            </div>
            <p style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 6 }}>
              קו אפור = סדר/היררכיה · קו אדום מקווקו = התלות עוד לא הושלמה · בדיקות פנימיות לא מקבלות כרטיס משלהן — הן מופיעות בתוך כרטיס המשימה שלהן.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
