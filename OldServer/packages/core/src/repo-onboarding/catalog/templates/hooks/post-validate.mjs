#!/usr/bin/env node
// PostToolUse hook on Edit | Write | MultiEdit — written by DCC onboarding.
//
// When the edited file's path matches MATCH, runs `COMMAND <file>` on it (a
// schema check, a notebook validator, a linter that knows the format). The
// edit has already happened, so this cannot deny it; exit 2 hands the
// validator's output back to Claude as feedback on its own edit, which is
// what makes it fix the file now instead of at the end. Test it without Claude:
//   node post-validate.mjs < event.json
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Filled by DCC when the hook is written; `match` is a regular expression
// over the file path (forward slashes), `command` gets the path appended.
const CONFIG = /* @dcc:config */ {};
const MATCH = typeof CONFIG.match === "string" && CONFIG.match ? new RegExp(CONFIG.match) : null;
const COMMAND = typeof CONFIG.command === "string" ? CONFIG.command.trim() : "";
const TIMEOUT_MS = 120 * 1000;
const TAIL = 40;

function readEvent() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

const quote = (s) => (process.platform === "win32" ? `"${s}"` : `"${String(s).replace(/(["\\$`])/g, "\\$1")}"`);

const event = readEvent();
if (!MATCH || !COMMAND || !/^(Edit|Write|MultiEdit)$/.test(event.tool_name ?? "")) process.exit(0);
const file = event.tool_input?.file_path;
if (typeof file !== "string" || !MATCH.test(file.replace(/\\/g, "/"))) process.exit(0);

const cwd = event.cwd || process.cwd();
const rel = (path.isAbsolute(file) ? path.relative(cwd, file) : file).replace(/\\/g, "/");
const r = spawnSync(`${COMMAND} ${quote(file)}`, { shell: true, cwd, encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
if (r.status === 0) process.exit(0);

const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.split(/\r?\n/).filter((l) => l.trim()).slice(-TAIL).join("\n");
const why = r.error ? (r.error.code === "ETIMEDOUT" ? `timed out after ${TIMEOUT_MS / 1000} s` : r.error.message) : `exit code ${r.status}`;
process.stderr.write(`${rel}: \`${COMMAND}\` failed (${why}) — fix the file:\n${out}\n`);
process.exit(2);
