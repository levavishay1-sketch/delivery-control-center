#!/usr/bin/env node
// Brings this folder in step with the repository after pull requests were merged, and says what is left.
// Run: `npm run sync` — at the start of every new piece of work, and as soon as something was merged.
//
// It only ever moves forward and never loses work:
//   - fetches, and drops the remote branches that no longer exist;
//   - if the branch you are on is already entirely in master, switches to master;
//   - on master, fast-forwards it to origin/master;
//   - deletes local branches that are entirely in master (`git branch -d`, which refuses anything else).
// It never pushes, never resets, and never touches uncommitted files.
// Exit code 1 when something needs a look; the report says what.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const MAIN = "master";

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
};
const git = (...args) => run("git", args);
const lines = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean);

let problems = 0;
const ok = (t) => console.log(`✓ ${t}`);
const note = (t, rest = []) => { console.log(`\n· ${t}`); rest.forEach((l) => console.log("   " + l)); };
const bad = (t, rest = []) => { problems++; console.log(`\n✗ ${t}`); rest.forEach((l) => console.log("   " + l)); };

// 1. What the server has now.
const fetched = git("fetch", "--prune", "origin");
if (fetched.code !== 0) bad("could not reach origin — what follows is from the last time it was reached", [fetched.err.split("\n")[0] ?? ""]);
else ok("fetched origin");

// 2. Get onto an up-to-date master, when the branch we are on is already entirely in it.
let current = git("branch", "--show-current").out;
const tip = (ref) => git("rev-parse", ref).out;
const mainTip = tip(`origin/${MAIN}`);
const inMaster = (ref) => git("merge-base", "--is-ancestor", ref, `origin/${MAIN}`).code === 0;
if (current && current !== MAIN) {
  // A branch that sits exactly on master has nothing on it: it was just opened (a merged branch is behind master,
  // because master got the merge commit on top of it). It is not finished — leave it.
  if (tip("HEAD") === mainTip) {
    note(`on "${current}", opened from ${MAIN} with nothing committed on it yet — left as it is`);
  } else if (inMaster("HEAD")) {
    const sw = git("switch", MAIN);
    if (sw.code === 0) { ok(`"${current}" was already in ${MAIN} — switched to ${MAIN}`); current = MAIN; }
    else bad(`"${current}" is already in ${MAIN}, but git would not switch (an uncommitted file is in the way)`, [sw.err.split("\n")[0] ?? ""]);
  } else {
    const ahead = git("rev-list", "--count", `origin/${MAIN}..HEAD`).out;
    note(`on "${current}", which has ${ahead} commit(s) not in ${MAIN} yet — work in progress, left as it is`);
  }
}
if (current === MAIN) {
  const ff = git("merge", "--ff-only", `origin/${MAIN}`);
  if (ff.code !== 0) bad(`${MAIN} could not be fast-forwarded to origin/${MAIN}`, [ff.err.split("\n")[0] ?? ""]);
  const local = git("rev-parse", MAIN).out;
  const remote = git("rev-parse", `origin/${MAIN}`).out;
  if (local === remote) ok(`${MAIN} is origin/${MAIN} (${local.slice(0, 7)})`);
  else bad(`${MAIN} differs from origin/${MAIN}`, [`local ${local.slice(0, 7)} · origin ${remote.slice(0, 7)}`]);
}

// 3. Local branches: what is entirely in master goes; anything else is reported, never deleted.
const local = lines(git("branch", "--format=%(refname:short)").out).filter((b) => b !== MAIN && b !== current);
const gone = [];
const kept = [];
const empty = [];
for (const b of local) {
  if (tip(b) === mainTip) empty.push(b); // opened from master, nothing on it: not touched
  else if (inMaster(b) && git("branch", "-d", b).code === 0) gone.push(b);
  else kept.push(b);
}
if (gone.length) ok(`deleted ${gone.length} local branch(es) already in ${MAIN}: ${gone.join(", ")}`);
if (empty.length) note("local branches with nothing on them yet (same commit as master), left as they are", empty);
if (kept.length) bad("local branches with work that is not in master", kept);
else if (!empty.length) ok("no local branches left over");

// 4. The server: only master, and no open request.
const remoteBranches = lines(git("ls-remote", "--heads", "origin").out).map((l) => l.replace(/^.*refs\/heads\//, "")).filter((b) => b !== MAIN);
if (remoteBranches.length) bad("branches on the server other than master", remoteBranches);
else ok("the server has only master");

const GH = ["C:\\Program Files\\GitHub CLI\\gh.exe", "gh"].find((c) => c === "gh" || existsSync(c));
const ghOk = run(GH, ["--version"]).code === 0;
if (!ghOk) note("the GitHub CLI was not found — open pull requests were not checked");
else {
  const open = run(GH, ["pr", "list", "--state", "open", "--json", "number,headRefName", "--jq", '.[] | "#\\(.number)  \\(.headRefName)"']);
  if (open.code !== 0) note("could not list open pull requests", [open.err.split("\n")[0] ?? ""]);
  else if (open.out) bad("open pull requests", lines(open.out));
  else ok("no open pull requests");
}

// 5. Other folders and stashes.
git("worktree", "prune");
const trees = lines(git("worktree", "list").out);
if (trees.length > 1) bad("other working folders of this repository", trees.slice(1));
else ok("no other working folders");
const stashes = lines(git("stash", "list").out);
if (stashes.length) bad("stashed changes", stashes);
else ok("no stashes");

// 6. What is uncommitted on purpose or not — said, not judged.
const dirty = lines(git("status", "--short").out);
if (dirty.length) note("uncommitted", dirty);
const waiting = lines(git("diff", "docs/wishlist.md").out).filter((l) => /^\+- \*\*/.test(l));
if (waiting.length) note(`${waiting.length} wishlist entr${waiting.length === 1 ? "y is" : "ies are"} waiting for a pull request`);

// 7. The running app.
try {
  const r = await fetch("http://localhost:3001/health", { signal: AbortSignal.timeout(2000) });
  console.log(`\n· the API answers on :3001 (${r.status})`);
} catch {
  console.log("\n· the API is not answering on :3001");
}

console.log(problems ? `\n${problems} thing(s) to look at.` : "\nClean.");
process.exit(problems ? 1 : 0);
