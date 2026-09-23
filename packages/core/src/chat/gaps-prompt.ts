/**
 * The conversation about a requirement's gaps — what the model is told.
 * Pure (no database, no model), so it is tested on its own; `gaps.ts` fills
 * it from the database.
 *
 * Unlike the rest of the chat, this conversation is a second opinion on
 * decisions, not a question about a screen: every reply reads the
 * requirement, its attached files and its code, and each turn is stateless —
 * the facts and the transcript are sent again — so reading code in one turn
 * never inflates the next one past the chat's roll-over.
 */
import { gapRef, isOpenGapState } from "../gap-ref.ts";

export const GAPS_SYSTEM = `You are talking with the person who has to decide the open gaps (open questions) of ONE software requirement in DCC, a system that manages AI-assisted software delivery. They are not a developer and read Hebrew; you answer in Hebrew.

Each message comes with "העובדות": the requirement (its title, the raw request and the notes on it, and the text of the files attached to it), the repository if there is one, every open gap — with its short reference in square brackets, why it matters, what happens if it is decided wrong, the options suggested for it, and who decides it (the requester or the team) — and the gaps already decided, with their decisions. Then "השיחה עד עכשיו", then the person's new message.

Your job is a real second opinion on their decisions, not a form that stores them:
- Work out which gap or gaps their message is about, and say it plainly by quoting a few words of each gap's question ("לגבי 'מי מאשר את בקשת הביטול': ..."). Never write a gap's reference in your text — the reference is for the action block only. One message may answer several gaps, or none; if part of it matches no open gap, say so.
- For each gap it addresses, judge the answer: is it complete and specific enough for a developer to build from without guessing? Does it fit the requirement, the attached files, the decisions already taken, and the code? If it contradicts any of them or leaves a case open, say exactly what, and ask at most two short, specific questions. If it is sound, say so in one line — never invent a reservation.
- REPOSITORY. When the facts say a repository is available, you have read-only tools on it (Read, Grep, Glob) and the working folder is the repository. Read the code when judging an answer needs it — whether something exists, how it works today, what a change would touch — and read as little as you need: the person pays for every token. Say in one short line what you read. When the facts say the code is not available right now, say so if your judgment depends on it.
- RECOMMEND. When asked what you would decide, recommend one option with its reason from the facts or the code. A gap the requester decides is theirs: say what to ask them rather than deciding it.
- CLOSING A GAP. When the person has stated, or explicitly accepted, a complete decision for a gap, propose closing it with ONE block per gap, exactly in this form:
  <action key="resolve_gap">{"gap":"REF","answer":"the decision, in Hebrew, complete and standing on its own"}</action>
  When the conversation established that a gap is not a real question — the requirement or the code already answers it, or it is out of scope — and the person agreed, propose instead:
  <action key="dismiss_gap">{"gap":"REF","reason":"why, in Hebrew"}</action>
  REF is the 8-character reference from the facts, copied exactly. Each block becomes a card with an approve button, and nothing closes until the person approves it there: say that you are proposing it, never that it is closed. Never propose closing a gap the person has not decided, never with a decision they did not state or accept, and never a gap already decided.
- LETTER. When asked for a message to the requester, write it from the open gaps the requester decides: a short greeting, the questions numbered in plain business Hebrew (no code, no jargon), a closing line. DCC never sends it — the person copies it; say so in one sentence.
- YOUR REPLY. Only your final message is shown to the person — nothing you write before or between reading files. So read first, then write the whole reply in one final message: for every gap the person's message touched, what you make of it (and, when they asked you to check something in the code, what you found and where); then any action blocks, at the very end. A reply that is only action blocks is never enough — the person must read why you propose each one.
- Plain text: no headings, no bold or other markdown; short lines starting with "-" are fine. Usually under 180 words — longer only when several gaps are answered at once. Put file paths, code and identifiers in backticks, exactly as written, never translated.`;

/** One click each, on the gaps conversation. They reach the model — they are questions for it. */
export const GAPS_SUGGESTIONS = [
  "מה היית ממליץ להכריע בפערים שהם החלטה שלנו?",
  "איזה פער כדאי לסגור קודם, ולמה?",
  "נסח מכתב למבקש הדרישה עם השאלות שרק הוא יכול לענות",
];

export type GapLike = {
  id: string; description: string; why: string | null; impactIfWrong: string | null; options: string[];
  whoAnswers: string; blocking: boolean; state: string; answer: string | null;
};

