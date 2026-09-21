#!/usr/bin/env node
// PostToolUse hook, on Edit / Write / MultiEdit.
//
// The "i" rule (openspec/changes/info-hints) is held in three places, in
// order of strength: the required `info` prop, which a screen cannot compile
// without; `npm run audit:stale`, which is the gate; and this hook, which
// says it the moment the file is saved rather than at the end of the task —
// so the fix costs one line instead of a second pass over ten screens.
//
// It never blocks: the edit has already happened. Exit code 2 hands the note
// back to Claude as feedback on its own edit.
import { readFileSync } from "node:fs";
import path from "node:path";
import { readHookInput } from "./lib.mjs";
import { isScreenFile, rawHeadings, unexplained } from "../scripts/info-lint.mjs";

const input = readHookInput();
if (!/^(Edit|Write|MultiEdit)$/.test(input.tool_name ?? "")) process.exit(0);

const file = input.tool_input?.file_path;
if (typeof file !== "string") process.exit(0);

const root = input.cwd || process.cwd();
const rel = path.relative(root, file).split(path.sep).join("/");
if (!isScreenFile(rel)) process.exit(0);

let text;
try { text = readFileSync(file, "utf8"); } catch { process.exit(0); }

const missing = unexplained(text);
const headings = rawHeadings(text);
if (!missing.length && !headings.length) process.exit(0);

const lines = [`${rel} — the "i" rule (see the info-hints skill):`];
for (const h of headings) lines.push(`  ${h.line}: a heading written by hand — use PageHead or CardTitle, which carry the "i"`);
for (const m of missing) lines.push(`  ${m.line}: [${m.what}] "${m.text}" names something but opens no explanation`);
lines.push(`Add <Info k="…" /> with a concept from packages/core/src/glossary/concepts/,`);
lines.push(`or put {/* no-info: why */} on the line above when the name really is the whole explanation.`);

console.error(lines.join("\n"));
process.exit(2);
