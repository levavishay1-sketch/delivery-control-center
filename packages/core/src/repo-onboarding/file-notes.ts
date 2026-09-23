import type { ChangedFile } from "./types.ts";

/**
 * The one line next to each changed file in the review: why a created file
 * exists and what it contributes, what an updated file was updated for, why a
 * deleted file is gone. Written by a small model from the diff and from what the
 * person decided in the session, so a person who does not read diffs can tell what
 * they are approving. The instructions are the `onboarding.file_notes` prompt on
 * the Prompts screen; this module is the message and the reading of the answer —
 * pure, so it can be tried without a model. `runs.ts` decides when to ask.
 */

export type FileNote = { text: string; sig: string };

/** What a note was written for. When a file's numbers change the note is stale and is written again. */
export const noteSig = (f: Pick<ChangedFile, "status" | "additions" | "deletions">) => `${f.status}|${f.additions}|${f.deletions}`;

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
