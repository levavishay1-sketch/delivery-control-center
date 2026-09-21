import { useMemo } from "react";
import { highlight, highlightLine, type Token } from "./code.ts";

/** The pieces of one line, coloured. Used by the comparison, which already works line by line. */
export function CodeLine({ text, lang }: { text: string; lang: string }) {
  const toks = useMemo(() => highlightLine(text, lang), [text, lang]);
  if (!text) return <> </>;
  return <>{toks.map((t, i) => (t.kind === "plain" ? t.text : <span key={i} className={`tk-${t.kind}`}>{t.text}</span>))}</>;
}

const Line = ({ toks }: { toks: Token[] }) =>
  <>{toks.length ? toks.map((t, i) => (t.kind === "plain" ? t.text : <span key={i} className={`tk-${t.kind}`}>{t.text}</span>)) : " "}</>;

/**
 * A whole file, coloured, with its line numbers — and the stretches that are
 * in conflict marked inside it, the way an editor shows them rather than as
 * a fragment lifted out of the file.
 */
export function CodeBlock({ text, lang, marks, activeMark, onMark, maxHeight = 420 }: {
  text: string;
  lang: string;
  /** Line ranges to mark, 0-based and inclusive of `from`, exclusive of `to`. */
  marks?: { from: number; to: number; tone: "ours" | "theirs" }[];
  activeMark?: number;
  onMark?: (i: number) => void;
  maxHeight?: number;
}) {
  const lines = useMemo(() => highlight(text, lang), [text, lang]);
  const markOf = (n: number) => (marks ?? []).findIndex((m) => n >= m.from && n < m.to);
  return (
    <div className="cb" style={{ maxHeight }}>
      {lines.map((toks, n) => {
        const mi = markOf(n);
        const m = mi === -1 ? null : marks![mi]!;
        const first = m && n === m.from;
        return (
          <div
            key={n}
            className={`cb-row${m ? ` mk ${m.tone}` : ""}${m && mi === activeMark ? " on" : ""}${m && onMark ? " click" : ""}`}
            {...(m && onMark ? { role: "button", tabIndex: 0, onClick: () => onMark(mi), onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onMark(mi); } } } : {})}
          >
            <span className="cb-n">{n + 1}</span>
            <span className="cb-t">{first && <span className="cb-badge">{m!.tone === "ours" ? `קונפליקט ${mi + 1}` : `קונפליקט ${mi + 1}`}</span>}<Line toks={toks} /></span>
          </div>
        );
      })}
    </div>
  );
}
