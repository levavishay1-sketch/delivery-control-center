#!/usr/bin/env node
// Local verification gate — written by DCC onboarding.
//
// The one command that says whether the work holds: the build, then the
// tests, from the repository root, until the repository has a CI of its own.
// The last line is always one verdict, so a person or an agent can read it
// without reading the log above it:
//   VERIFY: ok                                   exit 0
//   VERIFY: failed <build|test>                  exit 1
//   VERIFY: nothing to run                       exit 0  (no command known)
//   VERIFY: cannot run here (Windows-only build) exit 3  (msbuild repository, not on Windows)
// Run: node scripts/dcc-verify.mjs   (or `npm run verify` when package.json has the script)
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Filled by DCC when the script is written; edit here to change the commands.
const CONFIG = /* @dcc:config */ {};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STEPS = [["build", CONFIG.build], ["test", CONFIG.test]].filter(([, cmd]) => typeof cmd === "string" && cmd.trim());
const TIMEOUT_MS = 30 * 60 * 1000;

if (CONFIG.windowsOnly === true && process.platform !== "win32") {
  console.log("VERIFY: cannot run here (Windows-only build)");
  process.exit(3);
}
if (!STEPS.length) {
  console.log("VERIFY: nothing to run");
  process.exit(0);
}

for (const [name, cmd] of STEPS) {
  console.log(`[verify] ${name}: ${cmd}`);
  const r = spawnSync(cmd, { shell: true, cwd: ROOT, stdio: "inherit", timeout: TIMEOUT_MS });
  if (r.status !== 0) {
    if (r.error) console.log(`[verify] ${name}: ${r.error.code === "ETIMEDOUT" ? `timed out after ${TIMEOUT_MS / 60000} minutes` : r.error.message}`);
    console.log(`VERIFY: failed ${name}`);
    process.exit(1);
  }
}
console.log("VERIFY: ok");
