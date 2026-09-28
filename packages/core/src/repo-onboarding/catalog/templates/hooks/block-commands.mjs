#!/usr/bin/env node
// PreToolUse hook on Bash | PowerShell — written by DCC onboarding.
//
// Denies a shell command that contains one of the PATTERNS. The comparison is
// case-insensitive with line continuations removed and whitespace collapsed
// to single spaces, so `terraform   apply` and `terraform \` + newline +
// `apply` are caught too. Exit 2 + stderr is how a PreToolUse hook denies in
// Claude Code; the reason is handed back to Claude. Test it without Claude:
//   node block-commands.mjs < event.json
import { readFileSync } from "node:fs";

// Filled by DCC when the hook is written; edit here to change the list.
const CONFIG = /* @dcc:config */ {};
const flatten = (s) => String(s).toLowerCase().replace(/\\\r?\n/g, " ").replace(/\s+/g, " ");
const PATTERNS = (Array.isArray(CONFIG.patterns) ? CONFIG.patterns : []).map(flatten).filter((p) => p.trim());
const REASON = typeof CONFIG.reason === "string" && CONFIG.reason ? CONFIG.reason : "this command is a person's decision";

function readEvent() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

const event = readEvent();
if (!/^(Bash|PowerShell)$/.test(event.tool_name ?? "")) process.exit(0);
const command = typeof event.tool_input?.command === "string" ? flatten(event.tool_input.command) : "";
if (!command) process.exit(0);

const hit = PATTERNS.find((p) => command.includes(p));
if (!hit) process.exit(0);
process.stderr.write(`Blocked: the command contains "${hit.trim()}" — ${REASON}.\n`);
process.exit(2);
