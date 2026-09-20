import { useEffect, useMemo, useRef, useState } from "react";

/**
 * A file before and after, side by side, with the changes marked
 * (`openspec/changes/pull-request-center`). One component for every screen
 * that opens a file under its row — the pull request's files and the
 * onboarding review — so both look and behave the same.
 *
 * The comparison is drawn here from the two texts; the screen only says how to
 * fetch them. Left is the old file, right is the new one, as in every diff tool.
 */

export type FileVersionsData = {
  path: string;
  before: string | null;
  after: string | null;
  binary: boolean;
  tooLarge: boolean;
  /** Where each version lives on the host, when there is one. */
  beforeUrl?: string | null;
  afterUrl?: string | null;
};

type Cell = { n: number; text: string; part?: [number, number] } | null;
type Row = { left: Cell; right: Cell; kind: "same" | "changed" | "added" | "removed" };

/** Longest-common-subsequence over lines. The unchanged head and tail are trimmed first,
 *  which is where nearly all of a typical edit's lines are; a very large middle falls back
 *  to "replaced as a block" rather than freezing the page. */
function lineOps(a: string[], b: string[]): { op: "=" | "-" | "+"; a?: number; b?: number }[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const out: { op: "=" | "-" | "+"; a?: number; b?: number }[] = [];
  for (let i = 0; i < head; i++) out.push({ op: "=", a: i, b: i });
  const am = a.slice(head, a.length - tail);
  const bm = b.slice(head, b.length - tail);
  const n = am.length, m = bm.length;
  if (n * m > 4_000_000) {
    for (let i = 0; i < n; i++) out.push({ op: "-", a: head + i });
    for (let j = 0; j < m; j++) out.push({ op: "+", b: head + j });
  } else if (n === 0 || m === 0) {
    for (let i = 0; i < n; i++) out.push({ op: "-", a: head + i });
    for (let j = 0; j < m; j++) out.push({ op: "+", b: head + j });
  } else {
    // dp[i][j] = length of the common subsequence of am[i..] and bm[j..]
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = am[i] === bm[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (am[i] === bm[j]) { out.push({ op: "=", a: head + i, b: head + j }); i++; j++; }
      else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { out.push({ op: "-", a: head + i }); i++; }
      else { out.push({ op: "+", b: head + j }); j++; }
    }
    while (i < n) { out.push({ op: "-", a: head + i }); i++; }
    while (j < m) { out.push({ op: "+", b: head + j }); j++; }
  }
  for (let k = tail; k > 0; k--) out.push({ op: "=", a: a.length - k, b: b.length - k });
  return out;
}

/** The part of two paired lines that differs: what is left after the shared start and end. */
function innerDiff(x: string, y: string): { l: [number, number]; r: [number, number] } {
  let s = 0;
  while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let e = 0;
  while (e < x.length - s && e < y.length - s && x[x.length - 1 - e] === y[y.length - 1 - e]) e++;
  return { l: [s, x.length - e], r: [s, y.length - e] };
}

const split = (t: string) => t.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

function buildRows(before: string | null, after: string | null): Row[] {
  const a = before === null ? [] : split(before);
  const b = after === null ? [] : split(after);
  const rows: Row[] = [];
  const ops = lineOps(a, b);
  for (let k = 0; k < ops.length;) {
    const o = ops[k]!;
    if (o.op === "=") { rows.push({ kind: "same", left: { n: o.a! + 1, text: a[o.a!]! }, right: { n: o.b! + 1, text: b[o.b!]! } }); k++; continue; }
    // A run of removals followed by a run of additions is one edit: pair them line by line.
    const dels: number[] = [], adds: number[] = [];
    while (k < ops.length && ops[k]!.op === "-") dels.push(ops[k++]!.a!);
    while (k < ops.length && ops[k]!.op === "+") adds.push(ops[k++]!.b!);
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) {
      const di = dels[i], ai = adds[i];
      if (di !== undefined && ai !== undefined) {
        const d = innerDiff(a[di]!, b[ai]!);
        rows.push({ kind: "changed", left: { n: di + 1, text: a[di]!, part: d.l }, right: { n: ai + 1, text: b[ai]!, part: d.r } });
      } else if (di !== undefined) rows.push({ kind: "removed", left: { n: di + 1, text: a[di]! }, right: null });
      else rows.push({ kind: "added", left: null, right: { n: ai! + 1, text: b[ai!]! } });
    }
  }
  return rows;
}

