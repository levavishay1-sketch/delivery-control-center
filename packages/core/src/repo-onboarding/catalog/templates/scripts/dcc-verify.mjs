#!/usr/bin/env node
// Local verification gate — written by DCC onboarding.
//
// The one command that says whether the work holds: the build, then the
// tests of the test projects git tracks, from the repository root, until the
// repository has a CI of its own. A step may name several ways to run it
// (`msbuild X.sln` or `dotnet msbuild X.sln`): the first one whose tools this
// machine has is the one that runs. On Windows, msbuild and vstest.console
// are also looked for where Visual Studio installs them.
// The last line is always one verdict, so a person or an agent can read it
// without reading the log above it:
//   VERIFY: ok                                        exit 0
//   VERIFY: partial — test not run here (no <tool>)   exit 0  (the build ran and passed; a test tool is missing)
//   VERIFY: failed <build|test>                       exit 1
//   VERIFY: nothing to run                            exit 0  (no command known)
//   VERIFY: cannot run here (no <tool>)               exit 3  (the build's tools are not on this machine)
// Run: node scripts/dcc-verify.mjs   (or `npm run verify` when package.json has the script)
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Filled by DCC when the script is written; edit here to change the commands.
const CONFIG = /* @dcc:config */ {};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = 30 * 60 * 1000;
const WIN = process.platform === "win32";

/** [{ name, run: [alternative, …] }] — or the older { build, test } strings. */
const STEPS = (Array.isArray(CONFIG.steps) ? CONFIG.steps : [{ name: "build", run: [CONFIG.build] }, { name: "test", run: [CONFIG.test] }])
  .map((s) => ({ name: String(s?.name ?? "step"), run: (Array.isArray(s?.run) ? s.run : []).filter((c) => typeof c === "string" && c.trim()) }))
  .filter((s) => s.run.length);

const BUILTINS = new Set(["cd", "echo", "set", "export", "call", "pushd", "popd", "exit", "true", "false", "rem", "if"]);
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/** The first `name` on PATH (with PATHEXT on Windows); a name with a slash is a path from the root. */
function onPath(name) {
  if (/[\\/]/.test(name)) return isFile(path.resolve(ROOT, name)) ? name : null;
  const exts = WIN ? [...(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean), ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) if (isFile(path.join(dir, name + ext))) return path.join(dir, name + ext);
  }
  return null;
}

/** Where Visual Studio keeps a tool that is not on PATH outside a developer prompt. */
const VS_TOOLS = {
  msbuild: [["MSBuild", "Current", "Bin", "MSBuild.exe"], ["MSBuild", "Current", "Bin", "amd64", "MSBuild.exe"], ["MSBuild", "15.0", "Bin", "MSBuild.exe"]],
  "vstest.console": [["Common7", "IDE", "Extensions", "TestPlatform", "vstest.console.exe"], ["Common7", "IDE", "CommonExtensions", "Microsoft", "TestWindow", "vstest.console.exe"]],
};
function inVisualStudio(tails) {
  const roots = [process.env.ProgramFiles ?? "C:\\Program Files", process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"].map((r) => path.join(r, "Microsoft Visual Studio"));
  const version = (v) => { const n = Number(v); return !Number.isInteger(n) ? -1 : n < 100 ? n : ({ 2017: 15, 2019: 16, 2022: 17 })[n] ?? n - 2005; };
  for (const root of roots) {
    let versions;
    try { versions = existsSync(root) ? readdirSync(root) : []; } catch { continue; }
    for (const v of versions.sort((a, b) => version(b) - version(a))) {
      let editions;
      try { editions = readdirSync(path.join(root, v)); } catch { continue; }
      for (const ed of editions.sort()) for (const tail of tails) { const p = path.join(root, v, ed, ...tail); if (isFile(p)) return p; }
    }
  }
  return null;
}

/** The command ready to run, with each tool it starts found; or the first tool this machine does not have. */
function resolve(cmd) {
  let out = cmd;
  for (const segment of cmd.split(/&&|\|\||;|\|/)) {
    const m = /^\s*(?:"([^"]+)"|(\S+))/.exec(segment);
    const word = m ? (m[1] ?? m[2]) : "";
    if (!word || BUILTINS.has(word.toLowerCase()) || /^\w+=/.test(word)) continue;
    if (onPath(word)) continue;
    const vs = WIN ? VS_TOOLS[word.toLowerCase()] : undefined;
    const found = vs ? inVisualStudio(vs) : null;
    if (!found) return { missing: word };
    out = out.replace(word, `"${found}"`);
  }
  return { cmd: out };
}

if (!STEPS.length) {
  console.log("VERIFY: nothing to run");
  process.exit(0);
}

const plan = STEPS.map((s) => {
  const tried = s.run.map(resolve);
  const ok = tried.find((t) => t.cmd);
  return { name: s.name, cmd: ok?.cmd ?? null, missing: [...new Set(tried.filter((t) => t.missing).map((t) => t.missing))] };
});
const build = plan.find((s) => s.name === "build");
if ((build && !build.cmd) || plan.every((s) => !s.cmd)) {
  const missing = [...new Set((build && !build.cmd ? [build] : plan).flatMap((s) => s.missing))];
  console.log(`VERIFY: cannot run here (no ${missing.join(", ")})`);
  process.exit(3);
}

const skipped = [];
for (const step of plan) {
  if (!step.cmd) {
    console.log(`[verify] ${step.name}: not run — this machine has no ${step.missing.join(" / ")}`);
    skipped.push(step);
    continue;
  }
  console.log(`[verify] ${step.name}: ${step.cmd}`);
  const r = spawnSync(step.cmd, { shell: true, cwd: ROOT, stdio: "inherit", timeout: TIMEOUT_MS });
  if (r.status !== 0) {
    if (r.error) console.log(`[verify] ${step.name}: ${r.error.code === "ETIMEDOUT" ? `timed out after ${TIMEOUT_MS / 60000} minutes` : r.error.message}`);
    console.log(`VERIFY: failed ${step.name}`);
    process.exit(1);
  }
}
if (skipped.length) {
  console.log(`VERIFY: partial — ${[...new Set(skipped.map((s) => s.name))].join(", ")} not run here (no ${[...new Set(skipped.flatMap((s) => s.missing))].join(", ")})`);
  process.exit(0);
}
console.log("VERIFY: ok");
