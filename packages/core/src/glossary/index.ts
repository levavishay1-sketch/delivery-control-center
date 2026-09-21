/**
 * The info registry (openspec/changes/info-hints): for every idea a person
 * meets on a screen — a card, a figure, a field, a costly button — one Hebrew
 * name and one or two plain sentences. ONE wording, three readers: the "i"
 * next to the element (`apps/web/src/claude/Info.tsx`), the chat (which answers
 * from here with no model call), and whoever documents the screen.
 *
 * Entries are keyed by CONCEPT, not by screen: "עלות AI" is one entry that the
 * requirement, the dashboard and the budgets screen all point to. `screens`
 * only says which screens' chat may answer about the concept.
 *
 * Everything reads through `getConcept` / `allConcepts` / `glossaryFor`, never
 * the arrays in `concepts/`. The data is in code today; moving it to a table
 * changes the bodies of those three functions and nothing else (an entry is
 * flat and carries no code), which is what keeps that move small.
 *
 * The rule, and how it is held: `CLAUDE.md` ("Info hints"), the skill in
 * `.claude/skills/info-hints/`, and `scripts/audit-stale.mjs`.
 */
import { CONCEPTS } from "./concepts/index.ts";
import { SCREEN_ABOUT } from "./screens.ts";

export type ConceptKind = "button" | "term" | "field" | "section";

export type Concept = {
  /** Unique, snake_case, named by the concept — never by the screen it first appeared on. */
  key: string;
  kind: ConceptKind;
  /** The name as it appears on the screen. */
  title: string;
  /** Other ways a person says it (the chat matches on these). */
  aliases?: string[];
  /** What it is / what it shows — one or two plain sentences. */
  explain: string;
  /** For a button: what happens if you press it (and what does NOT happen). */
  press?: string;
  /** The chat-registered screens whose chat may answer about this concept. */
  screens?: string[];
};

/** Kept as a name because the chat, the API and the web speak of glossary entries. */
export type GlossaryEntry = Concept;

export type ScreenGlossary = {
  screen: string;
  /** What the screen is for — the answer to "מה המסך הזה מציג?". */
  about: string;
  entries: Concept[];
};

/* ── the access surface ─────────────────────────────────────────────── */

const BY_KEY = new Map<string, Concept>(CONCEPTS.map((c) => [c.key, c]));

export const allConcepts = (): Concept[] => CONCEPTS;

export const getConcept = (key: string): Concept | null => BY_KEY.get(key) ?? null;

/** What one screen's chat knows: the screen's purpose and every concept that lists it. */
export function glossaryFor(screen: string | null | undefined): ScreenGlossary | null {
  const about = screen ? SCREEN_ABOUT[screen] : undefined;
  if (!screen || !about) return null;
  return { screen, about, entries: CONCEPTS.filter((c) => c.screens?.includes(screen)) };
}

/** The screens that have a glossary (the audit checks every screen registered with the chat is one of these). */
export const glossaryScreens = (): string[] => Object.keys(SCREEN_ABOUT);

/* ── step zero: answer from the glossary, no model ──────────────────── */

const norm = (s: string) => s.toLowerCase().replace(/[?!.,"'״׳()\[\]:;]/g, " ").replace(/\s+/g, " ").trim();
/** Hebrew questions carry prefixes ("ה", "ב", "ל", "ש", "מה זה ה…") — strip the common ones from each word once. */
const stem = (w: string) => w.replace(/^(ו|ה|ב|ל|מ|ש|כש|וה|וב|ול|שה|בה)(?=.{2,})/, "");
const words = (s: string) => norm(s).split(" ").filter(Boolean).map(stem);

const QUESTION_WORDS = /(^|\s)(מה|מהו|מהי|למה|איך|כמה|האם|הסבר|תסביר|מי|איפה|מתי)(\s|$)|\?/;

export type GlossaryMatch = { entry: Concept; screen: ScreenGlossary; certainty: "certain" | "likely" };

/** Does the question name a glossary term of this screen? The longest name
 *  wins; a question that only contains the term in passing is "likely",
 *  a short question about it is "certain". */
export function matchGlossary(screen: string | null | undefined, question: string): GlossaryMatch | null {
  const g = glossaryFor(screen);
  if (!g) return null;
  const q = norm(question);
  const qw = words(question);
  if (!qw.length) return null;
  let best: { entry: Concept; len: number } | null = null;
  for (const entry of g.entries) {
    for (const name of [entry.title, ...(entry.aliases ?? [])]) {
      const n = norm(name);
      const hit = q.includes(n) || words(name).every((w) => qw.includes(w));
      if (hit && (!best || n.length > best.len)) best = { entry, len: n.length };
    }
  }
  if (!best) return null;
  const isQuestion = QUESTION_WORDS.test(question);
  const certainty: GlossaryMatch["certainty"] = isQuestion && qw.length <= 12 ? "certain" : "likely";
  return { entry: best.entry, screen: g, certainty };
}

/** "מה המסך הזה מציג?" and the like. */
export const asksAboutScreen = (question: string) => /מה (ה)?מסך|מה רואים|מה יש (כאן|פה)|איפה אני|מה זה (המסך|הדף)/.test(norm(question));

/** The answer for a matched entry, in the words the "i" hint uses too. */
export function glossaryAnswer(m: GlossaryMatch): string {
  const e = m.entry;
  const head = e.kind === "button" ? `"${e.title}" — כפתור.` : e.kind === "field" ? `"${e.title}" — שדה במסך.` : e.kind === "section" ? `"${e.title}" — אזור במסך.` : `"${e.title}":`;
  return [head, e.explain, e.press ? `מה יקרה אם תלחצו: ${e.press}` : ""].filter(Boolean).join("\n");
}
