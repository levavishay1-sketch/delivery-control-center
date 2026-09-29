import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * DETECTION of access outside what a run was given (protocol 5.4 item 6, 3.2).
 * None of this prevents anything; it finds traces after the fact:
 *
 *  - canaries: unique tokens planted in places the agent must not read (the
 *    synthetic home, the harness's own materials). A token that turns up in
 *    the agent's output or in its copy means the place was read, however it
 *    was read. A read that leaves no trace in output or copy is missed.
 *  - the transcript: every path named in a tool call, resolved against the
 *    copy's root; one outside it is a finding. It covers what the agent's
 *    tools report, not what a program they start does on its own.
 *  - snapshots: the hashes of watched directories before and after; any
 *    change is a write the run was not allowed.
 */

/** A canary's kind says what reading it means: future information (a reference test from the task commit) or user-level context. */
export type Canary = { kind: "future-information" | "user-context"; token: string; file: string };

export const newCanaryToken = (): string => `DCC-CANARY-${randomBytes(8).toString("hex")}`;

export type Finding = { mechanism: "canary" | "transcript-path" | "snapshot" | "egress-log" | "git-after-run"; detail: string };

/** Which canary tokens occur in the given texts, by name of the text. */
export function scanCanaries(texts: Record<string, string>, canaries: readonly Canary[]): Finding[] {
  const out: Finding[] = [];
  for (const c of canaries) for (const [where, text] of Object.entries(texts)) if (text.includes(c.token)) out.push({ mechanism: "canary", detail: `${c.kind}: token from ${c.file} found in ${where}` });
  return out;
}

/** All text files under a directory (skipping .git), for the canary scan of a copy after the run. */
export function readTextTree(dir: string, maxBytes = 2_000_000): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === ".git") continue;
      const full = path.join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.size <= maxBytes) out[path.relative(dir, full)] = readFileSync(full, "utf8");
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

// A drive letter standing alone (not the end of a URL scheme such as "http:"), followed by one separator.
const WIN_ABS = /(?<![A-Za-z0-9+.-])[A-Za-z]:[\\/](?![\\/])[^\s"'`|<>*?]*/g;
const UNC = /\\\\[^\s"'`|<>*?]+/g;
const POSIX_ABS = /(?:^|[\s"'=(])(\/(?:[^\s"'`|<>*?/]+\/)*[^\s"'`|<>*?/]+)/g;
const HOME_REF = /(?:~[\\/]|%USERPROFILE%|%APPDATA%|\$HOME|\$\{HOME\})[^\s"'`|<>]*/gi;

function stringsIn(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsIn(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) stringsIn(x, out);
}

const inside = (root: string, p: string): boolean => {
  const norm = (s: string) => (process.platform === "win32" ? path.resolve(s).toLowerCase() : path.resolve(s));
  const r = norm(root), q = norm(p);
  return q === r || q.startsWith(r + path.sep);
};

/**
 * Paths named in tool calls (`tool_use` blocks of assistant events) that lie
 * outside `root`. POSIX-looking absolute paths are matched too; on Windows a
 * leading "/" can also be a flag or a URL path, so those findings are marked
 * as heuristic.
 */
export function scanTranscriptPaths(events: readonly Record<string, unknown>[], root: string): Finding[] {
  const out: Finding[] = [];
  for (const ev of events) {
    if (ev.type !== "assistant") continue;
    const content = (ev.message as { content?: unknown[] } | undefined)?.content ?? [];
    for (const block of content as Record<string, unknown>[]) {
      if (block?.type !== "tool_use") continue;
      const strings: string[] = [];
      stringsIn(block.input, strings);
      for (const s of strings) {
        for (const m of s.matchAll(WIN_ABS)) if (!inside(root, m[0])) out.push({ mechanism: "transcript-path", detail: `${String(block.name)}: ${m[0]}` });
        for (const m of s.matchAll(UNC)) out.push({ mechanism: "transcript-path", detail: `${String(block.name)}: ${m[0]} (network path)` });
        for (const m of s.matchAll(HOME_REF)) out.push({ mechanism: "transcript-path", detail: `${String(block.name)}: ${m[0]} (home reference)` });
        if (process.platform === "win32") for (const m of s.matchAll(POSIX_ABS)) out.push({ mechanism: "transcript-path", detail: `${String(block.name)}: ${m[1]} (heuristic, POSIX-style absolute)` });
        else for (const m of s.matchAll(POSIX_ABS)) if (!inside(root, m[1]!)) out.push({ mechanism: "transcript-path", detail: `${String(block.name)}: ${m[1]}` });
        for (const m of s.matchAll(/(?:^|[\s"'])((?:\.\.[\\/])+[^\s"'`|<>]*)/g)) if (!inside(root, path.resolve(root, m[1]!))) out.push({ mechanism: "transcript-path", detail: `${String(block.name)}: ${m[1]} (leaves the root)` });
      }
    }
  }
  return out;
}

/** Hash of every file under a directory, by relative path. */
export function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else out.set(path.relative(dir, full), createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

export function diffSnapshots(label: string, before: Map<string, string>, after: Map<string, string>): Finding[] {
  const out: Finding[] = [];
  for (const [p, h] of after) {
    if (!before.has(p)) out.push({ mechanism: "snapshot", detail: `${label}: added ${p}` });
    else if (before.get(p) !== h) out.push({ mechanism: "snapshot", detail: `${label}: changed ${p}` });
  }
  for (const p of before.keys()) if (!after.has(p)) out.push({ mechanism: "snapshot", detail: `${label}: removed ${p}` });
  return out;
}
