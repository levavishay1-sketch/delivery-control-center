import { createHash } from "node:crypto";
import { familyOf } from "./components.ts";
import { checkClaims } from "./verify.ts";
import type { ChangedFile, Component, ComponentKind, ComponentSeed } from "./types.ts";

/**
 * The scan of the `/init` draft: what the interactive session wrote in the
 * isolated copy is set against what DCC's own cards would write, and an
 * editor (the `onboarding.init_scan` prompt) decides topic by topic — take
 * theirs, merge, keep ours, drop some of ours, or leave a decision that is
 * not technical (an authorisation, a policy) to a person. Whatever it takes
 * becomes a card like every other: its exact text and reasoning on the card,
 * checked against the code here, approved by a person, built and verified. Nothing of the draft
 * reaches the pull request any other way — the build sets the draft aside
 * before it writes. Pure except for reading the copy's files through
 * `checkClaims`; the model call and the storage are in `runs.ts`.
 */

/** Where an assistant's instructions live — the files a draft of `/init` lands in, whether or not the transcript shows the write. */
export const AI_CONFIG = /^(?:.*\/)?(?:AGENTS\.md|CLAUDE\.md|CLAUDE\.local\.md|GEMINI\.md|\.cursorrules|\.windsurfrules)$|^\.claude\/|^\.cursor\/|^\.github\/(?:copilot-instructions\.md|instructions\/)|^\.mcp\.json$/;

/** The draft: every file the session wrote (from its transcript) and every changed file where instructions live. DCC's own `.dcc/` is never part of it. */
export function draftPaths(written: readonly string[], changed: readonly Pick<ChangedFile, "path">[]): string[] {
  const out = new Set<string>();
  for (const p of written) out.add(p);
  for (const c of changed) if (AI_CONFIG.test(c.path)) out.add(c.path);
  return [...out].filter((p) => p && !p.startsWith(".dcc/") && !p.startsWith("../") && !p.startsWith("/")).sort();
}

export type DraftFile = { path: string; before: string | null; after: string | null };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n[… ${s.length - n} more characters not shown]` : s);

/** The draft as the scan reads it: a new file whole, a changed one before and after, a deleted one named. */
export function renderDraft(files: readonly DraftFile[], maxPerFile = 16_000, maxTotal = 60_000): string {
  if (!files.length) return "(the session wrote nothing)";
  const parts: string[] = [];
  let used = 0;
  for (const f of files) {
    if (used >= maxTotal) { parts.push(`### ${f.path} — not shown (the draft is longer than this prompt can carry)`); continue; }
    const room = Math.max(1000, Math.min(maxPerFile, maxTotal - used));
    let block: string;
    if (f.after === null) block = `### FILE: ${f.path} (DELETED by the session — it existed in the repository)`;
    else if (f.before === null) block = `### FILE: ${f.path} (NEW — the repository had no such file)\n${clip(f.after, room)}`;
    else block = `### FILE: ${f.path} (CHANGED — the repository's own version first, then the draft)\n--- in the repository:\n${clip(f.before, Math.floor(room / 2))}\n--- in the draft:\n${clip(f.after, Math.floor(room / 2))}`;
    used += block.length;
    parts.push(block);
  }
  return parts.join("\n\n");
}

/* ── the editor's answer ──────────────────────────────────────────── */

export type InitScanVerdict = "adopt" | "merge" | "partial" | "keep_ours";
export type InitScanBetter = "ours" | "theirs" | "both" | "neither";
/** take — true and useful, goes in as written; check — worth it, but a claim in it still needs the build's check; ask — only a person can decide (an authorisation, a policy, the environment). */
export type InitScanDecision = "take" | "check" | "ask";
export type InitScanItem = {
  decision: InitScanDecision;
  form: "line" | "section" | "file";
  title: string;
  target: string;
  heading: string | null;
  text: string;
  origin: "theirs" | "merged";
  /** The real problem it solves here. */
  need: string;
  /** The file, path, command, finding or answer that makes it true. */
  evidence: string;
  /** Whether it could be solved without a new component, and why this is still the better way. */
  alternative: string;
  /** How we will know it helps. */
  verify: string;
  /** What it costs: tokens in every session, upkeep, permissions, complexity. */
  cost: string;
  /** For "ask": the question the person decides, with what is known and what is missing. */
  question: string | null;
  replaces: string[];
};
export type InitScan = {
  verdict: InitScanVerdict;
  summary: string;
  compare: { topic: string; ours: string; theirs: string; better: InitScanBetter; why: string }[];
  items: InitScanItem[];
  dropOurs: { key: string; why: string }[];
  reject: { what: string; why: string }[];
};

const VERDICTS: readonly InitScanVerdict[] = ["adopt", "merge", "partial", "keep_ours"];
const BETTER: readonly InitScanBetter[] = ["ours", "theirs", "both", "neither"];
const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

