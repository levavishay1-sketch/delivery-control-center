/**
 * The conversation about a requirement's gaps — the facts and the transcript
 * each turn sends. Its standing instructions are the `gaps.conversation`
 * prompt on the Prompts screen. Pure (no database, no model), so it is tested
 * on its own; `gaps.ts` fills it from the database.
 *
 * Unlike the rest of the chat, this conversation is a second opinion on
 * decisions, not a question about a screen: every reply reads the
 * requirement, its attached files and its code, and each turn is stateless —
 * the facts and the transcript are sent again — so reading code in one turn
 * never inflates the next one past the chat's roll-over.
 */
import { gapRef, isOpenGapState } from "../gap-ref.ts";

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
