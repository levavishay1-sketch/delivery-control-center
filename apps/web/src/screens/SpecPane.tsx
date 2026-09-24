import { Info } from "../claude/Info.tsx";
import type { SpecSection, SpecView } from "../api.ts";

/**
 * The requirement's specification, as pieces a task can point at. The
 * document's own words stay exactly as they were written: where a closed
 * decision overrules them, the original is struck through and the decision's
 * wording sits beside it — never rewritten, so what the client asked for and
 * what was decided later are both readable.
 *
 * Clicking a piece is how a person asks "who implements this?"; the tasks
 * that do are marked in the view beside it.
 */

const KIND_HE: Record<string, string> = { field: "שדה", rule: "כלל", mapping: "מיפוי", decision: "החלטה", heading: "" };

export function SpecPane({ spec, hit, picked, onPick }: {
  spec: SpecView;
  /** Anchors the selected task implements. */
  hit: Set<string>;
  /** The one piece a person clicked. */
  picked: string | null;
  onPick: (anchor: string) => void;
}) {
  const uncovered = new Set(spec.uncovered);
  const focused = hit.size > 0 || picked != null;
  const depth = (s: SpecSection): number => {
    let d = 0;
    for (let a = s.parentAnchor; a; d++) a = spec.sections.find((x) => x.anchor === a)?.parentAnchor ?? null;
    return Math.min(d, 3);
  };

  return (
    <div className={`spec-doc${focused ? " focused" : ""}`}>
      {spec.sections.map((s) => {
        {/* no-info: the customer's own heading, read out of their document — DCC has nothing to explain about it */}
        if (s.kind === "heading") return <p key={s.anchor} className="spec-h" style={{ marginInlineStart: depth(s) * 12 }}>{s.title}</p>;
        const on = picked === s.anchor ? " picked" : hit.has(s.anchor) ? " hit" : "";
        const gap = uncovered.has(s.anchor) ? " gap" : "";
        return (
          <div
            key={s.anchor} role="button" tabIndex={0}
            className={`spec-line${on}${gap}`}
            style={{ marginInlineStart: depth(s) * 12 }}
            onClick={() => onPick(s.anchor)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(s.anchor); } }}
            title={s.body && s.body !== s.title ? s.body : undefined}
          >
            <div className="spec-top">
              <span className="spec-kind">{KIND_HE[s.kind] ?? s.kind}</span>
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
        );
      })}
    </div>
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