/** The JSON the prompt asks for, read defensively: anything missing becomes empty, anything malformed is dropped, nothing is invented. */
export function parseInitScan(raw: string): InitScan {
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const body = fenced ? fenced[1]! : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("הסריקה לא החזירה JSON");
  const o = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]).filter((x) => x && typeof x === "object") : []);
  const items: InitScanItem[] = arr(o.items).map((t): InitScanItem | null => {
    const form = t.form === "line" || t.form === "section" || t.form === "file" ? t.form : null;
    const decision: InitScanDecision | null = t.decision === "take" || t.decision === "check" || t.decision === "ask" ? t.decision : null;
    const text = String(t.text ?? "").replace(/\r\n/g, "\n").trim();
    if (!form || !decision || !text) return null;
    return {
      decision, form, title: s(t.title, 120) || text.split("\n")[0]!.slice(0, 80), target: s(t.target, 200) || "AGENTS.md", heading: s(t.heading, 120) || null,
      text, origin: t.origin === "merged" ? "merged" : "theirs",
      need: s(t.need, 400), evidence: s(t.evidence, 500), alternative: s(t.alternative, 400), verify: s(t.verify, 400), cost: s(t.cost, 300),
      question: decision === "ask" ? s(t.question, 500) || null : null,
      replaces: Array.isArray(t.replaces) ? t.replaces.map((k) => s(k, 80)).filter(Boolean).slice(0, 8) : [],
    };
  }).filter((t): t is InitScanItem => !!t).slice(0, 12);
  return {
    verdict: VERDICTS.includes(o.verdict as InitScanVerdict) ? (o.verdict as InitScanVerdict) : items.length ? "partial" : "keep_ours",
    summary: s(o.summary, 1200),
    compare: arr(o.compare).map((c) => ({ topic: s(c.topic, 120), ours: s(c.ours, 300), theirs: s(c.theirs, 300), better: BETTER.includes(c.better as InitScanBetter) ? (c.better as InitScanBetter) : "neither", why: s(c.why, 500) })).filter((c) => c.topic).slice(0, 20),
    items,
    dropOurs: arr(o.drop_ours).map((d) => ({ key: s(d.key, 80), why: s(d.why, 500) })).filter((d) => d.key).slice(0, 20),
    reject: arr(o.reject).map((r) => ({ what: s(r.what, 300), why: s(r.why, 500) })).filter((r) => r.what).slice(0, 20),
  };
}

/* ── from what it takes to cards ──────────────────────────────────── */

/** A whole file of the draft is taken only where DCC can build and verify it as that kind; settings, `.mcp.json` and hooks have cards of their own that are tested. */
export function fileKind(target: string): ComponentKind | null {
  if (/^\.claude\/skills\/[\w.-]+\/SKILL\.md$/.test(target)) return "skill";
  if (/^\.claude\/agents\/[\w.-]+\.md$/.test(target)) return "agent";
  if (/^\.claude\/(?:commands|rules)\/[\w./-]+\.md$/.test(target)) return "doc";
  if (/^[\w.-]+(?:\/[\w.-]+)*\/(?:CLAUDE|AGENTS)\.md$/.test(target)) return "doc";
  if (/^docs\/[\w./-]+\.md$/.test(target)) return "doc";
  return null;
}

const MAX_TEXT = { line: 400, section: 8000, file: 14000 } as const;
const hash = (x: string) => createHash("sha1").update(x).digest("hex").slice(0, 10);

export type ScanSeedsInput = {
  scan: InitScan;
  /** The isolated copy: every path the text names is checked there. */
  dir: string;
  knownCommands: readonly string[];
  /** Our cards, for "replaces" — a key that is not a card is dropped. */
  ours: readonly Pick<Component, "key" | "title_he">[];
  /** Whether a path existed at the run's start — a file of the draft is taken only when it is new. */
  inBaseline: (path: string) => boolean;
};

const BUILD_CHECK_HE: Partial<Record<ComponentKind, string>> = {
  skill: "frontmatter וגוף ה-skill, וכל נתיב שהוא מזכיר — מול הקוד.",
  agent: "frontmatter, קריאה בלבד, ורשימת בדיקה — כמו כל סוכן.",
};

/**
 * What the scan takes becomes cards: the same key for the same text, so a second scan keeps the person's
 * decision. Every card carries the scan's reasoning — the need, the evidence, the alternative, the cost —
 * and waits for a person whatever the automation level (the caller puts it in the approval group). A
 * question only a person can answer becomes a card whose approval IS the answer. What cannot be taken
 * is said, with the reason.
 */
