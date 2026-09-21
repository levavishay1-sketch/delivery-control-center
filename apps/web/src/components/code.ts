/**
 * Colouring code the way an editor does, without a dependency.
 *
 * A person reading a change here is reading code, and plain grey text is
 * harder to read than the same lines in their editor. This is a small
 * scanner over the languages this repository actually shows; it is not a
 * parser and does not try to be. It never changes the text — every
 * character comes out exactly as it went in, so a line still lines up with
 * its opposite number in a comparison and a file saved from here is the
 * file that was shown.
 */

export type TokenKind = "plain" | "comment" | "string" | "number" | "keyword" | "type" | "fn" | "punct" | "tag" | "attr";
export type Token = { text: string; kind: TokenKind };

type Rules = {
  line?: string[];
  block?: [string, string][];
  quotes?: string[];
  keywords?: Set<string>;
  types?: Set<string>;
  /** `<tag attr=…>` is worth its own colour in markup and in JSX. */
  markup?: boolean;
};

const set = (s: string) => new Set(s.split(" "));

const JS_KEYWORDS = set(
  "import export from as default const let var function return if else for while do break continue new class extends super this typeof instanceof in of await async yield try catch finally throw switch case delete void null undefined true false interface type enum implements public private protected readonly static abstract declare namespace module satisfies keyof infer is asserts get set constructor",
);
const JS_TYPES = set("string number boolean object symbol bigint any unknown never void Promise Array Record Map Set Partial Readonly Pick Omit React JSX");
const CS_KEYWORDS = set(
  "using namespace class struct interface enum record public private protected internal static readonly const virtual override abstract sealed partial async await var new return if else for foreach while do switch case break continue try catch finally throw this base null true false is as in out ref params get set value nameof typeof default",
);
const SQL_KEYWORDS = set("select from where insert into values update set delete create table alter drop index view join left right inner outer on group by order having limit offset union all as and or not null distinct returning with primary key foreign references unique default check constraint");
const CSS_KEYWORDS = set("important inherit initial unset auto none flex grid block inline absolute relative fixed sticky solid transparent");

const C_LIKE: Rules = { line: ["//"], block: [["/*", "*/"]], quotes: ["\"", "'", "`"], keywords: JS_KEYWORDS, types: JS_TYPES, markup: true };

const BY_LANG: Record<string, Rules> = {
  ts: C_LIKE, tsx: C_LIKE, js: C_LIKE, jsx: C_LIKE, mjs: C_LIKE, cjs: C_LIKE,
  cs: { line: ["//"], block: [["/*", "*/"]], quotes: ["\"", "'"], keywords: CS_KEYWORDS, types: set("string int long bool double decimal float object var void Task List Dictionary") },
  json: { quotes: ["\""], keywords: set("true false null") },
  css: { block: [["/*", "*/"]], quotes: ["\"", "'"], keywords: CSS_KEYWORDS },
  sql: { line: ["--"], block: [["/*", "*/"]], quotes: ["'", "\""], keywords: SQL_KEYWORDS },
  sh: { line: ["#"], quotes: ["\"", "'"], keywords: set("if then fi else elif for while do done case esac function return export local set echo cd") },
  yml: { line: ["#"], quotes: ["\"", "'"], keywords: set("true false null") },
  py: { line: ["#"], quotes: ["\"", "'"], keywords: set("import from as def class return if elif else for while in is not and or None True False try except finally raise with lambda yield async await pass break continue global nonlocal") },
  html: { block: [["<!--", "-->"]], quotes: ["\"", "'"], markup: true },
  md: {},
};

export const langOf = (path: string): string => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "yaml") return "yml";
  if (ext === "bash" || ext === "zsh") return "sh";
  if (ext === "mdx") return "md";
  if (ext === "htm" || ext === "svg" || ext === "xml") return "html";
  return ext;
};

const isWord = (c: string) => /[A-Za-z0-9_$]/.test(c);

/** Every token of the text, in order, including the newlines — nothing is dropped. */
function scan(text: string, rules: Rules): Token[] {
  const out: Token[] = [];
  const push = (t: string, kind: TokenKind) => { if (t) out.push({ text: t, kind }); };
  let i = 0;
  let plain = "";
  const flush = () => { push(plain, "plain"); plain = ""; };

  while (i < text.length) {
    const rest = text.slice(i);

    const block = rules.block?.find(([open]) => rest.startsWith(open));
    if (block) {
      const end = text.indexOf(block[1], i + block[0].length);
      const stop = end === -1 ? text.length : end + block[1].length;
      flush(); push(text.slice(i, stop), "comment"); i = stop; continue;
    }
    const line = rules.line?.find((m) => rest.startsWith(m));
    if (line) {
      const nl = text.indexOf("\n", i);
      const stop = nl === -1 ? text.length : nl;
      flush(); push(text.slice(i, stop), "comment"); i = stop; continue;
    }
    const q = rules.quotes?.find((c) => rest.startsWith(c));
    if (q) {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text.startsWith(q, j)) { j += q.length; break; }
        // A single-quoted or double-quoted string never runs past its line; a template literal may.
        if (text[j] === "\n" && q !== "`") break;
        j += 1;
      }
      flush(); push(text.slice(i, j), "string"); i = j; continue;
    }
    const ch = text[i]!;
    if (/[0-9]/.test(ch) && !isWord(text[i - 1] ?? " ")) {
      let j = i;
      while (j < text.length && /[0-9a-fA-FxX._]/.test(text[j]!)) j += 1;
      flush(); push(text.slice(i, j), "number"); i = j; continue;
    }
    if (isWord(ch)) {
      let j = i;
      while (j < text.length && isWord(text[j]!)) j += 1;
      const word = text.slice(i, j);
      const after = text.slice(j).match(/^\s*/)?.[0].length ?? 0;
      const next = text[j + after];
      const kind: TokenKind = rules.keywords?.has(word) ? "keyword"
        : rules.types?.has(word) ? "type"
        : rules.markup && text[i - 1] === "<" ? "tag"
        : next === "(" ? "fn"
        : /^[A-Z]/.test(word) && rules.types ? "type"
        : "plain";
      flush(); push(word, kind); i = j; continue;
    }
    if (/[{}()[\];,.:<>=+\-*/%!&|?]/.test(ch)) { flush(); push(ch, "punct"); i += 1; continue; }
    plain += ch;
    i += 1;
  }
  flush();
  return out;
}

/** The text as lines of tokens. A token that spans lines (a block comment) is cut at each newline and keeps its kind. */
export function highlight(text: string, lang: string): Token[][] {
  if (typeof text !== "string") return [[]];
  const rules = BY_LANG[lang];
  const lines: Token[][] = [[]];
  if (!rules) {
    for (const [i, l] of text.split("\n").entries()) { if (i) lines.push([]); lines[lines.length - 1]!.push({ text: l, kind: "plain" }); }
    return lines;
  }
  for (const tok of scan(text, rules)) {
    const parts = tok.text.split("\n");
    parts.forEach((p, n) => {
      if (n) lines.push([]);
      if (p) lines[lines.length - 1]!.push({ text: p, kind: tok.kind });
    });
  }
  return lines;
}

/** One line's tokens, for a component that already works line by line. */
export const highlightLine = (text: string, lang: string): Token[] => highlight(text, lang)[0] ?? [{ text, kind: "plain" }];
