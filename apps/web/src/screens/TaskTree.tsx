import { Fragment } from "react";
import { Pill, TaskStatusPill } from "../ui.tsx";
import type { TaskFlow, TaskFlowNode } from "../api.ts";

/**
 * The requirement's tasks as a nested list — one line each, so a whole
 * requirement fits on a screen. The SAME list answers two questions, and
 * which one is only the nesting:
 *
 *   "hierarchy" — what belongs to what: a group and the sub-tasks that are
 *   its work (a group is never developed itself).
 *   "dependencies" — what must finish before what: every developed task
 *   under the one that unblocks it. Groups do not appear, because they are
 *   not scheduled; a dependency on a group is a dependency on its sub-tasks.
 */

export type TreeMode = "hier" | "dep";

const ICON = {
  group: <span className="tt-ico g"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></svg></span>,
  task: <span className="tt-ico t"><svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="3" /></svg></span>,
  check: <span className="tt-ico c"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>,
};
const CHEV = <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>;

/** The dependency that decides when a task can start — the one it hangs under. */
export function gateOf(n: TaskFlowNode, byId: Map<string, TaskFlowNode>): string | null {
  if (!n.dependsOn.length) return null;
  return n.dependsOn
    .map((id) => byId.get(id))
    .filter((d): d is TaskFlowNode => !!d)
    .sort((a, b) => (b.stage ?? 0) - (a.stage ?? 0) || a.seq - b.seq)[0]?.id ?? null;
}

export function TaskTree({ flow, mode, selected, related, open, onToggle, onPick, onOpenTask, covers }: {
  flow: TaskFlow;
  mode: TreeMode;
  selected: string | null;
  /** Marked because the selected piece of the spec is implemented by them. */
  related: Set<string>;
  open: Set<string>;
  onToggle: (id: string) => void;
  onPick: (id: string) => void;
  onOpenTask: (id: string) => void;
  /** How many pieces of the spec each task implements. */
  covers: Map<string, number>;
}) {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const work = flow.nodes.filter((n) => !n.isGroup);
  const focused = selected != null || related.size > 0;

  const row = (n: TaskFlowNode, kids: TaskFlowNode[], extra?: string) => {
    const kind = n.isGroup ? "group" : "task";
    const isOpen = open.has(n.id);
    const done = n.isGroup ? flow.nodes.filter((k) => k.parentTaskId === n.id && k.state === "done").length : 0;
    const subs = n.isGroup ? flow.nodes.filter((k) => k.parentTaskId === n.id).length : 0;
    const lines = covers.get(n.id) ?? 0;
    return (
      <div
        className={`tt-row${selected === n.id ? " sel" : related.has(n.id) ? " rel" : ""}`}
        role="button" tabIndex={0} title={`#${n.seq} ${n.intent}`}
        onClick={() => onPick(n.id)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(n.id); } }}
      >
        <button
          className={`tt-tog${kids.length ? "" : " empty"}${isOpen ? " open" : ""}`} type="button"
          aria-label={isOpen ? "סגור" : "פתח"} disabled={!kids.length}
          onClick={(e) => { e.stopPropagation(); onToggle(n.id); }}
        >{kids.length ? CHEV : null}</button>
        {ICON[kind]}
        <span className="tt-seq">#{n.seq}</span>
        <span className="tt-name">{n.intent}</span>
        <span className="tt-end">
          {extra && <span className="tt-extra">{extra}</span>}
          {n.isGroup
            ? <span className="tt-prog" title="תת-משימות שהסתיימו"><span className="tt-bar"><i style={{ width: `${subs ? (done / subs) * 100 : 0}%` }} /></span>{done}/{subs}</span>
            : <span className="tt-lines" title="חלקים באפיון שהמשימה מממשת">{lines === 0 ? "לא באפיון" : lines === 1 ? "שורה אחת" : `${lines} שורות`}</span>}
          {n.status ? <TaskStatusPill status={n.status} /> : <Pill tone="inactive">{n.state}</Pill>}
          <a className="tt-open" title="פתח את מסך המשימה" onClick={(e) => { e.stopPropagation(); onOpenTask(n.id); }}>←</a>
        </span>
      </div>
    );
  };

  /* hierarchy: the requirement, its groups, and what is inside each */
  if (mode === "hier") {
    const roots = flow.nodes.filter((n) => !n.parentTaskId);
    const branch = (n: TaskFlowNode) => {
      const kids = flow.nodes.filter((k) => k.parentTaskId === n.id).sort((a, b) => a.seq - b.seq);
      const checks = n.checks;
      return (
        <div className="tt-node" key={n.id}>
          {row(n, [...kids, ...checks.map(() => n)])}
          {open.has(n.id) && (kids.length > 0 || checks.length > 0) && (
            <div className="tt-kids">
              {kids.map((k) => <div className="tt-kid" key={k.id}>{branch(k)}</div>)}
              {checks.filter((c) => !c.checkKind).map((c) => (
                <div className="tt-kid" key={c.id}>
                  <div className="tt-row tt-check" title={c.intent}>
                    <span className="tt-tog empty" />{ICON.check}
                    <span className="tt-seq">#{c.seq}</span>
                    <span className="tt-name">{c.intent}</span>
                    <span className="tt-end">{c.status ? <TaskStatusPill status={c.status} /> : null}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    };
    return <div className={`tt${focused ? " focused" : ""}`}>{roots.map(branch)}</div>;
  }

  /* dependencies: each task under the one that unblocks it */
  const childrenOf = (id: string | null) => work.filter((n) => gateOf(n, byId) === id).sort((a, b) => a.seq - b.seq);
  const branch = (n: TaskFlowNode) => {
    const kids = childrenOf(n.id);
    const also = n.dependsOn.filter((d) => d !== gateOf(n, byId)).map((d) => byId.get(d)).filter(Boolean) as TaskFlowNode[];
    const group = n.parentTaskId ? byId.get(n.parentTaskId) : null;
    return (
      <div className="tt-node" key={n.id}>
        {row(n, kids, group ? `קבוצה #${group.seq}` : undefined)}
        {also.length > 0 && <div className="tt-also">תלויה גם ב-{also.map((a) => `#${a.seq}`).join(", ")}</div>}
        {open.has(n.id) && kids.length > 0 && (
          <>
            <div className="tt-unlocks">פותחת את:</div>
            <div className="tt-kids">{kids.map((k) => <div className="tt-kid" key={k.id}>{branch(k)}</div>)}</div>
          </>
        )}
      </div>
    );
  };
  const roots = childrenOf(null);
  return (
    <div className={`tt${focused ? " focused" : ""}`}>
      {roots.length === 0 && <p className="ob-sub">אין משימות מתוזמנות.</p>}
      {roots.map((r) => <Fragment key={r.id}>{branch(r)}</Fragment>)}
    </div>
  );
}