export function seedsFromScan(i: ScanSeedsInput): { seeds: ComponentSeed[]; refused: { title: string; why: string }[] } {
  const seeds: ComponentSeed[] = [];
  const refused: { title: string; why: string }[] = [];
  const ourTitle = new Map(i.ours.map((c) => [c.key, c.title_he]));
  for (const t of i.scan.items) {
    const replaces = t.replaces.filter((k) => ourTitle.has(k));
    const text = t.form === "line" ? t.text.replace(/^\s*[-*]\s+/, "").replace(/\s+/g, " ").trim() : t.text;
    if (text.length > MAX_TEXT[t.form]) { refused.push({ title: t.title, why: `ארוך מדי (${text.length.toLocaleString("en-US")} תווים) — ${t.form === "line" ? "שורה" : t.form === "section" ? "סעיף" : "קובץ"} עד ${MAX_TEXT[t.form].toLocaleString("en-US")}` }); continue; }
    let kind: ComponentKind;
    let target = "AGENTS.md";
    if (t.form === "line") kind = "rule";
    else if (t.form === "section") kind = "doc";
    else {
      target = t.target.replace(/^\.\//, "");
      const k = fileKind(target);
      if (!k) { refused.push({ title: t.title, why: `DCC לא מאמץ את ${target} כקובץ שלם — להגדרות, ל-.mcp.json ול-hooks יש כרטיסים משלהם שנבנים ונבדקים` }); continue; }
      if (i.inBaseline(target)) { refused.push({ title: t.title, why: `${target} כבר קיים בריפו — DCC לא דורס קובץ של הריפו; סעיף או שורה כן` }); continue; }
      kind = k;
    }
    const claims = checkClaims(text, i.dir, i.knownCommands);
    const tooMany = claims.missing.length > Math.max(1, claims.checked * 0.2);
    const origin = t.origin === "merged" ? "שילוב של שלנו ושל /init" : "מטיוטת /init";
    const heading = t.form === "section" ? (t.heading ?? t.title).replace(/^#+\s*/, "") : null;
    const lines = text.split("\n").length;
    const reasoning = [
      t.decision === "ask" && t.question ? `צריך החלטה שלך: ${t.question} (אישור = כן, דחייה = לא).` : null,
      t.decision === "check" ? "לבדוק לפני שמאשרים — יש בו טענה שהסריקה לא הצליחה לאמת." : null,
      t.need ? `הצורך: ${t.need}` : null,
      t.evidence ? `ראיה: ${t.evidence}` : null,
      t.alternative ? `בלי רכיב חדש? ${t.alternative}` : null,
      t.cost ? `עלות: ${t.cost}` : null,
      replaces.length ? `מחליף את: ${replaces.map((k) => ourTitle.get(k)).join(", ")} — אם מאשרים את זה, לדחות אותו.` : null,
      claims.missing.length && !tooMany ? `שים לב: ${claims.missing.slice(0, 3).map((m) => `\`${m}\``).join(", ")} לא נמצא בקוד.` : null,
    ].filter(Boolean).join(" ");
    seeds.push({
      key: `init_${t.form}_${hash(`${target}\n${heading ?? ""}\n${text}`)}`, kind, family: familyOf(kind),
      risk: kind === "rule" || kind === "doc" ? "reversible" : "significant", source: "init", sourceRef: target,
      title_he: t.title,
      why_he: tooMany ? `נבדק מול הקוד ונמצאו ${claims.missing.length} נתיבים שלא קיימים (${claims.missing.slice(0, 4).join(", ")}) — לא מומלץ. ${origin}. ${reasoning}` : `${origin}. ${reasoning}`,
      what_he: t.form === "line" ? "שורה בכללי AGENTS.md, כלשונה בכרטיס." : t.form === "section" ? `סעיף "${heading}" שנוסף לסוף AGENTS.md, בנוסח שבכרטיס (${lines} שורות).` : `הקובץ ${target}, כלשונו בכרטיס (${lines} שורות).`,
      verifyHow_he: [t.verify, BUILD_CHECK_HE[kind] ?? "כל נתיב ופקודה בנוסח נבדקים מול הקוד בבנייה; טענה שלא נמצאה מכשילה את הכרטיס."].filter(Boolean).join(" "),
      params: {
        template: t.form === "line" ? undefined : t.form === "section" ? "init-section" : "init-file", text, heading, file: t.form === "file" ? target : undefined,
        decision: t.decision, origin: t.origin, replaces, question: t.question, claims: { checked: claims.checked, missing: claims.missing },
      },
      notRecommended: tooMany,
    });
  }
  return { seeds, refused };
}

/** A card of ours the scan says should not be kept: the note that goes on it — the person decides, nothing is declined by itself. */
export const INIT_NOTE = "סריקת /init:";
export function withScanNote(why: string, note: string | null): string {
  const base = why.split(` ${INIT_NOTE} `)[0]!;
  return note ? `${base} ${INIT_NOTE} ${note}` : base;
}
