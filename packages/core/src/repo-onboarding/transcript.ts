import { existsSync, readFileSync } from "node:fs";
import type { SessionStatus } from "./types.ts";

/**
 * Reading the session back for the decision log. Claude Code writes every
 * message of the conversation to a JSONL transcript; DCC turns the parts a
 * person contributed — what they typed, the commands they ran, and their
 * answers to `/init`'s questions — into events, so nothing that shaped the
 * result is silent. A line cursor makes the scan idempotent.
 */

export type TranscriptFact =
  | { kind: "prompt"; text: string; at: string | null }
  | { kind: "command"; command: string; at: string | null }
  | { kind: "answer"; question: string; answer: string; at: string | null };

type Entry = {
  type?: string;
  isMeta?: boolean;
  timestamp?: string;
  message?: { id?: string; role?: string; content?: unknown };
  toolUseResult?: unknown;
};

const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => (b as { type?: string }).type === "text").map((b) => String((b as { text?: unknown }).text ?? "")).join("\n");
}

/** Answers to an `AskUserQuestion`: the structured result when present,
 *  otherwise the `"question"="answer"` pairs of the tool-result text. */
function answersOf(e: Entry): { question: string; answer: string }[] {
  const r = e.toolUseResult as { answers?: Record<string, unknown> } | undefined;
  if (r?.answers && typeof r.answers === "object") {
    return Object.entries(r.answers).map(([q, a]) => ({ question: q, answer: Array.isArray(a) ? a.join(", ") : String(a) }));
  }
  const blocks = Array.isArray(e.message?.content) ? (e.message!.content as { type?: string; content?: unknown }[]) : [];
  const out: { question: string; answer: string }[] = [];
  for (const b of blocks) {
    if (b.type !== "tool_result") continue;
    const t = typeof b.content === "string" ? b.content : textOf(b.content);
    if (!/answered your question/i.test(t)) continue;
    for (const m of t.matchAll(/"([^"]+)"="([^"]*)"/g)) out.push({ question: m[1]!, answer: m[2]! });
  }
  return out;
}

export function scanTranscript(file: string, cursor: number, lastMessageId: string | null): { facts: TranscriptFact[]; cursor: number; apiCalls: number; lastMessageId: string | null } {
  if (!existsSync(file)) return { facts: [], cursor, apiCalls: 0, lastMessageId };
  const lines = readFileSync(file, "utf8").split("\n");
  // The last line may still be being written; leave it for the next pass.
  const complete = lines.slice(0, -1);
  const facts: TranscriptFact[] = [];
  let apiCalls = 0;
  let last = lastMessageId;
  for (let i = cursor; i < complete.length; i++) {
    let e: Entry;
    try { e = JSON.parse(complete[i]!) as Entry; } catch { continue; }
    const at = e.timestamp ?? null;
    if (e.type === "assistant") {
      const id = e.message?.id ?? null;
      if (id && id !== last) { apiCalls++; last = id; }
      continue;
    }
    if (e.type !== "user" || e.isMeta) continue;
    const answers = answersOf(e);
    if (answers.length) { for (const a of answers) facts.push({ kind: "answer", question: clip(a.question, 200), answer: clip(a.answer, 200), at }); continue; }
    const text = textOf(e.message?.content).trim();
    if (!text || /^<local-command-(stdout|stderr|caveat)>/.test(text)) continue;
    const cmd = text.match(/<command-name>([^<]+)<\/command-name>/);
    if (cmd) {
      const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
      facts.push({ kind: "command", command: clip(`${cmd[1]!.trim()}${args ? ` ${args}` : ""}`, 200), at });
      continue;
    }
    if (text.startsWith("<")) continue;
    facts.push({ kind: "prompt", text: clip(text), at });
  }
  return { facts, cursor: complete.length, apiCalls, lastMessageId: last };
}