/** Long unchanged stretches fold away, leaving a few lines of context around each change. */
const CONTEXT = 3;
type Chunk = { rows: Row[]; folded: boolean };
function fold(rows: Row[]): Chunk[] {
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((r, i) => { if (r.kind !== "same") for (let d = -CONTEXT; d <= CONTEXT; d++) if (rows[i + d]) keep[i + d] = true; });
  const chunks: Chunk[] = [];
  for (let i = 0; i < rows.length;) {
    const k = keep[i]!;
    let j = i;
    while (j < rows.length && keep[j] === k) j++;
    chunks.push({ rows: rows.slice(i, j), folded: !k });
    i = j;
  }
  return chunks;
}

function Text({ c }: { c: NonNullable<Cell> }) {
  if (!c.part || c.part[0] === c.part[1]) return <>{c.text || " "}</>;
  return <>{c.text.slice(0, c.part[0])}<mark>{c.text.slice(c.part[0], c.part[1])}</mark>{c.text.slice(c.part[1])}</>;
}

function Line({ c, side, kind }: { c: Cell; side: "l" | "r"; kind: Row["kind"] }) {
  if (!c) return <div className="fc-cell empty" />;
  const tone = kind === "same" ? "" : side === "l" ? " del" : " add";
  return <div className={`fc-cell${tone}`}><span className="fc-n">{c.n}</span><span className="fc-t"><Text c={c} /></span></div>;
}

function Compare({ v }: { v: FileVersionsData }) {
  const rows = useMemo(() => buildRows(v.before, v.after), [v.before, v.after]);
  const chunks = useMemo(() => fold(rows), [rows]);
  const [unfolded, setUnfolded] = useState<Set<number>>(new Set());
  const changes = rows.filter((r) => r.kind !== "same").length;
  const first = useRef<HTMLDivElement>(null);
  // Opens right under its row; if that was near the bottom of the window, bring it into view.
  useEffect(() => { first.current?.scrollIntoView({ block: "nearest" }); }, []);
  if (!changes) return <p className="ob-sub" style={{ margin: "6px 4px" }}>אין הבדל בתוכן הקובץ. ייתכן ששונו רק הרשאות או שם.</p>;
  return (
    <div className="fc" ref={first}>
      <div className="fc-head">
        <span className="old">לפני{v.before === null ? " · הקובץ לא היה קיים" : ""}</span>
        <span className="new">אחרי{v.after === null ? " · הקובץ נמחק" : ""}</span>
      </div>
      <div className="fc-body">
        {chunks.map((c, ci) => c.folded && !unfolded.has(ci) ? (
          <button key={ci} type="button" className="fc-fold" onClick={() => setUnfolded(new Set(unfolded).add(ci))}>
            ⋯ {c.rows.length} שורות ללא שינוי · הצג
          </button>
        ) : c.rows.map((r, ri) => (
          <div className="fc-row" key={`${ci}-${ri}`}>
            <Line c={r.left} side="l" kind={r.kind} />
            <Line c={r.right} side="r" kind={r.kind} />
          </div>
        )))}
      </div>
    </div>
  );
}

/** Fetches the two versions when it opens, then shows them. Mount it under the row that was pressed. */
export function FileCompare({ load, links }: { load: () => Promise<FileVersionsData>; links?: { label: string; href: string }[] }) {
  const [v, setV] = useState<FileVersionsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    load().then((r) => { if (live) setV(r); }).catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const all = [...(links ?? []), ...(v?.beforeUrl ? [{ label: "הקובץ הישן ב-GitHub ↗", href: v.beforeUrl }] : []), ...(v?.afterUrl ? [{ label: "הקובץ החדש ב-GitHub ↗", href: v.afterUrl }] : [])];
  return (
    <div className="fc-wrap">
      {err ? <p className="ob-note crit" style={{ margin: "6px 0" }}>{err}</p>
        : !v ? <p className="ob-sub" style={{ margin: "6px 4px" }}>טוען את שתי הגרסאות…</p>
        : v.binary ? <p className="ob-sub" style={{ margin: "6px 4px" }}>קובץ בינארי (תמונה, קובץ בנוי וכדומה): אין מה להשוות שורה מול שורה.</p>
        : v.tooLarge ? <p className="ob-sub" style={{ margin: "6px 4px" }}>הקובץ גדול מדי להשוואה כאן.</p>
        : <Compare v={v} />}
      {all.length > 0 && <div className="fc-links">{all.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noreferrer">{l.label}</a>)}</div>}
    </div>
  );
}
