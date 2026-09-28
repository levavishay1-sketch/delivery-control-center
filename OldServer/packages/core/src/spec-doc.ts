/**
 * The specification document as it arrived — its own headings, paragraphs
 * and tables — with an id on every piece, so a task can point at a row, a
 * cell or a single line of it.
 *
 * Nothing here is a model's reading. A .docx is converted to HTML (mammoth)
 * and that HTML is walked into blocks; a file with only text (a PDF, a
 * plain-text note) becomes paragraphs. The same bytes always give the same
 * blocks and the same ids, so the screen draws the customer's document —
 * the table stays a table with the customer's own columns — and a model's
 * only job is to say which of those pieces are requirements and which task
 * implements each.
 *
 * Pure: no database, no file system. The unit test drives it directly.
 */

export type DocLine = { id: string; text: string };
export type DocCell = { id: string; lines: DocLine[] };
export type DocRow = { id: string; cells: DocCell[] };
export type DocBlock =
  | { type: "heading"; id: string; level: number; text: string }
  | { type: "para"; id: string; lines: DocLine[] }
  | { type: "table"; id: string; head: string[]; rows: DocRow[] };
export type SpecDoc = { blocks: DocBlock[] };

/** What an id points at, and the words it holds. */
export type DocElement = { id: string; kind: "heading" | "para" | "line" | "table" | "row" | "cell"; text: string };

/* ── a small, forgiving HTML tree — mammoth writes plain, well-formed markup ── */

type Node = { tag: string; kids: Node[] } | { text: string };
const VOID = new Set(["br", "img", "hr", "col", "wbr"]);
const TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>|<!--[\s\S]*?-->|([^<]+)/g;

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
}

