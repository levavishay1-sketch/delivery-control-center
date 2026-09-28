#!/usr/bin/env node
// Stop hook — written by DCC onboarding.
//
// When Claude is about to end its turn, runs the build. A failing build goes
// back to Claude (exit 2, the last lines on stderr) so it keeps working
// instead of saying "done" over code that does not compile. A passing build,
// or no build command, exits 0 and Claude stops.
//
// `stop_hook_active` is Claude Code's own flag that a Stop hook has already
// continued this turn once; then the hook lets Claude stop, or it could loop
// for ever on a build it cannot fix. Test it without Claude:
//   node build-gate.mjs < event.json
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Filled by DCC when the hook is written; edit here to change the command.
const CONFIG = /* @dcc:config */ {};
const COMMAND = typeof CONFIG.command === "string" ? CONFIG.command.trim() : "";
const TIMEOUT_MS = 10 * 60 * 1000;
const TAIL = 40;

function readEvent() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

const event = readEvent();
if (event.stop_hook_active === true) process.exit(0);
if (!COMMAND) process.exit(0);

const cwd = event.cwd || process.cwd();
const r = spawnSync(COMMAND, { shell: true, cwd, encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
if (r.status === 0) process.exit(0);

const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.split(/\r?\n/).filter((l) => l.trim()).slice(-TAIL).join("\n");
const why = r.error ? (r.error.code === "ETIMEDOUT" ? `timed out after ${TIMEOUT_MS / 60000} minutes` : r.error.message) : `exit code ${r.status}`;
process.stderr.write(`The build (\`${COMMAND}\`) failed — ${why}. Fix it before finishing:\n${out}\n`);
process.exit(2);
