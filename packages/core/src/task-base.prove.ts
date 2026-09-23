/**
 * Proves that a task can be developed before the task it depends on, and
 * that what its branch is built on is right at every step (task-base.ts):
 *
 *   B depends on A. B is developed first → from the default branch, "without A";
 *   its check that needs A waits (not failed). A is developed. B says A exists
 *   now. Rollback + run B again → built on A's branch, the check passes. Push
 *   says to push A first; once A is pushed, B's request targets A's branch. A
 *   moves → B says so.
 *
 * Self-contained and safe while the API is up: its own PGlite directory, its
 * own bare git repository, and a stand-in for the Claude CLI (DCC_CLAUDE_BIN)
 * that edits a file and answers in the real output format — no model is called.
 *
 * Run: `npm run -w @dcc/core prove:built-on`
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const work = mkdtempSync(path.join(os.tmpdir(), "dcc-prove-built-on-"));
process.env.DCC_PGLITE_DIR = path.join(work, "pgdata");
const log = path.join(work, "prompts");
mkdirSync(log);

// ── the stand-in for the Claude CLI ──
const fake = path.join(work, "fake-claude.mjs");
writeFileSync(fake, `
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
let raw = "", done = false;
// A run DCC can steer sends its prompt as one stream-json line and keeps stdin open.
process.stdin.on("data", (d) => {
  raw += d;
  const first = raw.split("\\n")[0];
  if (!done && raw.includes("\\n") && first.startsWith("{")) { done = true; answer(JSON.parse(first).message.content[0].text); }
}).on("end", () => { if (!done) { done = true; answer(raw); } });
function answer(input) {
  appendFileSync(${JSON.stringify(path.join(log, "all.txt"))}, input + "\\n=====\\n");
  const task = input.split("TASK — this is the instruction, follow it exactly:\\n")[1]?.split("\\n")[0] ?? "";
  const file = task.match(/write (\\S+)/)?.[1];
  if (file) writeFileSync(file, "made by " + task + "\\n");
  const block = input.split("report pass/fail for EACH by its number, do not skip any:\\n")[1]?.split("\\n\\n")[0] ?? "";
  const checks = block.split("\\n").map((l) => l.match(/^#(\\d+): (.*)$/)).filter(Boolean).map((m) => {
    const needs = m[2].match(/needs (\\S+)/)?.[1];
    const ok = !needs || existsSync(needs);
    return { seq: Number(m[1]), passed: ok, detail: ok ? "ok" : needs + " is not here", likelyCause: ok ? null : "dependency_missing" };
  });
  const answer = { summary: "did " + task, filesChanged: file ? [file] : [], testsRun: null, followUps: [], affectedConsumers: [], ...(checks.length ? { checks } : {}) };
  process.stdout.write(JSON.stringify({ type: "result", result: JSON.stringify(answer), total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } }) + "\\n", () => process.exit(0));
}
`);
if (process.platform === "win32") {
  writeFileSync(path.join(work, "fake-claude.cmd"), `@node "${fake}" %*\r\n`);
  process.env.DCC_CLAUDE_BIN = path.join(work, "fake-claude.cmd");
} else {
  writeFileSync(path.join(work, "fake-claude"), `#!/bin/sh\nexec node "${fake}" "$@"\n`, { mode: 0o755 });
  process.env.DCC_CLAUDE_BIN = path.join(work, "fake-claude");
}

// ── a fresh database, migrated by the same script dev:setup runs ──
const dbDir = fileURLToPath(new URL("../../db/", import.meta.url));
execFileSync(process.execPath, ["src/dev/setup.ts"], { cwd: dbDir, env: process.env, stdio: "ignore" });

const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=prove", "-c", "user.email=prove@example.com", ...args], { cwd, encoding: "utf8" }).trim();

// Imported only now: the CLI path and the database directory are read when these modules load.
const { db, withTenant, closeDb } = await import("@dcc/db");
const { client, flowRun, task, taskDependency, users, workitem } = await import("@dcc/db/schema");
const { eq } = await import("drizzle-orm");
const core = await import("./index.ts");
const { approveTask, linkRepoToClient, linkRepoToRequirement, pushTask, rollbackTask, startFlowRun, taskBuiltOn } = core;
const { taskBranchName } = await import("./ai-assist.ts");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✕"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};

let cache = "";
try {
const [dev] = await db.insert(users).values({ entraOid: `prove-${Date.now()}`, email: `prove-${Date.now()}@example.com`, displayName: "Prove" }).returning();
const by = { userId: dev!.id };
const [c] = await db.insert(client).values({ name: `prove-built-on-${Date.now()}` }).returning();
const clientId = c!.id;
const [wi] = await withTenant(clientId, (tx) => tx.insert(workitem).values({ clientId, ownerId: dev!.id, key: "PRV-1", title: "built on", type: "story", phase: "building" }).returning());
const workitemId = wi!.id;

// A bare repository as the host, and the cache clone DCC would have made of it.
const origin = path.join(work, "origin.git");
g(work, "init", "--bare", "--initial-branch=main", origin);
const seed = path.join(work, "seed");
g(work, "clone", origin, seed);
writeFileSync(path.join(seed, "base.txt"), "base\n");
g(seed, "add", "-A"); g(seed, "commit", "-m", "base"); g(seed, "push", "origin", "HEAD:main");
const r = await linkRepoToClient({ clientId, name: `prove-repo-${Date.now()}`, gitUrl: "https://example.invalid/prove.git", by });
cache = path.join(os.homedir(), ".dcc-repos", r.id);
g(work, "clone", origin, cache);
await linkRepoToRequirement({ clientId, workitemId, repoId: r.id, by });

// A, and B that depends on A, with a check under B that needs A's file.
const [A, B] = await withTenant(clientId, (tx) => tx.insert(task).values([
  { clientId, workitemId, seq: 1, intent: "A", prompt: "write a.txt", origin: "ai" },
  { clientId, workitemId, seq: 2, intent: "B", prompt: "write b.txt", origin: "ai" },
]).returning());
await withTenant(clientId, (tx) => tx.insert(taskDependency).values({ clientId, taskId: B!.id, dependsOnTaskId: A!.id, reason: "prove" }));
await withTenant(clientId, (tx) => tx.insert(task).values({ clientId, workitemId, seq: 3, kind: "check", intent: "C", prompt: "B works — needs a.txt", parentTaskId: B!.id, origin: "ai" }));
await approveTask(clientId, A!.id, by);
await approveTask(clientId, B!.id, by);

const develop = async (taskId: string) => {
  const { runId } = await startFlowRun({ clientId, workitemId, kind: "implement", taskId, by });
  for (let i = 0; i < 240; i++) {
    const [row] = await db.select().from(flowRun).where(eq(flowRun.id, runId)).limit(1);
    if (row && row.state !== "running") { if (row.state !== "done") throw new Error(`run ${row.state}: ${row.error}`); return row; }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error("run did not finish");
};
const row = async (id: string) => (await withTenant(clientId, (tx) => tx.select().from(task).where(eq(task.id, id)).limit(1)))[0]!;
const lastPrompt = () => execFileSync(process.execPath, ["-e", `process.stdout.write(require("fs").readFileSync(${JSON.stringify(path.join(log, "all.txt"))},"utf8").split("\\n=====\\n").filter(Boolean).pop())`], { encoding: "utf8" });
const branchA = taskBranchName("PRV-1", A!), branchB = taskBranchName("PRV-1", B!);

  // 1. Before anything is developed: B would be built without A.
  let b = await taskBuiltOn(clientId, B!.id);
  check("before anything: B would start from the default branch, without A", b.state === "planned" && !b.on && b.missing.length === 1 && b.missing[0]!.id === A!.id && b.missing[0]!.why === "not_developed", JSON.stringify(b));

  // 2. Develop B first.
  await develop(B!.id);
  check("B developed first is told A is not here yet", lastPrompt().includes("NOT HERE YET — this task depends on work that is not in this branch: #1 (A)."));
  let rb = await row(B!.id);
  check("B records that it was built without A, on the default branch", rb.baseTaskId === null && rb.baseBranch === "main" && JSON.stringify(rb.builtWithout) === JSON.stringify([A!.id]), JSON.stringify(rb));
  const [c1] = await withTenant(clientId, (tx) => tx.select().from(task).where(eq(task.seq, 3)).limit(1));
  check("B's check that needs A waits — it did not fail", c1!.checkResult === "waiting", String(c1!.checkResult));
  check("B is in progress, not 'failed checks'", rb.state === "in_progress", rb.state);

  // 3. Develop A; B now says A exists.
  await develop(A!.id);
  b = await taskBuiltOn(clientId, B!.id);
  check("after A is developed, B says A is available now", b.state === "built" && b.nowAvailable.some((x) => x.id === A!.id), JSON.stringify(b));

  // 4. Rollback B and develop it again: built on A's branch, and the check passes.
  await rollbackTask({ clientId, workitemId, taskId: B!.id, by });
  rb = await row(B!.id);
  check("rollback forgets what B was built on", rb.baseTaskId === null && rb.baseSha === null && (rb.builtWithout as string[]).length === 0, JSON.stringify(rb));
  b = await taskBuiltOn(clientId, B!.id);
  check("after rollback, B would be built on A's branch", b.state === "planned" && b.on?.id === A!.id && b.missing.length === 0, JSON.stringify(b));
  await develop(B!.id);
  check("B developed again is told it is built on A", lastPrompt().includes("BUILT ON — this branch starts from the branch of a task this one depends on, which is not in the default branch yet: #1 (A)."));
  rb = await row(B!.id);
  check("B records A's branch as its base", rb.baseTaskId === A!.id && rb.baseBranch === branchA && (rb.builtWithout as string[]).length === 0, JSON.stringify(rb));
  check("B's branch holds A's work", g(cache, "ls-tree", "--name-only", branchB).split("\n").includes("a.txt"));
  check("B's own work is one commit, A's not counted", g(cache, "rev-list", "--count", `${rb.baseSha}..${branchB}`) === "1");
  const [c2] = await withTenant(clientId, (tx) => tx.select().from(task).where(eq(task.seq, 3)).limit(1));
  check("B's check passes now that A is under it", c2!.checkResult === "passed", String(c2!.checkResult));

  // 5. Push: A first, then B targets A's branch.
  let p = await pushTask({ clientId, workitemId, taskId: B!.id, by });
  check("pushing B before A says to push A first", p.pushed && !!p.note && p.base === "main", JSON.stringify(p));
  await pushTask({ clientId, workitemId, taskId: A!.id, by });
  p = await pushTask({ clientId, workitemId, taskId: B!.id, by });
  check("once A is on the host, B's request targets A's branch", p.pushed && p.base === branchA && !p.note, JSON.stringify(p));

  // 6. A moves on after B was built on it.
  g(cache, "checkout", branchA);
  writeFileSync(path.join(cache, "a2.txt"), "more\n");
  g(cache, "add", "-A"); g(cache, "commit", "-m", "A moves");
  b = await taskBuiltOn(clientId, B!.id);
  check("when A gains work after B was built on it, B says so", b.state === "built" && b.onMoved, JSON.stringify(b));

  // 7. Rollback returns B to A's tip at the time — never into A's work.
  await rollbackTask({ clientId, workitemId, taskId: B!.id, by });
  check("rollback of B stops at A's work", g(cache, "ls-tree", "--name-only", branchB).split("\n").includes("a.txt") && !g(cache, "ls-tree", "--name-only", branchB).split("\n").includes("b.txt"));
} finally {
  await closeDb();
  if (cache) rmSync(cache, { recursive: true, force: true });
  if (existsSync(work)) rmSync(work, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