/** The status-line JSON Claude Code handed to `statusline.mjs`, normalised. */
export function readStatusSnapshot(file: string): { status: SessionStatus; sessionId: string | null; transcriptPath: string | null } | null {
  if (!existsSync(file)) return null;
  let s: Record<string, any>;
  try { s = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>; } catch { return null; }
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    sessionId: typeof s.session_id === "string" ? s.session_id : null,
    transcriptPath: typeof s.transcript_path === "string" ? s.transcript_path : null,
    status: {
      costUsd: n(s.cost?.total_cost_usd),
      apiDurationMs: n(s.cost?.total_api_duration_ms),
      durationMs: n(s.cost?.total_duration_ms),
      inputTokens: n(s.context_window?.total_input_tokens),
      outputTokens: n(s.context_window?.total_output_tokens),
      model: typeof s.model?.display_name === "string" ? s.model.display_name : null,
      modelId: typeof s.model?.id === "string" ? s.model.id : null,
      effort: typeof s.effort?.level === "string" ? s.effort.level : null,
      linesAdded: n(s.cost?.total_lines_added),
      linesRemoved: n(s.cost?.total_lines_removed),
      updatedAt: new Date().toISOString(),
    },
  };
}


/* ── for the assistant ────────────────────────────────────────────── */

type Block = { type?: string; text?: string; id?: string; name?: string; input?: Record<string, any>; is_error?: boolean; content?: unknown; tool_use_id?: string };
type RichEntry = Entry & { isSidechain?: boolean; message?: { id?: string; role?: string; content?: unknown; stop_reason?: string | null } };

function readEntries(file: string): { entries: RichEntry[]; lineCount: number } {
  if (!existsSync(file)) return { entries: [], lineCount: 0 };
  // The last line may still be being written; it is left for the next pass, like `scanTranscript`.
  const lines = readFileSync(file, "utf8").split("\n").slice(0, -1);
  const entries: RichEntry[] = lines.map((l) => { try { return JSON.parse(l) as RichEntry; } catch { return {} as RichEntry; } });
  return { entries, lineCount: lines.length };
}

/** What a tool call was, in a few words. */
function toolSummary(b: Block): string {
  const i = b.input ?? {};
  const one = (v: unknown, n = 140) => clip(String(v ?? "").replace(/\s+/g, " ").trim(), n);
  switch (b.name) {
    case "Bash": case "PowerShell": return `${b.name}: ${one(i.command)}`;
    case "Write": case "Edit": case "Read": case "NotebookEdit": return `${b.name}: ${one(i.file_path ?? i.notebook_path)}`;
    case "Grep": case "Glob": return `${b.name}: ${one(i.pattern)}`;
    case "Task": case "Agent": return `${b.name}: ${one(i.description)}`;
    case "AskUserQuestion": return `AskUserQuestion: ${one((i.questions as { question?: string }[] | undefined)?.map((q) => q.question).join(" / "), 220)}`;
    default: return String(b.name ?? "tool");
  }
}

/**
 * A compact reading of the transcript from line `cursor` on, for the assistant:
 * what the person said, what Claude said, which tools it ran (one line each, no
 * output), what failed, and — last — a tool call that is still waiting. Only what
 * is new is returned, so a follow-up question does not pay for what the assistant
 * already read; when the digest is longer than `maxChars` the oldest part is left
 * out and says so.
 */
