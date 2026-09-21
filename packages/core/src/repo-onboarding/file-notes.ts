import type { ChangedFile } from "./types.ts";

/**
 * The one line next to each changed file in the review: why a created file
 * exists and what it contributes, what an updated file was updated for, why a
 * deleted file is gone. Written by a small model from the diff and from what the
 * person decided in the session, so a person who does not read diffs can tell what
 * they are approving. This module is the prompt and the reading of the answer —
 * pure, so it can be tried without a model. `runs.ts` decides when to ask.
 */

export type FileNote = { text: string; sig: string };

/** What a note was written for. When a file's numbers change the note is stale and is written again. */
export const noteSig = (f: Pick<ChangedFile, "status" | "additions" | "deletions">) => `${f.status}|${f.additions}|${f.deletions}`;

export const NOTES_SYSTEM = `You explain to a person who is not a developer, in Hebrew, what each changed file in an onboarding review is for — one line per file, so that they can tell what they are about to approve. You get the repository's name, the changed files (status A = created, M = updated, D = deleted, with lines added and removed), the diff, and what the person decided in the session: the questions Claude asked them with their answers, and what they typed to Claude.

Answer with ONLY a JSON array, one object per file, in the order given, nothing before or after it: [{"path": "the file's path exactly as given", "note": "the line"}].

The note is Hebrew, one sentence, up to 25 words, in plain words with no jargon; put paths, commands, package names and code in backticks, never translated.
- Created (A): begin with "נוצר כדי" and say what it contributes to the project day to day — what people or Claude can now do that they could not before.
- Updated (M): begin with "עודכן בעקבות" and say what prompted it and what changed, in one clause. Prefer a decision the person made in the session when one matches; otherwise what Claude found in the repository.
- Deleted (D): begin with "נמחק כי" and say why — what replaced it, or why it no longer applies.
A lock file (package-lock.json and the like) is "עודכן אוטומטית בעקבות התקנת התלויות שנוספו ל-\`package.json\`".

Write natural, correct Hebrew that a non-technical person reads without effort: short everyday words, no word-for-word English phrasing, no invented words. Keep tool and package names as they are, in backticks. When a phrase does not come out naturally, say it more simply.

Say only what the diff or the person's decisions show. Never invent a benefit or a reason. When the reason is not visible, say what changed instead, still beginning with the words above. Do not describe the file's every line: one purpose, one reason.`;

export function notesPrompt(input: { repoName: string; files: ChangedFile[]; diff: string; decisions: string[] }): string {
  return [
    `המאגר: ${input.repoName}`,
    input.decisions.length ? `מה שהאדם החליט והקליד בסשן:\n${input.decisions.map((d) => `- ${d}`).join("\n")}` : "האדם לא ענה לשאלות ולא הקליד דבר בסשן מלבד /init.",
    `הקבצים:\n${input.files.map((f) => `${f.status} ${f.path} (+${f.additions} −${f.deletions})`).join("\n")}`,
    `ה-diff:\n${input.diff}`,
  ].join("\n\n");
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The answer's JSON array → path → line, only for the paths asked about. A malformed answer gives nothing, never a guess. */
export function parseNotes(raw: string, wanted: readonly string[]): Record<string, string> {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return {};
  let arr: unknown;
  try { arr = JSON.parse(raw.slice(start, end + 1)); } catch { return {}; }
  if (!Array.isArray(arr)) return {};
  const ok = new Set(wanted);
  const out: Record<string, string> = {};
  for (const e of arr) {
    const o = e as { path?: unknown; note?: unknown };
    if (typeof o?.path !== "string" || typeof o.note !== "string" || !ok.has(o.path)) continue;
    const note = o.note.replace(/\s+/g, " ").trim();
    if (note) out[o.path] = clip(note, 280);
  }
  return out;
}
