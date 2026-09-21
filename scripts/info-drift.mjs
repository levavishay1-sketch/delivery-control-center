#!/usr/bin/env node
// Which explanations a change may have made wrong.
// Run: `npm run info:drift [<git range>]` (default: everything this branch
// adds to master, plus what is not committed yet).
//
// The problem it solves (openspec/changes/info-hints, design §9): the wording
// lives in `packages/core/src/glossary/`, the thing it describes lives in a
// screen. Nothing connects them, so a button that starts writing to TFS keeps
// an "i" that says it does not. This does not try to understand the change —
// it points at the exact explanations that sit on the lines that moved, and
// asks a person the one question a machine cannot answer: did the meaning
// change? Deliberately not a gate: most edits do not change meaning, and a
// check that cries wolf stops being read.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { conceptsUsed, isScreenFile } from "./info-lint.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const norm = (p) => p.split(path.sep).join("/");

/** How close a changed line has to be to an "i" for it to be worth asking about. */
const NEAR = 3;

const range = process.argv[2] ?? (() => {
  try { git("rev-parse", "--verify", "origin/master"); return "origin/master...HEAD"; }
  catch { return "HEAD~1...HEAD"; }
})();

/** The line numbers a diff touches, per file — from `-U0`, so it is the lines themselves. */
function touchedLines(diffArgs) {
  const out = new Map();
  let file = null;
  for (const line of git("diff", "-U0", ...diffArgs).split("\n")) {
    const f = line.match(/^\+\+\+ b\/(.+)$/);
    if (f) { file = norm(f[1]); if (!out.has(file)) out.set(file, new Set()); continue; }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))?/);
    if (h && file) { const start = Number(h[1]), count = h[2] === undefined ? 1 : Number(h[2]); for (let i = 0; i < count; i++) out.get(file).add(start + i); }
  }
  return out;
}

const merge = (a, b) => { for (const [f, s] of b) { if (!a.has(f)) a.set(f, new Set()); for (const n of s) a.get(f).add(n); } return a; };
const touched = merge(touchedLines([range]), touchedLines([]));           // committed on this branch + working tree
merge(touched, touchedLines(["--cached"]));                                // and what is staged

const { getConcept } = await import(pathToFileURL(path.resolve("packages/core/src/glossary/index.ts")).href);

/* ── 1. an explanation sitting on a line the change touched ──────────── */

const suspects = new Map(); // key -> [{ file, line }]
for (const [file, lines] of touched) {
  if (!isScreenFile(file)) continue;
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }   // deleted in this change
  for (const { key, line } of conceptsUsed(text)) {
    const near = [...lines].some((n) => Math.abs(n - line) <= NEAR);
    if (!near) continue;
    if (!suspects.has(key)) suspects.set(key, []);
    suspects.get(key).push({ file, line });
  }
}

/* ── 2. wording that was edited — does the screen still match it? ─────── */

const reworded = [...touched.keys()].filter((f) => /^packages\/core\/src\/glossary\//.test(f));

/* ── the report ──────────────────────────────────────────────────────── */

console.log(`Explanations near what changed (${range}, plus uncommitted)\n`);

if (!suspects.size && !reworded.length) {
  console.log("Nothing to check: this change does not touch a line that carries an \"i\", and no wording was edited.");
  process.exit(0);
}

if (suspects.size) {
  console.log(`${suspects.size} explanation(s) sit on lines this change touched. For each one: does it still say the truth?\n`);
  for (const [key, where] of [...suspects].sort((a, b) => a[0].localeCompare(b[0]))) {
    const c = getConcept(key);
    console.log(`  ${key}${c ? ` — ${c.title}` : "  (no such concept!)"}`);
    if (c) {
      console.log(`     ${c.explain}`);
      if (c.press) console.log(`     בלחיצה: ${c.press}`);
    }
    console.log(`     ${where.map((w) => `${w.file}:${w.line}`).join(", ")}`);
    console.log("");
  }
}

if (reworded.length) {
  console.log(`Wording edited in this change — check the screens that show it still match:\n${reworded.map((f) => "  " + f).join("\n")}\n`);
}

console.log("An explanation that no longer matches is fixed in packages/core/src/glossary/concepts/,");
console.log("in the same change — not left for whoever reads the screen next.");
