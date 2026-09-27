#!/usr/bin/env node
// PostToolUse hook on Edit | Write | MultiEdit — written by DCC onboarding.
//
// Runs the repository's formatter on the file that was just edited, so the
// diff never carries formatting noise. It never blocks: the edit has already
// happened, and a formatter that is missing or unhappy is not Claude's
// problem to solve mid-task — the failure is printed and the hook exits 0.
// Test it without Claude: node post-format.mjs < event.json
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Filled by DCC when the hook is written: the formatter's command (the file
// path is appended) and the extensions it formats; a null command does nothing.
const CONFIG = /* @dcc:config */ {};
const COMMAND = Array.isArray(CONFIG.command) && CONFIG.command.length ? CONFIG.command.map(String) : null;
const EXTENSIONS = Array.isArray(CONFIG.extensions) ? CONFIG.extensions.map((e) => String(e).toLowerCase()) : [];
const TIMEOUT_MS = 60 * 1000;

function readEvent() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

const quote = (s) => (process.platform === "win32" ? `"${s}"` : `"${String(s).replace(/(["\\$`])/g, "\\$1")}"`);

const event = readEvent();
if (!COMMAND || !/^(Edit|Write|MultiEdit)$/.test(event.tool_name ?? "")) process.exit(0);
const file = event.tool_input?.file_path;
if (typeof file !== "string" || !file) process.exit(0);
if (EXTENSIONS.length && !EXTENSIONS.includes(path.extname(file).toLowerCase())) process.exit(0);

const cwd = event.cwd || process.cwd();
const r = spawnSync([...COMMAND, quote(file)].join(" "), { shell: true, cwd, encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
if (r.status !== 0) {
  const tail = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.split(/\r?\n/).filter((l) => l.trim()).slice(-3).join(" | ");
  process.stdout.write(`[post-format] ${COMMAND[0]} did not format ${path.basename(file)}: ${r.error?.message ?? tail ?? `exit ${r.status}`}\n`);
}
process.exit(0);