function tree(html: string): Node {
  const root = { tag: "#root", kids: [] as Node[] };
  const stack: { tag: string; kids: Node[] }[] = [root];
  for (const m of html.matchAll(TOKEN)) {
    const top = stack[stack.length - 1]!;
    if (m[4] !== undefined) { top.kids.push({ text: decode(m[4]) }); continue; }
    if (!m[2]) continue; // a comment
    const tag = m[2].toLowerCase();
    if (m[1]) {
      // Close up to the matching tag, if it is open at all — an unmatched close is ignored.
      const at = stack.map((s) => s.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const el = { tag, kids: [] as Node[] };
    top.kids.push(el);
    if (!VOID.has(tag) && !m[3]) stack.push(el);
  }
  return root;
}

const isText = (n: Node): n is { text: string } => "text" in n;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The lines a piece of markup reads as: a line break, a paragraph and a list
 * item each start a new one. `allBold` says whether every word was bold —
 * how a .docx without heading styles marks its headings.
 */
function linesOf(n: Node): { lines: string[]; allBold: boolean } {
  const lines: string[] = [];
  let cur = "";
  let words = 0;
  let boldWords = 0;
  const cut = () => { const t = clean(cur); if (t) lines.push(t); cur = ""; };
  const walk = (x: Node, bold: boolean, bullet: string) => {
    if (isText(x)) {
      cur += x.text;
      if (x.text.trim()) { words++; if (bold) boldWords++; }
      return;
    }
    const b = bold || x.tag === "strong" || x.tag === "b";
    if (x.tag === "br") { cut(); return; }
    if (x.tag === "img") return;
    const block = x.tag === "p" || x.tag === "li" || x.tag === "tr" || /^h[1-6]$/.test(x.tag) || x.tag === "div";
    if (block) cut();
    if (x.tag === "li") cur += bullet;
    let i = 0;
    for (const k of x.kids) {
      const li = !isText(k) && k.tag === "li";
      walk(k, b, li ? (x.tag === "ol" ? `${++i}. ` : "• ") : "");
    }
    if (block || x.tag === "td" || x.tag === "th") cut();
  };
  walk(n, false, "");
  cut();
  return { lines, allBold: words > 0 && boldWords === words };
}

/** "3.9.2 שדות בישות" is a heading three deep. Without a number it is a top-level one. */
function headingLevel(text: string): number {
  const m = text.match(/^(\d+(?:\.\d+)*)\.?\s/);
  return m ? m[1]!.split(".").length : 1;
}

/** A bold, short, single-line paragraph is how a .docx without heading styles writes a heading. */
const looksLikeHeading = (lines: string[], allBold: boolean) =>
  lines.length === 1 && allBold && lines[0]!.length <= 120;

/** The document's own blocks, from mammoth's HTML. */
export function docFromHtml(html: string): SpecDoc {
  const blocks: DocBlock[] = [];
  const n = { h: 0, p: 0, t: 0 };

  const para = (lines: string[]) => {
    if (!lines.length) return;
    const id = `p${++n.p}`;
    blocks.push({ type: "para", id, lines: lines.map((text, i) => ({ id: `${id}.l${i + 1}`, text })) });
  };

  const table = (el: { tag: string; kids: Node[] }) => {
    const trs: { tag: string; kids: Node[]; inHead: boolean }[] = [];
    const collect = (x: Node, inHead: boolean) => {
      if (isText(x)) return;
      if (x.tag === "table" && x !== el) return; // a table inside a cell is that cell's text, not rows of this one
      if (x.tag === "tr") { trs.push({ ...x, inHead }); return; }
      for (const k of x.kids) collect(k, inHead || x.tag === "thead");
    };
    collect(el, false);
    const cellsOf = (tr: { kids: Node[] }) => tr.kids.filter((k): k is { tag: string; kids: Node[] } => !isText(k) && (k.tag === "td" || k.tag === "th"));
    const isHead = (tr: (typeof trs)[number]) => tr.inHead || (cellsOf(tr).length > 0 && cellsOf(tr).every((c) => c.tag === "th"));
    const headRow = trs.find(isHead);
    const head = headRow ? cellsOf(headRow).map((c) => linesOf(c).lines.join(" ")) : [];
    const id = `t${++n.t}`;
    const rows = trs.filter((tr) => !isHead(tr)).map((tr, ri): DocRow => {
      const rid = `${id}.r${ri + 1}`;
      return {
        id: rid,
        cells: cellsOf(tr).map((c, ci) => {
          const cid = `${rid}.c${ci + 1}`;
          return { id: cid, lines: linesOf(c).lines.map((text, li) => ({ id: `${cid}.l${li + 1}`, text })) };
        }),
      };
    });
    if (rows.length || head.length) blocks.push({ type: "table", id, head, rows });
  };

  const top = (x: Node) => {
    if (isText(x)) { para([clean(x.text)].filter(Boolean)); return; }
    const h = x.tag.match(/^h([1-6])$/);
    if (h) {
      const text = linesOf(x).lines.join(" ");
      if (text) blocks.push({ type: "heading", id: `h${++n.h}`, level: Number(h[1]), text });
      return;
    }
    if (x.tag === "table") { table(x); return; }
    if (x.tag === "p" || x.tag === "ul" || x.tag === "ol") {
      const { lines, allBold } = linesOf(x);
      if (x.tag === "p" && looksLikeHeading(lines, allBold)) {
        blocks.push({ type: "heading", id: `h${++n.h}`, level: headingLevel(lines[0]!), text: lines[0]! });
      } else para(lines);
      return;
    }
    for (const k of x.kids) top(k);
  };

  top(tree(html));
  return { blocks };
}

/** A document that is only text — a PDF, a plain note: a paragraph per blank-line gap, a line per line. */
export function docFromText(text: string): SpecDoc {
  const blocks: DocBlock[] = [];
  let p = 0;
  let h = 0;
  for (const chunk of text.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map(clean).filter(Boolean);
    if (!lines.length) continue;
    if (lines.length === 1 && /^\d+(\.\d+)+\s/.test(lines[0]!) && lines[0]!.length <= 120) {
      blocks.push({ type: "heading", id: `h${++h}`, level: headingLevel(lines[0]!), text: lines[0]! });
      continue;
    }
    const id = `p${++p}`;
    blocks.push({ type: "para", id, lines: lines.map((t, i) => ({ id: `${id}.l${i + 1}`, text: t })) });
  }
  return { blocks };
}

/** Every piece that has an id, in reading order, with the words it holds. */
export function docElements(doc: SpecDoc): DocElement[] {
  const out: DocElement[] = [];
  for (const b of doc.blocks) {
    if (b.type === "heading") { out.push({ id: b.id, kind: "heading", text: b.text }); continue; }
    if (b.type === "para") {
      out.push({ id: b.id, kind: "para", text: b.lines.map((l) => l.text).join("\n") });
      for (const l of b.lines) out.push({ id: l.id, kind: "line", text: l.text });
      continue;
    }
    out.push({ id: b.id, kind: "table", text: b.head.join(" | ") });
    for (const r of b.rows) {
      out.push({ id: r.id, kind: "row", text: r.cells.map((c) => c.lines.map((l) => l.text).join(" ")).filter(Boolean).join(" | ") });
      for (const c of r.cells) {
        out.push({ id: c.id, kind: "cell", text: c.lines.map((l) => l.text).join("\n") });
        for (const l of c.lines) out.push({ id: l.id, kind: "line", text: l.text });
      }
    }
  }
  return out;
}

/**
 * The document as the model reads it: every piece with its id in brackets.
 * A cell or paragraph of one line is offered by its own id only; a longer
 * one offers each line too, so a single bullet can be pointed at.
 */
export function docForPrompt(doc: SpecDoc): string {
  const out: string[] = [];
  for (const b of doc.blocks) {
    if (b.type === "heading") { out.push(`[${b.id}] ${"#".repeat(Math.min(b.level, 4))} ${b.text}`); continue; }
    if (b.type === "para") {
      if (b.lines.length === 1) out.push(`[${b.id}] ${b.lines[0]!.text}`);
      else { out.push(`[${b.id}] paragraph:`); for (const l of b.lines) out.push(`  [${l.id}] ${l.text}`); }
      continue;
    }
    out.push(`[${b.id}] table${b.head.length ? ` — columns: ${b.head.join(" | ")}` : ""}`);
    for (const r of b.rows) {
      out.push(`  [${r.id}] row`);
      r.cells.forEach((c, i) => {
        if (!c.lines.length) return;
        const col = b.head[i] ? `(${b.head[i]}) ` : "";
        if (c.lines.length === 1) out.push(`    [${c.id}] ${col}${c.lines[0]!.text}`);
        else { out.push(`    [${c.id}] ${col}`.trimEnd()); for (const l of c.lines) out.push(`      [${l.id}] ${l.text}`); }
      });
    }
  }
  return out.join("\n");
}

/** Where a closed decision overrules the document: `from` (the document's words, in piece `id`) no longer holds; `to` does. */
export type SpecCorrection = { id: string; decision: string; from: string; to: string };

/* ── what the model is asked to produce, and what is accepted ──────── */

/** "Task #seq implements piece id — its own instruction says so, in these words." */
export type SpecLink = { seq: number; id: string; evidence: string };
export type SpecRead = {
  requirements: { id: string; title: string }[];
  links: SpecLink[];
  corrections?: { id: string; decision: string; from?: string; to: string }[];
};
export type SpecReadAccepted = {
  requirements: { id: string; title: string }[];
  links: SpecLink[];
  corrections: SpecCorrection[];
  /** Links whose quoted words are not in the task's instruction — dropped, so the piece shows as the gap it may be. */
  unsupported: SpecLink[];
};

/** Words compared the way a quote is: spacing, the kind of quote mark and of dash, and case do not count. */
const asQuoted = (s: string) =>
  s.normalize("NFC").replace(/["'`\u05F3\u05F4\u2018\u2019\u201C\u201D]/g, '"').replace(/[\u2010-\u2015-]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
/** Shorter than this, a "quote" (כן, 5) is found in almost any instruction and proves nothing. */
const MIN_EVIDENCE = 6;

/**
 * Accept what the model returned, or say exactly what is wrong with it.
 *
 * Every id must be a piece of THIS document or one of this requirement's
 * decisions — a link to anything else would mark words that are not there.
 *
 * A link has to prove itself: it quotes the words in the task's own
 * instruction that say the task does this, and the quote must really be
 * there. One that is not is dropped rather than trusted — an unimplemented
 * requirement then shows as the gap it is, which is the point of the whole
 * reading, instead of being hidden under a plausible guess.
 *
 * A correction whose `from` is not in the piece it names keeps its `to`,
 * shown beside the piece, instead of striking through words that do not
 * exist.
 * Pure — the unit test drives it without a database.
 */
export function checkSpecRead(
  raw: SpecRead, doc: SpecDoc, tasks: { seq: number; text: string }[], decisionAnchors: string[],
): { ok: true; value: SpecReadAccepted } | { ok: false; why: string } {
  const elements = new Map(docElements(doc).map((e) => [e.id, e]));
  const requirements = raw.requirements ?? [];
  if (!requirements.length) return { ok: false, why: "לא סומנה אף דרישה באפיון" };
  const seen = new Set<string>();
  for (const r of requirements) {
    const el = elements.get(r.id);
    if (!el) return { ok: false, why: `דרישה מצביעה על חלק שלא קיים במסמך: ${JSON.stringify(r.id)}` };
    if (el.kind === "heading" || el.kind === "table") return { ok: false, why: `${r.id} הוא ${el.kind === "heading" ? "כותרת" : "טבלה שלמה"}, לא דרישה` };
    if (seen.has(r.id)) return { ok: false, why: `אותה דרישה סומנה פעמיים: ${r.id}` };
    seen.add(r.id);
    if (!(r.title ?? "").trim()) return { ok: false, why: `אין שם לדרישה ${r.id}` };
  }
  const instruction = new Map(tasks.map((t) => [t.seq, asQuoted(t.text)]));
  const decisions = new Set(decisionAnchors);
  const linkable = new Set([...seen, ...decisionAnchors]);
  const links: SpecLink[] = [];
  const unsupported: SpecLink[] = [];
  for (const l of raw.links ?? []) {
    const said = instruction.get(l.seq);
    if (said === undefined) return { ok: false, why: `אין משימה #${l.seq}` };
    if (!linkable.has(l.id)) return { ok: false, why: `משימה #${l.seq} מפנה לחלק שאינו דרישה: ${l.id}` };
    const quote = asQuoted(l.evidence ?? "").replace(/^"+|"+$/g, "").trim();
    (quote.length >= MIN_EVIDENCE && said.includes(quote) ? links : unsupported).push(l);
  }
  const corrections: SpecCorrection[] = [];
  for (const c of raw.corrections ?? []) {
    const el = elements.get(c.id);
    if (!el) return { ok: false, why: `תיקון מפנה לחלק שלא קיים במסמך: ${c.id}` };
    if (!decisions.has(c.decision)) return { ok: false, why: `תיקון מפנה להחלטה שאינה של הדרישה: ${c.decision}` };
    if (!(c.to ?? "").trim()) return { ok: false, why: `תיקון ב-${c.id} בלי מה שתקף במקומו` };
    const from = (c.from ?? "").trim();
    corrections.push({ id: c.id, decision: c.decision, from: from && el.text.includes(from) ? from : "", to: c.to.trim() });
  }
  return { ok: true, value: { requirements, links, corrections, unsupported } };
}

/**
 * Requirements a closed decision struck out entirely — every word of the
 * piece is the words the decision overruled. Nothing is left to build, so
 * they are shown struck through beside the decision, never as a gap.
 */
export function overruledPieces(doc: SpecDoc, corrections: SpecCorrection[]): Set<string> {
  const text = new Map(docElements(doc).map((e) => [e.id, asQuoted(e.text)]));
  return new Set(corrections.filter((c) => c.from && asQuoted(c.from) === text.get(c.id)).map((c) => c.id));
}
