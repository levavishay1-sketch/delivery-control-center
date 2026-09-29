import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyChain } from "../evidence.ts";
import { buildAgentCopy } from "../isolation/copy.ts";
import { makeFixtureRepo, type FixtureCommits } from "../isolation/fixture.ts";
import { git } from "../isolation/git.ts";
import { runIsolated, type IsolatedRun, type RunReport } from "./harness.ts";
import { defaultRunRoot, prepareToolchain, realIdentity, stageMockAgent, underProfile, type Toolchain } from "./toolchain.ts";

/**
 * The runner with a mock agent, under a run root outside the user's profile.
 * The test names keep three kinds of result apart:
 *   "prevented"     an enforcement mechanism stopped it;
 *   "detected"      a mechanism found it after the fact;
 *   "NOT detected"  a documented limit; the test asserts the gap, and that
 *                   the classification does not call such a run clean.
 * No model, no network beyond 127.0.0.1, no change to the machine's settings,
 * and neither the real repository nor the real Claude configuration is used.
 */

let tc: Toolchain;
let mock: string;
let testRoot: string;
let source: string;
let c: FixtureCommits;
let n = 0;
const reports: RunReport[] = [];
const measured: Record<string, unknown>[] = [];

beforeAll(() => {
  const runRoot = defaultRunRoot();
  tc = prepareToolchain(runRoot);
  mock = stageMockAgent(tc);
  testRoot = path.join(runRoot, "tests", `r-${process.pid}-${Date.now()}`);
  mkdirSync(testRoot, { recursive: true });
  source = path.join(testRoot, "source");
  c = makeFixtureRepo(source);
}, 120_000);

afterAll(() => {
  if (measured.length) console.info("measured overshoot:", JSON.stringify(measured));
  rmSync(testRoot, { recursive: true, force: true });
});

type Extra = (ctx: { home: string; runDir: string; harnessDir: string; canaries: { kind: string; token: string; file: string }[] }) => Record<string, string>;

