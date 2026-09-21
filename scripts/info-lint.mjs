// The one place that knows what "this element needs an i" means
// (openspec/changes/info-hints). Three readers: `npm run audit:stale`
// (the whole repo, as a gate), `hooks/post-tool-use.mjs` (one file, the
// moment it is edited) and `npm run info:drift` (which concepts a change
// touched). Keep the rule here and nowhere else.

/** Screens and components are the surface a person reads. `forms.tsx` is a set of
 *  create/edit dialogs whose fields are their own labels, and `ui.tsx` carries the
 *  `info` prop rather than an "i" of its own — neither is linted. */
export const isScreenFile = (f) => /^apps\/web\/src\/(screens|components)\/.*\.tsx$/.test(f);

/** `<Info k="x" />` and the `info="x"` / `info={… "x" …}` props of the shared components. */
export function conceptsUsed(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/<Info k="([^"]+)"/g)) out.push({ key: m[1], line: i + 1 });
    for (const m of line.matchAll(/\binfo=(?:"([^"]+)"|\{([^}]*)\})/g)) {
      if (m[1]) out.push({ key: m[1], line: i + 1 });
      else for (const q of (m[2] ?? "").matchAll(/"([a-z][a-z0-9_]*)"/g)) out.push({ key: q[1], line: i + 1 });
    }
  });
  return out;
}

/** A heading written by hand instead of through `PageHead` / `CardTitle`. */
export function rawHeadings(text) {
  const out = [];
  text.split("\n").forEach((line, i) => { if (/<h[1-4][\s>]/.test(line)) out.push({ line: i + 1, text: line.trim().slice(0, 90) }); });
  return out;
}

/* ── named elements that carry no "i" ────────────────────────────────── */

/**
 * The three shapes that read as "the name of a thing", each of which should
 * open an explanation. Deliberately narrow: the class `l` and the class `tt`
 * carry free text as often as they carry a name, so linting them would cry
 * wolf and the check would stop being read.
 */
const NAMED = [
  { what: "label", open: /<label(?:\s[^>]*)?>/g },
  { what: "column", open: /<th(?:\s[^>]*)?>/g },
  { what: "figure", open: /className="(?:lbl|section-lbl|card-title|cm-t)"/g },
];

/** A spacer, a lone number or a bare expression names nothing. */
const NAMES_NOTHING = (s) => !s || /^[\s{}() .·—–:/%$#0-9]*$/.test(s) || s === "&nbsp;" || /^\{[^{}]*\}$/.test(s);

/**
 * Named elements in one file that open no explanation. An element opts out
 * with a `no-info:` comment on the line before it — visible in review, and
 * counted by the audit so an opt-out cannot quietly become the norm.
 *
 * Heuristic on purpose: it reads the text, not the types. It is a net for
 * what a person would have had to remember, not a proof.
 */
export function unexplained(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/no-info:/.test(lines[i - 1] ?? "") || /no-info:/.test(line)) continue;
    // An element may close a line or two below; read a small window.
    const window = lines.slice(i, i + 3).join("\n");
    for (const { what, open } of NAMED) {
      open.lastIndex = 0;
      const m = open.exec(line);
      if (!m) continue;
      // The element's content starts after its own `>` and ends at its closing tag.
      const gt = what === "figure" ? window.indexOf(">", m.index + m[0].length) : m.index + m[0].length - 1;
      if (gt === -1) continue;
      const end = window.indexOf("</", gt + 1);
      const inner = window.slice(gt + 1, end === -1 ? gt + 160 : end);
      if (/<Info\b/.test(inner) || /\binfo=/.test(line)) continue;
      // A <label> wrapping a control is a click target, not a name.
      if (what === "label" && /<(?:input|select|textarea)\b/.test(inner)) continue;
      // The name is the text before any nested element.
      const shown = inner.split("<")[0].replace(/\s+/g, " ").trim();
      if (NAMES_NOTHING(shown)) continue;
      out.push({ line: i + 1, what, text: shown.slice(0, 70) });
    }
  }
  return out;
}

/**
 * An "i" rendered inside a `<button>`. `Info` is a button of its own, so this
 * is invalid HTML and React warns about it at runtime — it happened once, on
 * the two buttons that name a costly action. The "i" belongs beside the
 * control, not inside it.
 */
export function infoInsideButton(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    const b = line.lastIndexOf("<button");
    if (b === -1) return;
    const close = line.indexOf("</button>", b);
    const info = line.indexOf("<Info", b);
    if (info !== -1 && (close === -1 || info < close)) out.push({ line: i + 1, text: line.trim().slice(0, 90) });
  });
  return out;
}

/** Opt-outs, so the audit can report how many there are. */
export const optedOut = (text) => (text.match(/no-info:/g) ?? []).length;