export type GapsContextInput = {
  title: string;
  requirementType: string;
  repo: { name: string; available: boolean } | null;
  notes: { source: string; body: string }[];
  files: { name: string; text: string | null; err: string | null }[];
  gaps: GapLike[];
};

/** Beyond this the attached files crowd out the conversation itself. */
const MAX_FILES_CHARS = 40_000;

const isOpen = (g: GapLike) => isOpenGapState(g.state);

export function renderGapsContext(c: GapsContextInput): string {
  const out: string[] = ["העובדות:", `הדרישה: ${c.title} (${c.requirementType === "development" ? "פיתוח" : c.requirementType === "research" ? "תחקור" : "בדיקות"})`];
  out.push(
    c.repo
      ? c.repo.available
        ? `המאגר: ${c.repo.name} — יש לך קריאה בלבד בו, ותיקיית העבודה היא המאגר.`
        : `המאגר: ${c.repo.name} — העותק המקומי לא זמין כרגע, אין גישה לקוד בתשובה הזו.`
      : "המאגר: אין מאגר מקושר לדרישה — אין קוד לקרוא.",
  );

  if (c.notes.length) {
    out.push("", "הדרישה הגולמית וההערות עליה, לפי הסדר:");
    for (const n of c.notes) out.push(`[${n.source}] ${n.body.trim()}`);
  }

  if (c.files.length) {
    out.push("", "קבצים מצורפים לדרישה — הם חלק ממנה:");
    let budget = MAX_FILES_CHARS;
    for (const f of c.files) {
      if (!f.text) { out.push(`--- ${f.name} — לא ניתן לקרוא כטקסט (${f.err ?? "לא ידוע"}) ---`); continue; }
      const text = f.text.length > budget ? `${f.text.slice(0, Math.max(0, budget))}\n[נקטע כאן]` : f.text;
      budget -= text.length;
      out.push(`--- ${f.name} ---`, text);
    }
  }

  const open = c.gaps.filter(isOpen);
  const done = c.gaps.filter((g) => g.state === "resolved" || g.state === "dismissed");
  out.push("", `פערים פתוחים (${open.length}):`);
  if (!open.length) out.push("(אין — כל הפערים הוכרעו)");
  for (const g of open) {
    out.push(`- [${gapRef(g.id)}] ${g.description}`);
    if (g.why) out.push(`  למה זה חשוב: ${g.why}`);
    if (g.impactIfWrong) out.push(`  אם ננחש לא נכון: ${g.impactIfWrong}`);
    if (g.options.length) out.push(`  אפשרויות שהוצעו: ${g.options.join(" | ")}`);
    out.push(`  מי מכריע: ${g.whoAnswers === "client" ? "מבקש הדרישה" : "הצוות"}${g.blocking ? " · דחוף" : ""}`);
  }
  if (done.length) {
    out.push("", `פערים שכבר הוכרעו (${done.length}):`);
    for (const g of done) out.push(`- ${g.description} → ${g.state === "dismissed" ? "לא פער" : "הוכרע"}${g.answer ? `: ${g.answer}` : ""}`);
  }
  return out.join("\n");
}

export type TranscriptMessage = { role: string; kind: string; text: string; payload: Record<string, unknown> };

const STATUS_HE: Record<string, string> = { proposed: "ממתין לאישור", running: "רץ", done: "אושר ובוצע", cancelled: "בוטל", failed: "נכשל" };
/** How far back a stateless turn remembers: a decision conversation is short, and old turns are in the facts by now. */
const MAX_TRANSCRIPT = 30;
const clip = (s: string, n = 1500) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** What was said so far — the person, Claude, and what happened to each card. */
export function renderTranscript(messages: TranscriptMessage[]): string {
  const lines: string[] = [];
  for (const m of messages.slice(-MAX_TRANSCRIPT)) {
    if (m.role === "system") continue;
    if (m.role === "user") lines.push(`האדם: ${clip(m.text)}`);
    else if (m.kind === "proposal") {
      const describe = typeof m.payload.describe === "string" ? m.payload.describe.split("\n")[0] : m.text;
      lines.push(`(כרטיס: ${m.text} — ${clip(describe ?? "", 300)} — ${STATUS_HE[String(m.payload.status)] ?? String(m.payload.status)})`);
    } else if (m.kind === "refusal") lines.push(`(כרטיס שנדחה: ${clip(m.text, 300)})`);
    else if (m.kind === "answer") lines.push(`קלוד: ${clip(m.text)}`);
  }
  return lines.length ? `השיחה עד עכשיו:\n${lines.join("\n")}` : "השיחה עד עכשיו: (זו ההודעה הראשונה)";
}
