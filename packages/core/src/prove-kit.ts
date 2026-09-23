/**
 * What the development prove scripts share: a world of their own — a fresh
 * PGlite directory, a bare git repository as the host with DCC's cache clone
 * of it, a requirement linked to it — and a stand-in for the Claude CLI
 * (DCC_CLAUDE_BIN) that answers in the real output format without calling a
 * model. Safe while the API is up: nothing here touches its database or clones.
 *
 * The stand-in: a development prompt writes the file its instruction names
 * ("write b.txt"). A checks prompt reports each check — a check that "needs
 * x.txt" waits for it when x.txt is not in the branch, a build check fails
 * while "broken.txt" is there, a check that says "tamper" changes a tracked
 * file (which DCC must put back), everything else passes.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FAKE = `
import { existsSync, writeFileSync, appendFileSync } from "node:fs";
let raw = "", done = false;
// A run DCC can steer sends its prompt as one stream-json line and keeps stdin open.
process.stdin.on("data", (d) => {
  raw += d;
  const first = raw.split("\\n")[0];
  if (!done && raw.includes("\\n") && first.startsWith("{")) { done = true; answer(JSON.parse(first).message.content[0].text); }
}).on("end", () => { if (!done) { done = true; answer(raw); } });
function answer(input) {
  appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args: process.argv.slice(2), prompt: input }) + "\\n");
  let out;
  if (input.includes("You are VERIFYING a change in this repository")) {
    const block = input.split("do not skip any:\\n")[1]?.split("\\n\\n")[0] ?? "";
    const checks = block.split("\\n").map((l) => l.match(/^#(\\d+)(?: \\[(\\w+)\\])?: (.*)$/)).filter(Boolean).map((m) => {
      const seq = Number(m[1]), kind = m[2], text = m[3];
      if (/tamper/.test(text)) writeFileSync("base.txt", "tampered\\n");
      const needs = text.match(/needs (\\S+)/)?.[1];
      if (needs && !existsSync(needs)) return { seq, passed: false, detail: needs + " is not here", likelyCause: "dependency_missing" };
      if (kind === "build" && existsSync("broken.txt")) return { seq, passed: false, detail: "does not compile", likelyCause: "implementation" };
      return { seq, passed: true, detail: "ok", likelyCause: null };
    });
    out = { summary: "checked", checks };
  } else {
    const task = input.split("TASK — this is the instruction, follow it exactly:\\n")[1]?.split("\\n")[0] ?? "";
    const file = task.match(/write (\\S+)/)?.[1];
    if (file) writeFileSync(file, "made by " + task + "\\n");
    out = { summary: "did " + task, filesChanged: file ? [file] : [], testsRun: null, followUps: [], affectedConsumers: [] };
  }
  process.stdout.write(JSON.stringify({ type: "result", result: JSON.stringify(out), total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } }) + "\\n", () => process.exit(0));
}
`;

export async function proveKit(name: string) {
  const work = mkdtempSync(path.join(os.tmpdir(), `dcc-prove-${name}-`));
  process.env.DCC_PGLITE_DIR = path.join(work, "pgdata");
  const log = path.join(work, "claude-calls.ndjson");
  writeFileSync(log, "");
  process.env.FAKE_CLAUDE_LOG = log;
  const fake = path.join(work, "fake-claude.mjs");
  writeFileSync(fake, FAKE);
  if (process.platform === "win32") {
    writeFileSync(path.join(work, "fake-claude.cmd"), `@node "${fake}" %*\r\n`);
    process.env.DCC_CLAUDE_BIN = path.join(work, "fake-claude.cmd");
  } else {
    writeFileSync(path.join(work, "fake-claude"), `#!/bin/sh\nexec node "${fake}" "$@"\n`, { mode: 0o755 });
    process.env.DCC_CLAUDE_BIN = path.join(work, "fake-claude");
  }
  // A fresh database, migrated by the same script dev:setup runs.
  execFileSync(process.execPath, ["src/dev/setup.ts"], { cwd: fileURLToPath(new URL("../../db/", import.meta.url)), env: process.env, stdio: "ignore" });

  // Imported only now: the CLI path and the database directory are read when these modules load.
  const dbm = await import("@dcc/db");
  const schema = await import("@dcc/db/schema");
  const { eq } = await import("drizzle-orm");
  const core = await import("./index.ts");
  const ai = await import("./ai-assist.ts");

  const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=prove", "-c", "user.email=prove@example.com", ...args], { cwd, encoding: "utf8" }).trim();
  let failed = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "✓" : "✕"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
    if (!ok) failed++;
  };

  const stamp = Date.now();
  const [dev] = await dbm.db.insert(schema.users).values({ entraOid: `prove-${stamp}`, email: `prove-${stamp}@example.com`, displayName: "Prove" }).returning();
  const by = { userId: dev!.id };
  const [c] = await dbm.db.insert(schema.client).values({ name: `prove-${name}-${stamp}` }).returning();
  const clientId = c!.id;
  const [wi] = await dbm.withTenant(clientId, (tx) => tx.insert(schema.workitem).values({ clientId, ownerId: dev!.id, key: "PRV-1", title: name, type: "story", phase: "building" }).returning());
  const workitemId = wi!.id;

  // A bare repository as the host, and the cache clone DCC would have made of it.
  const origin = path.join(work, "origin.git");
  g(work, "init", "--bare", "--initial-branch=main", origin);
  const seed = path.join(work, "seed");
  g(work, "clone", "--quiet", origin, seed);
  writeFileSync(path.join(seed, "base.txt"), "base\n");
  g(seed, "add", "-A"); g(seed, "commit", "--quiet", "-m", "base"); g(seed, "push", "--quiet", "origin", "HEAD:main");
  const r = await core.linkRepoToClient({ clientId, name: `prove-repo-${stamp}`, gitUrl: "https://example.invalid/prove.git", by });
  const cache = path.join(os.homedir(), ".dcc-repos", r.id);
  g(work, "clone", "--quiet", origin, cache);
  await core.linkRepoToRequirement({ clientId, workitemId, repoId: r.id, by });

  const T = schema.task;
  let seq = 0;
  /** A task under the requirement (a check when `parent` is given), inserted as the breakdown would. */
  const addTask = async (intent: string, prompt: string, o: { parent?: string; dependsOn?: string[] } = {}) => {
    const [row] = await dbm.withTenant(clientId, (tx) => tx.insert(T).values({
      clientId, workitemId, seq: ++seq, intent, prompt, origin: "ai", kind: o.parent ? "check" : "task", parentTaskId: o.parent ?? null,
    }).returning());
    for (const d of o.dependsOn ?? []) await dbm.withTenant(clientId, (tx) => tx.insert(schema.taskDependency).values({ clientId, taskId: row!.id, dependsOnTaskId: d, reason: "prove" }));
    return row!;
  };
  /** Keeps the local seq counter ahead of rows the code added itself (the checks DCC adds). */
  const syncSeq = async () => {
    const all = await dbm.withTenant(clientId, (tx) => tx.select({ seq: T.seq }).from(T).where(eq(T.workitemId, workitemId)));
    seq = Math.max(seq, ...all.map((x) => x.seq));
  };
  const row = async (id: string) => (await dbm.withTenant(clientId, (tx) => tx.select().from(T).where(eq(T.id, id)).limit(1)))[0]!;
  /** What creating the task in TFS does: a work item id on it, and on its checks (they are recorded on the task's item). */
  const inTfs = async (id: string) => {
    const adoId = 90_000 + (await row(id)).seq;
    await dbm.withTenant(clientId, (tx) => tx.update(T).set({ linkedAdoId: adoId }).where(eq(T.id, id)));
    await dbm.withTenant(clientId, (tx) => tx.update(T).set({ linkedAdoId: adoId }).where(eq(T.parentTaskId, id)));
  };
  const checksOf = async (id: string) => (await dbm.withTenant(clientId, (tx) => tx.select().from(T).where(eq(T.parentTaskId, id)))).sort((a, b) => a.seq - b.seq);
  const develop = async (taskId: string) => {
    const { runId } = await core.startFlowRun({ clientId, workitemId, kind: "implement", taskId, by });
    for (let i = 0; i < 480; i++) {
      const [run] = await dbm.db.select().from(schema.flowRun).where(eq(schema.flowRun.id, runId)).limit(1);
      if (run && run.state !== "running") {
        if (run.state !== "done") throw new Error(`run ${run.state}: ${run.error}`);
        await syncSeq();
        return run;
      }
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error("run did not finish");
  };
  /** Every call the stand-in answered since `from`, in order. */
  const calls = (from = 0) => readFileSync(log, "utf8").split("\n").filter(Boolean).slice(from).map((l) => JSON.parse(l) as { args: string[]; prompt: string });
  const callCount = () => calls().length;
  const branchOf = (t: { seq: number; intent: string }) => ai.taskBranchName("PRV-1", t);

  const finish = async () => {
    await dbm.closeDb();
    rmSync(cache, { recursive: true, force: true });
    if (existsSync(work)) rmSync(work, { recursive: true, force: true });
    console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
    process.exit(failed ? 1 : 0);
  };

  return { work, cache, clientId, workitemId, by, g, check, addTask, syncSeq, row, inTfs, checksOf, develop, calls, callCount, branchOf, finish, core, ai, dbm, schema, eq };
}