export function digestTranscript(file: string, cursor: number, maxChars: number): { text: string; cursor: number; entries: number } {
  const { entries, lineCount } = readEntries(file);
  const out: string[] = [];
  let count = 0;
  for (let i = cursor; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.isSidechain || e.isMeta) continue;
    const content = e.message?.content;
    if (e.type === "user") {
      const answers = answersOf(e);
      if (answers.length) { for (const a of answers) out.push(`התשובה שלך: ${clip(a.question, 160)} → ${clip(a.answer, 160)}`); count++; continue; }
      if (Array.isArray(content)) {
        for (const b of content as Block[]) {
          if (b.type === "tool_result" && b.is_error) out.push(`✗ שגיאה בכלי: ${clip(String(typeof b.content === "string" ? b.content : textOf(b.content)).replace(/\s+/g, " "), 160)}`);
        }
      }
      const text = textOf(content).trim();
      if (!text || /^<local-command-(stdout|stderr|caveat)>/.test(text)) continue;
      const cmd = text.match(/<command-name>([^<]+)<\/command-name>/);
      if (cmd) { const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim(); out.push(`אתה הרצת: ${cmd[1]!.trim()}${args ? ` ${clip(args, 200)}` : ""}`); count++; continue; }
      if (text.startsWith("<")) continue;
      out.push(`אתה: ${clip(text, 700)}`);
      count++;
    } else if (e.type === "assistant" && Array.isArray(content)) {
      for (const b of content as Block[]) {
        if (b.type === "text" && b.text?.trim()) { out.push(`Claude: ${clip(b.text.trim(), 1400)}`); count++; }
        else if (b.type === "tool_use") { out.push(`→ ${toolSummary(b)}`); count++; }
      }
    }
  }
  // A tool call after the last "user" entry has no result yet: Claude is running it or waiting for an approval.
  const lastUser = entries.map((e, i) => (e.type === "user" && !e.isSidechain ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  const pending: string[] = [];
  for (let i = Math.max(lastUser + 1, 0); i < entries.length; i++) {
    const e = entries[i]!;
    if (e.type !== "assistant" || e.isSidechain || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message!.content as Block[]) if (b.type === "tool_use") pending.push(toolSummary(b));
  }
  if (pending.length) out.push(`⏳ עדיין ממתין (אישור שלך או פעולה שרצה): ${pending.slice(-3).join(" ; ")}`);

  let text = out.join("\n");
  if (text.length > maxChars) {
    let kept = 0, n = 0;
    for (let i = out.length - 1; i >= 0 && kept + out[i]!.length + 1 <= maxChars; i--) { kept += out[i]!.length + 1; n++; }
    text = `[… ${out.length - n} שורות ישנות יותר הושמטו]\n${out.slice(out.length - n).join("\n")}`;
  }
  return { text, cursor: lineCount, entries: count };
}

/** Whether the session looks ready for typed input: its last real entry is a finished answer. */
export function sessionIdle(file: string): { idle: boolean; why: string } {
  const { entries } = readEntries(file);
  const real = entries.filter((e) => (e.type === "user" || e.type === "assistant") && !e.isMeta && !e.isSidechain);
  const last = real[real.length - 1];
  if (!last) return { idle: false, why: "הסשן עוד לא התחיל לעבוד" };
  if (last.type === "assistant" && last.message?.stop_reason === "end_turn") return { idle: true, why: "" };
  if (last.type === "assistant") return { idle: false, why: "Claude ממתין לאישור שלך או מריץ פעולה" };
  return { idle: false, why: "Claude עובד עכשיו" };
}

/**
 * Whether Claude's last real entry is a finished answer, and how long the
 * transcript is. `/init` has no end marker of its own, so "it is over" is
 * decided by the caller from this plus the worktree: Claude ended a turn (no
 * tool running, no question waiting) AND the copy has changed. Checked against
 * three real runs: the turns that ended before any file was written were a
 * background survey and a plain-text question; the first one after the writes
 * was the summary.
 */
export function turnEnded(file: string): { ended: boolean; lineCount: number } {
  const { entries, lineCount } = readEntries(file);
  const real = entries.filter((e) => (e.type === "user" || e.type === "assistant") && !e.isMeta && !e.isSidechain);
  const last = real[real.length - 1];
  return { ended: last?.type === "assistant" && last.message?.stop_reason === "end_turn", lineCount };
}

/** The number of complete lines in the transcript now (where a later `promptSeenAfter` starts looking). */
export const transcriptLineCount = (file: string): number => readEntries(file).lineCount;

/** Whether the person spoke, after line `from`, a message that starts with `needle` — how DCC checks that a text it typed into the session was really received. */
export function promptSeenAfter(file: string, from: number, needle: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const want = norm(needle).slice(0, 40);
  const { entries } = readEntries(file);
  for (let i = from; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.type === "user" && !e.isMeta && !e.isSidechain && norm(textOf(e.message?.content)).includes(want)) return true;
  }
  return false;
}
