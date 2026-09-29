import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { git } from "./git.ts";

/**
 * HELPER, a heuristic detector for protocol 5.4 items 5 and 7: the names a
 * task's solution introduces. A token is an identifier of six or more
 * characters on an added line of the diff from the starting state S_c to the
 * task commit c, or the base name of a file c adds, that occurs nowhere in
 * S_c's tree. Finding one in the files delivered to an arm, or in a task's
 * prompt, is a sign that information later than S_c got in.
 *
 * It is a detector, not a proof: a solution can leak without a new name, and
 * a new name can appear by coincidence. Its findings are flags, not verdicts.
 */

const IDENT = /[A-Za-z_][A-Za-z0-9_]{5,}/g;

export function solutionOnlyTokens(source: string, start: string, task: string): string[] {
  const diff = git(source, ["diff", "--unified=0", "--no-color", start, task]);
  const candidates = new Set<string>();
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const m of line.slice(1).matchAll(IDENT)) candidates.add(m[0]);
  }
  const added = git(source, ["diff", "--name-only", "--diff-filter=A", start, task]).split("\n").filter(Boolean);
  for (const f of added) {
    const base = path.posix.basename(f).replace(/\.[^.]+$/, "");
    if (base.length >= 6) candidates.add(base);
  }
  if (candidates.size === 0) return [];
  // Which of them already occur in S_c: one git grep over the whole tree.
  const dir = mkdtempSync(path.join(tmpdir(), "dcc-tokens-"));
  try {
    const list = path.join(dir, "tokens.txt");
    writeFileSync(list, [...candidates].join("\n") + "\n");
    let present = "";
    try { present = git(source, ["grep", "-F", "-w", "-o", "-h", "-I", "-f", list, start]); } catch { present = ""; }
    const inStart = new Set(present.split("\n").map((l) => l.trim()).filter(Boolean));
    const namesInStart = new Set(git(source, ["ls-tree", "-r", "--name-only", start]).split("\n").map((f) => path.posix.basename(f).replace(/\.[^.]+$/, "")));
    return [...candidates].filter((t) => !inStart.has(t) && !namesInStart.has(t)).sort();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Which tokens occur in which of the named texts. */
export function findTokens(texts: Record<string, string>, tokens: readonly string[]): { where: string; token: string }[] {
  const out: { where: string; token: string }[] = [];
  for (const [where, text] of Object.entries(texts)) for (const token of tokens) if (new RegExp(`\\b${token}\\b`).test(text)) out.push({ where, token });
  return out;
}