async function run(scenario: string, over: Partial<IsolatedRun> = {}, extra: Extra = () => ({})): Promise<RunReport> {
  const id = ++n;
  const { dir } = buildAgentCopy({ source, start: c.start, target: path.join(testRoot, `copy-${id}`), scratch: path.join(testRoot, "scratch") });
  const r = await runIsolated({
    copy: dir, start: c.start, task: c.task, source, runDir: path.join(testRoot, `run-${id}`), toolchain: tc,
    command: tc.node, args: [mock], caps: { wallMs: 20_000, maxTurns: 50, maxOutputBytes: 5_000_000, maxCostUsd: 1 },
    allowEgress: () => false,
    extraEnv: (ctx) => ({ MOCK_SCENARIO: scenario, ...extra(ctx) }),
    ...over,
  });
  reports.push(r);
  return r;
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const size = (f: string) => (existsSync(f) ? statSync(f).size : 0);
async function stillBeating(file: string): Promise<boolean> {
  const a = size(file);
  await new Promise((r) => setTimeout(r, 400));
  return size(file) > a;
}

describe("the environment the agent sees", () => {
  it("prevented: no real profile path or user name in any variable the harness controls, the working directory, argv or the home and temp folders", async () => {
    let dump = "";
    const r = await run("env-dump", {}, (ctx) => ({ MOCK_DUMP_FILE: (dump = path.join(ctx.runDir, "dump.json")) }));
    const seen = JSON.parse(readFileSync(dump, "utf8")) as { env: Record<string, string>; cwd: string; execPath: string; argv: string[]; homedir: string; tmpdir: string; userInfo: { username: string; homedir: string } };
    const { profiles, user } = realIdentity();
    const shortUser = path.basename(profiles.at(-1)!);
    const exposes = (v: string) => { const l = v.toLowerCase(); return profiles.some((p) => l.includes(p)) || (user !== "" && l.includes(user)) || l.includes(shortUser); };
    const machineInjected = (k: string) => /^BPPDOMAIN_MANAGER_/.test(k);
    const leaking = Object.entries(seen.env).filter(([k, v]) => !machineInjected(k) && exposes(String(v))).map(([k]) => k);
    expect(leaking, `variables exposing the real user: ${leaking.join(",")}`).toEqual([]);
    for (const [what, v] of [["cwd", seen.cwd], ["execPath", seen.execPath], ["argv", seen.argv.join(" ")], ["homedir", seen.homedir], ["tmpdir", seen.tmpdir]] as const) expect(exposes(v), what).toBe(false);
    expect(seen.env.PATH?.split(path.delimiter)).toEqual(tc.pathDirs);
    expect(tc.pathDirs.some(underProfile)).toBe(false);
    // Not hidden, and not hideable without a separate OS account: the account itself.
    expect(exposes(seen.userInfo.username) || exposes(seen.userInfo.homedir)).toBe(true);
    expect(r.enforcement.processIdentity).toMatch(/NOT HIDDEN/);
  }, 60_000);

  it("the agent can still run the tools it needs, and nothing else is on its PATH", async () => {
    const r = await run("tools-check");
    const tools = JSON.parse(String(r.process!.resultEvent!.result)) as Record<string, string>;
    expect(tools.node).toMatch(/^runs \(exit 0\)/);
    expect(tools.git).toMatch(/^runs \(exit 0\)/);
    for (const t of ["npm", "npx", "dotnet", "claude", "curl", "powershell", "bash", "where", "cmd"]) expect(tools[t], t).toMatch(/^not found/);
  }, 60_000);
});

describe("classification never calls a run clean on the strength of silence", () => {
  it("a normal run: isolation BLOCKED, not PASS", async () => {
    const r = await run("normal");
    expect(r.process!.status).toBe("ENDED");
    expect(r.classification).toMatchObject({ run: null, copyBeforeRun: "PASS", temporalOrderDuringRun: "BLOCKED", isolation: "BLOCKED" });
  }, 60_000);

  it("REGRESSION, NOT detected: a silent read of the reference test is BLOCKED, never clean", async () => {
    const r = await run("read-silently", {}, (ctx) => ({ MOCK_TARGETS: ctx.canaries.find((k) => k.kind === "future-information")!.file }));
    expect(r.findings).toEqual([]);
    expect(r.classification.isolation).toBe("BLOCKED");
    expect(r.classification.temporalOrderDuringRun).toBe("BLOCKED");
    // The copy check before the run may PASS; the claims about the run itself may not.
    expect(r.classification.isolation).not.toBe("PASS");
    expect(JSON.stringify(r)).not.toMatch(/"VALID"/);
  }, 60_000);

  it("REGRESSION, NOT detected and NOT prevented: a direct socket that bypasses the proxy; network isolation BLOCKED", async () => {
    const received: string[] = [];
    const listener = net.createServer((s) => { let d = ""; s.on("data", (b) => { d += b.toString(); }); s.on("end", () => received.push(d)); });
    await new Promise<void>((res) => listener.listen(0, "127.0.0.1", res));
    const port = (listener.address() as net.AddressInfo).port;
    try {
      const r = await run("network-direct", {}, () => ({ MOCK_DIRECT_PORT: String(port) }));
      await new Promise((res) => setTimeout(res, 200));
      expect(received).toEqual(["leaked-payload"]);
      expect(r.egress).toEqual([]);
      expect(r.classification.marks).toEqual([]);
      expect(r.classification.isolation).toBe("BLOCKED");
      expect(r.enforcement.egressDirect).toMatch(/NOT BLOCKED AND NOT RECORDED/);
    } finally {
      listener.close();
    }
  }, 60_000);

  it("detected: reading the reference test by absolute path is information later than S_c, INVALID; the user memory read too", async () => {
    const r = await run("read-forbidden", {}, (ctx) => ({ MOCK_TARGETS: ctx.canaries.map((x) => x.file).join(";") }));
    expect(r.findings.filter((f) => f.mechanism === "canary").length).toBeGreaterThanOrEqual(2);
    expect(r.classification).toMatchObject({ run: "INVALID", temporalOrderDuringRun: "INVALID", isolation: "FAIL" });
    expect(r.classification.runReasons.join("\n")).toMatch(/user-level context was read/);
  }, 60_000);

  it("detected: a write into the harness's materials; isolation FAIL, the run UNKNOWN (the protocol does not define it)", async () => {
    const r = await run("write-outside", {}, (ctx) => ({ MOCK_TARGET_DIR: ctx.harnessDir }));
    expect(r.findings.some((f) => f.mechanism === "snapshot")).toBe(true);
    expect(r.classification).toMatchObject({ run: "UNKNOWN", isolation: "FAIL" });
  }, 60_000);

  it("detected, INVALID: the agent fetches the task commit from the source repository by its local path", async () => {
    const r = await run("git-fetch-source", {}, () => ({ MOCK_SOURCE: source, MOCK_TASK: c.task }));
    expect(r.copyAfterRun!.violations.map((v) => v.kind)).toEqual(expect.arrayContaining(["FOREIGN_COMMIT_AFTER_RUN", "TASK_COMMIT_PRESENT"]));
    expect(r.classification).toMatchObject({ run: "INVALID", temporalOrderDuringRun: "INVALID", isolation: "FAIL" });
  }, 60_000);

  it("a copy that fails its check before the run: the agent is not started, INVALID", async () => {
    const { dir } = buildAgentCopy({ source, start: c.start, target: path.join(testRoot, `copy-bad-${++n}`), scratch: path.join(testRoot, "scratch") });
    git(dir, ["tag", "extra"]);
    const r = await runIsolated({ copy: dir, start: c.start, task: c.task, source, runDir: path.join(testRoot, `run-bad-${n}`), toolchain: tc, command: tc.node, args: [mock], caps: { wallMs: 20_000, maxTurns: 50, maxOutputBytes: 5_000_000 }, allowEgress: () => false });
    expect(r.process).toBeNull();
    expect(r.classification).toMatchObject({ run: "INVALID", copyBeforeRun: "FAIL" });
  }, 60_000);
});

describe("network through the proxy", () => {
  it("recorded, and blocked for a client that uses the proxy: marked, isolation still BLOCKED", async () => {
    const server = http.createServer((_q, s) => { s.writeHead(200); s.end("ok"); });
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const r = await run("network-proxy", { allowEgress: (h, p) => h === "127.0.0.1" && p === port }, () => ({ MOCK_ALLOWED_URL: `http://127.0.0.1:${port}/v1` }));
      expect(r.egress.map((e) => `${e.method} ${e.host}:${e.decision}`)).toEqual(["GET forbidden.invalid:denied", "CONNECT forbidden.invalid:denied", "GET 127.0.0.1:allowed"]);
      expect(r.classification.marks.filter((m) => m.startsWith("egress-log")).length).toBe(2);
      expect(r.classification.isolation).toBe("BLOCKED");
    } finally {
      server.close();
    }
  }, 60_000);
});

