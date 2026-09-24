import { useMemo, useState } from "react";
import { Info } from "../claude/Info.tsx";
import type { SpecSection, SpecView } from "../api.ts";

/**
 * The requirement's specification, as pieces a task can point at.
 *
 * It is drawn as the OUTLINE the document already is — the customer's own
 * numbered headings, each holding what belongs under it, foldable, with the
 * same rail the task list uses so the two halves of the screen read alike.
 * A flat stream of boxes was the same information and unreadable: nothing
 * said where "3.9.2 שדות בישות" ended and "3.9.6 פונקציונליות" began.
 *
 * The document's own words stay exactly as they were written: where a closed
 * decision overrules them, the decision's wording sits beside the original —
 * never rewritten, so what the client asked for and what was decided later
 * are both readable.
 *
 * Clicking a piece is how a person asks "who implements this?"; the tasks
 * that do are marked in the view beside it.
 */

const KIND_HE: Record<string, string> = { field: "שדה", rule: "כלל", mapping: "מיפוי", decision: "החלטה", heading: "" };

/** Decisions carry no parent — they are not part of the document. They get their own place. */
const DECISIONS = "\u0000decisions";

type Node = { s: SpecSection; kids: Node[] };

export function SpecPane({ spec, hit, picked, onPick }: {
  spec: SpecView;
  /** Anchors the selected task implements. */
  hit: Set<string>;
  /** The one piece a person clicked. */
  picked: string | null;
  onPick: (anchor: string) => void;
}) {
  const [shut, setShut] = useState<Set<string>>(new Set());
  const uncovered = useMemo(() => new Set(spec.uncovered), [spec]);
  const focused = hit.size > 0 || picked != null;

  /* the document's own outline, in the order it was read */
  const { roots, decisions } = useMemo(() => {
    const nodes = new Map(spec.sections.map((s) => [s.anchor, { s, kids: [] } as Node]));
    const roots: Node[] = [];
    const decisions: Node[] = [];
    for (const s of spec.sections) {
      const n = nodes.get(s.anchor)!;
      const parent = s.parentAnchor ? nodes.get(s.parentAnchor) : null;
      if (parent) parent.kids.push(n);
      else if (s.kind === "decision") decisions.push(n);
      else roots.push(n);
    }
    return { roots, decisions };
  }, [spec]);

  /** Marked, or holding something marked — so a fold does not hide the answer. */
  const marked = useMemo(() => {
    const m = new Set<string>();
    const walk = (n: Node): boolean => {
      const kids = n.kids.map(walk).some(Boolean);
      const self = hit.has(n.s.anchor) || picked === n.s.anchor;
      if (kids || self) m.add(n.s.anchor);
      return kids || self;
    };
    [...roots, ...decisions].forEach(walk);
    return m;
  }, [roots, decisions, hit, picked]);

  const toggle = (a: string) => setShut((p) => { const n = new Set(p); n.has(a) ? n.delete(a) : n.add(a); return n; });

  const branch = (n: Node, level: number) => {
    const { s } = n;
    const open = !shut.has(s.anchor);
    const dim = focused && !marked.has(s.anchor);
    const kids = n.kids.length > 0 && open && (
      <div className="spec-kids">{n.kids.map((k) => branch(k, level + 1))}</div>
    );

    if (s.kind === "heading") {
      return (
        <section className={`spec-sec l${Math.min(level, 2)}${dim ? " dim" : ""}`} key={s.anchor}>
          {/* no-info: the customer's own heading, read out of their document — DCC has nothing to explain about it */}
          <button className="spec-h" type="button" aria-expanded={open} onClick={() => toggle(s.anchor)}>
            <Chevron open={open} />
            <span className="t">{s.title}</span>
            <span className="n">{count(n)}</span>
          </button>
          {kids}
        </section>
      );
    }

    const state = picked === s.anchor ? " picked" : hit.has(s.anchor) ? " hit" : "";
    const gap = uncovered.has(s.anchor) ? " gap" : "";
    return (
      <div className="spec-item" key={s.anchor}>
        <div
          role="button" tabIndex={0}
          className={`spec-line${state}${gap}${dim && !gap ? " dim" : ""}`}
          onClick={() => onPick(s.anchor)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(s.anchor); } }}
          title={s.body && s.body !== s.title ? s.body : undefined}
        >
          <div className="spec-top">
            <span className={`spec-kind k-${s.kind}`}>{KIND_HE[s.kind] ?? s.kind}</span>
            <span className="spec-title">{s.title}</span>
            <span className="spacer" />
            {s.tasks.length > 0
              ? <span className="spec-who">{s.tasks.map((t) => <b key={t.id} title={`#${t.seq} ${t.intent}`}>#{t.seq}</b>)}</span>
              : <span className="spec-none">אף משימה</span>}
          </div>
          {s.body && s.body !== s.title && <div className="spec-body">{s.body}</div>}
          {s.correction && (
            <div className="spec-fix" title={s.correction.question}>
              ✎ החלטה גוברת על מה שכתוב: <b>{s.correction.text}</b>
            </div>
          )}
        </div>
        {kids}
      </div>
    );
  };

  return (
    <div className="spec-doc">
      {roots.map((r) => branch(r, 0))}
      {decisions.length > 0 && (
        <section className={`spec-sec l0${focused && !decisions.some((d) => marked.has(d.s.anchor)) ? " dim" : ""}`}>
          <button className="spec-h" type="button" aria-expanded={!shut.has(DECISIONS)} onClick={() => toggle(DECISIONS)}>
            <Chevron open={!shut.has(DECISIONS)} />
            <span className="t">החלטות שנסגרו על הדרישה</span>
            <span className="n">{decisions.length}</span>
          </button>
          <Info k="spec_decisions" />
          {!shut.has(DECISIONS) && <div className="spec-kids">{decisions.map((d) => branch(d, 1))}</div>}
        </section>
      )}
    </div>
  );
}

/** Everything under a heading, however deep — what folding it hides. */
function count(n: Node): number {
  return n.kids.reduce((t, k) => t + (k.s.kind === "heading" ? count(k) : 1), 0);
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`spec-chev${open ? " open" : ""}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The bar above the spec: what it was read from, and how much of it a task implements. */
export function SpecHead({ spec, note }: { spec: SpecView; note: string }) {
  const counted = spec.sections.filter((s) => s.kind !== "heading").length;
  const covered = counted - spec.uncovered.length;
  return (
    <div className="spec-head">
      <div className="spec-head-row">
        <b>האפיון<Info k="spec_pane" /></b>
        {spec.source && <span className="spec-src">{spec.source.name}</span>}
      </div>
      <div className="spec-head-row">
        <span className="spec-cover" title="חלקים באפיון שיש משימה שמממשת אותם">
          <span className="spec-meter"><i style={{ width: `${counted ? (covered / counted) * 100 : 0}%` }} /></span>
          {covered}/{counted} מכוסים
        </span>
        <span className="spec-note">{note}</span>
      </div>
    </div>
  );
}
