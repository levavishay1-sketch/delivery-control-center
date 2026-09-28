import { useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Info } from "../claude/Info.tsx";
import type { SpecDocLine, SpecPiece, SpecView } from "../api.ts";

/**
 * The requirement's specification, as it arrived — the customer's own
 * headings, paragraphs and tables, word for word — and after it every
 * question that was closed on the requirement, with its answer.
 *
 * What a model added is only marks on top: which rows, cells and lines are
 * requirements, which task implements each, and where a closed decision
 * overrules the words. A requirement is clickable ("who implements this?");
 * one nothing implements is red. An overruled phrase is struck through with
 * what was decided beside it, and "✎ החלטה" jumps to the question and answer
 * that decided it — the document itself is never rewritten.
 */

type Fix = { decision: string; from: string; to: string };

export function SpecPane({ spec, hit, picked, onPick }: {
  spec: SpecView;
  /** Anchors the selected task implements. */
  hit: Set<string>;
  /** The one piece a person clicked. */
  picked: string | null;
  onPick: (anchor: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const pieces = useMemo(() => new Map(spec.pieces.map((p) => [p.anchor, p])), [spec]);
  const focused = hit.size > 0 || picked != null;

  /* Every correction lands on the line that holds its words — or, when the words were not found, on the piece's last line. */
  const fixesOn = useMemo(() => {
    const m = new Map<string, Fix[]>();
    const linesUnder = new Map<string, SpecDocLine[]>();
    for (const b of spec.doc?.blocks ?? []) {
      if (b.type === "para") { linesUnder.set(b.id, b.lines); for (const l of b.lines) linesUnder.set(l.id, [l]); }
      if (b.type === "table") for (const r of b.rows) {
        linesUnder.set(r.id, r.cells.flatMap((c) => c.lines));
        for (const c of r.cells) { linesUnder.set(c.id, c.lines); for (const l of c.lines) linesUnder.set(l.id, [l]); }
      }
    }
    for (const c of spec.corrections) {
      const lines = linesUnder.get(c.id) ?? [];
      const at = (c.from && lines.find((l) => l.text.includes(c.from))) || lines[lines.length - 1];
      if (at) m.set(at.id, [...(m.get(at.id) ?? []), { decision: c.decision, from: at.text.includes(c.from) ? c.from : "", to: c.to }]);
    }
    return m;
  }, [spec]);

  /* A heading's depth, ranked among the depths this document uses. */
  const rankOf = useMemo(() => {
    const levels = [...new Set((spec.doc?.blocks ?? []).flatMap((b) => (b.type === "heading" ? [b.level] : [])))].sort((a, b) => a - b);
    return (level: number) => Math.min(levels.indexOf(level) + 1, 3);
  }, [spec]);

  // A task was chosen: bring the first thing it implements into view.
  useEffect(() => {
    if (!hit.size) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    box.current?.querySelector(".sd-a.hit")?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [hit]);

  const jump = (decision: string) => {
    onPick(decision);
    document.getElementById(`sd-${decision}`)?.scrollIntoView({ block: "center" });
  };

  /** The props that make an element a requirement: its state, and a click that asks who implements it. */
  const piece = (id: string) => {
    const p = pieces.get(id);
    if (!p) return { p: null, cls: "", props: {} };
    const state = picked === id ? " picked" : hit.has(id) ? " hit" : "";
    // Struck out entirely by a decision: nothing left to build, so not a gap.
    const gap = p.tasks.length || p.overruled ? "" : " gap";
    return {
      p,
      cls: `sd-a${state}${gap}${focused && !state && !gap ? " dim" : ""}`,
      props: {
        role: "button", tabIndex: 0,
        title: p.title,
        onClick: (e: MouseEvent) => { e.stopPropagation(); onPick(id); },
        onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onPick(id); } },
      },
    };
  };
  /** Who implements it — shown where it matters: on a chosen piece, and on one nothing implements. */
  const who = (p: SpecPiece | null) => {
    if (!p || !(picked === p.anchor || hit.has(p.anchor) || (!p.tasks.length && !p.overruled))) return null;
    if (!p.tasks.length && p.overruled) return null;
    return p.tasks.length
      ? <span className="sd-who">{p.tasks.map((t) => <b key={t.id} title={`#${t.seq} ${t.intent}`}>#{t.seq}</b>)}</span>
      : <span className="sd-who"><i>אף משימה</i></span>;
  };

  const words = (l: SpecDocLine): ReactNode => {
    const fixes = fixesOn.get(l.id);
    if (!fixes) return l.text;
    const inline = fixes.find((f) => f.from);
    const beside = fixes.filter((f) => f !== inline);
    const button = (f: Fix) => (
      <button key={`b${f.decision}`} className="sd-fix" type="button" title="ההחלטה שתיקנה את השורה" onClick={(e) => { e.stopPropagation(); jump(f.decision); }}>✎ החלטה</button>
    );
    let body: ReactNode = l.text;
    if (inline) {
      const at = l.text.indexOf(inline.from);
      body = <>{l.text.slice(0, at)}<del>{inline.from}</del> <ins>{inline.to}</ins>{button(inline)}{l.text.slice(at + inline.from.length)}</>;
    }
    return <>{body}{beside.map((f) => <span key={f.decision}> <ins>{f.to}</ins>{button(f)}</span>)}</>;
  };

  const line = (l: SpecDocLine) => {
    const { p, cls, props } = piece(l.id);
    return <div key={l.id} className={`sd-line ${cls}`} {...props}>{words(l)}{who(p)}</div>;
  };

  return (
    <div ref={box} className={`sd${focused ? " focused" : ""}`}>
      {(spec.doc?.blocks ?? []).map((b) => {
        if (b.type === "heading") {
          // no-info: the customer's own heading, read out of their document — DCC has nothing to explain about it
          return <p key={b.id} className={`sd-h l${rankOf(b.level)}`}>{b.text}</p>;
        }
        if (b.type === "para") {
          const { p, cls, props } = piece(b.id);
          return <div key={b.id} className={`sd-para ${cls}`} {...props}>{b.lines.map(line)}{who(p)}</div>;
        }
        return (
          <div key={b.id} className="sd-tbl">
            <table>
              {b.head.length > 0 && <thead><tr>{b.head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>}
              <tbody>
                {b.rows.map((r) => {
                  const row = piece(r.id);
                  // The row's own marks sit in its first cell that has words after the number.
                  const chipAt = r.cells.findIndex((c, i) => i > 0 && c.lines.length > 0);
                  return (
                    <tr key={r.id} className={row.cls} {...row.props}>
                      {r.cells.map((c, ci) => {
                        const cell = piece(c.id);
                        return (
                          <td key={c.id} className={cell.cls} {...cell.props}>
                            {c.lines.map(line)}
                            {who(cell.p)}
                            {ci === (chipAt < 0 ? 0 : chipAt) && who(row.p)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {spec.decisions.length > 0 && (
        <>
          <p className="sd-h l1 sd-dech">החלטות שנסגרו על הדרישה<Info k="spec_decisions" /></p>
          {spec.decisions.map((d) => {
            const { p, cls, props } = piece(d.anchor);
            return (
              <div key={d.anchor} id={`sd-${d.anchor}`} className="sd-dec">
                <div className={cls} {...props}>
                  <div className="q">{d.question}{who(p)}</div>
                  <div className="ans">{d.answer}</div>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/** The bar above the spec: what it was read from, and how much of it a task implements. */
export function SpecHead({ spec, note }: { spec: SpecView; note: string }) {
  const counted = spec.pieces.filter((p) => !p.overruled).length;
  const covered = counted - spec.uncovered.length;
  return (
    <div className="spec-head">
      <div className="spec-head-row">
        <b>האפיון<Info k="spec_pane" /></b>
        {spec.source && <span className="spec-src">{spec.source.name}</span>}
      </div>
      <div className="spec-head-row">
        {spec.read && (
          <span className="spec-cover" title="דרישות באפיון ובהחלטות שיש משימה שמממשת אותן">
            <span className="spec-meter"><i style={{ width: `${counted ? (covered / counted) * 100 : 0}%` }} /></span>
            {covered}/{counted} מכוסות
          </span>
        )}
        <span className="spec-note">{note}</span>
      </div>
    </div>
  );
}