describe("caps and the process tree (Job Object)", () => {
  it("turn cap: the tree is stopped; overshoot measured, not a hard limit", async () => {
    const r = await run("many-turns", { caps: { wallMs: 20_000, maxTurns: 5, maxOutputBytes: 5_000_000 } });
    expect(r.process!.treeKill).toBe("job-object");
    expect(r.process!.status).toBe("CAPPED");
    expect(r.classification.run).toBe("INCOMPLETE");
    measured.push({ test: "turns", ...r.process!.overshoot });
    expect(r.process!.overshoot.turnsAfterCap).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it("wall-clock cap: stopped; the time past the deadline is measured", async () => {
    const r = await run("slow", { caps: { wallMs: 1500, maxTurns: 50, maxOutputBytes: 5_000_000 } });
    expect(r.process!.status).toBe("CAPPED");
    measured.push({ test: "wall", ...r.process!.overshoot });
    expect(r.process!.overshoot.pastDeadlineMs).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it("output cap: stopped; the bytes read past the cap are measured", async () => {
    const r = await run("flood", { caps: { wallMs: 20_000, maxTurns: 50, maxOutputBytes: 256 * 1024 } });
    expect(r.process!.status).toBe("CAPPED");
    expect(r.process!.reason).toMatch(/output cap/);
    measured.push({ test: "output", ...r.process!.overshoot });
    expect(r.process!.outputBytes).toBeLessThan(6000 * 8000);
  }, 60_000);

  it("prevented: a child left running after the agent exits is killed with the run, and reported", async () => {
    let pidFile = "", beat = "";
    const r = await run("orphan", {}, (ctx) => ({ MOCK_PID_FILE: (pidFile = path.join(ctx.runDir, "child.pid")), MOCK_HEARTBEAT_FILE: (beat = path.join(ctx.runDir, "beat.txt")) }));
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(r.process!.status).toBe("ENDED");
    expect(r.process!.lingeringAtExit).toBeGreaterThanOrEqual(1);
    expect(r.classification.marks.some((m) => m.startsWith("process-tree"))).toBe(true);
    expect(alive(pid)).toBe(false);
    expect(await stillBeating(beat)).toBe(false);
  }, 60_000);

  it("prevented: a child started before a cap is killed with the tree", async () => {
    let pidFile = "", beat = "";
    const r = await run("many-turns-with-child", { caps: { wallMs: 20_000, maxTurns: 5, maxOutputBytes: 5_000_000 } }, (ctx) => ({ MOCK_PID_FILE: (pidFile = path.join(ctx.runDir, "child.pid")), MOCK_HEARTBEAT_FILE: (beat = path.join(ctx.runDir, "beat.txt")) }));
    expect(r.process!.status).toBe("CAPPED");
    expect(alive(Number(readFileSync(pidFile, "utf8")))).toBe(false);
    expect(await stillBeating(beat)).toBe(false);
  }, 60_000);

  it("the fallback without a Job Object does NOT kill a child left running (why the Job Object is needed)", async () => {
    let pidFile = "", beat = "";
    const r = await run("orphan", { toolchain: { ...tc, jobHelper: null } }, (ctx) => ({ MOCK_PID_FILE: (pidFile = path.join(ctx.runDir, "child.pid")), MOCK_HEARTBEAT_FILE: (beat = path.join(ctx.runDir, "beat.txt")) }));
    const pid = Number(readFileSync(pidFile, "utf8"));
    try {
      expect(r.process!.treeKill).toBe("taskkill");
      expect(alive(pid)).toBe(true);
      expect(await stillBeating(beat)).toBe(true);
    } finally {
      try { process.kill(pid); } catch { /* gone */ }
    }
  }, 60_000);
});

describe("other statuses", () => {
  it("budget above its cap without a stop: run UNKNOWN (the protocol defines INCOMPLETE only for a stop)", async () => {
    const r = await run("over-budget");
    expect(r.process!.costAboveCapWithoutStop).toBe(true);
    expect(r.classification.run).toBe("UNKNOWN");
  }, 60_000);

  it("stopped from outside: INVALID (17.3)", async () => {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 700);
    const r = await run("hang", { signal: ctl.signal });
    expect(r.process!.status).toBe("ABORTED");
    expect(r.classification.run).toBe("INVALID");
  }, 60_000);

  it("the agent crashes mid-run: UNKNOWN (the protocol does not define it)", async () => {
    const r = await run("crash");
    expect(r.process!.status).toBe("CRASHED");
    expect(r.process!.exitCode).toBe(3);
    expect(r.classification.run).toBe("UNKNOWN");
  }, 60_000);

  it("every run is appended to the campaign's hash-chained log, with a frozen-term status", async () => {
    const campaign = path.join(testRoot, "campaign");
    await run("normal", { campaign: { dir: campaign, protocolSha256: "test", paramsSha256: "test" } });
    await run("crash", { campaign: { dir: campaign, protocolSha256: "test", paramsSha256: "test" } });
    expect(verifyChain(campaign)).toEqual({ ok: true, records: 2 });
    const statuses = readFileSync(path.join(campaign, "evidence.jsonl"), "utf8").trim().split("\n").map((l) => (JSON.parse(l) as { status: string }).status);
    expect(statuses).toEqual(["BLOCKED", "UNKNOWN"]);
  }, 60_000);

  it("across every run in this suite, isolation is FAIL or BLOCKED, never PASS, and no report says VALID", () => {
    expect(reports.length).toBeGreaterThan(10);
    for (const r of reports) expect(["FAIL", "BLOCKED"]).toContain(r.classification.isolation);
    expect(reports.map((r) => JSON.stringify(r)).join("\n")).not.toMatch(/"VALID"/);
  });
});
