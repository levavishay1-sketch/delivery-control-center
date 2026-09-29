import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyChain } from "../evidence.ts";
import { buildAgentCopy } from "../isolation/copy.ts";
import { makeFixtureRepo, type FixtureCommits } from "../isolation/fixture.ts";
import { buildAgentEnv, makeSyntheticHome } from "./env.ts";
import { runIsolated, type IsolatedRun, type RunReport } from "./harness.ts";

/**
 * The runner with a mock agent. Three kinds of result are kept apart in the
 * names of the tests:
 *   "enforced"     the harness prevents it (only the environment variables);
 *   "detected"     a mechanism finds it after the fact;
 *   "NOT detected" a documented limit: the test asserts the gap, so that a
 *                  change which closes it, or hides it, is noticed.
 * No model, no network beyond 127.0.0.1, no change to the machine's settings.
 */

const MOCK = fileURLToPath(new URL("./fixtures/mock-agent.mjs", import.meta.url));
let root: string;
let source: string;
let c: FixtureCommits;
let n = 0;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "dcc-runner-"));
  source = path.join(root, "source");
  c = makeFixtureRepo(source);
}, 60_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function run(scenario: string, over: Partial<IsolatedRun> = {}, extra: (ctx: { home: string; harnessDir: string; canaries: { token: string; file: string }[] }) => Record<string, string> = () => ({})): Promise<RunReport> {
  const id = ++n;
  const { dir } = buildAgentCopy({ source, start: c.start, target: path.join(root, `copy-${id}`), scratch: path.join(root, "scratch") });
  return runIsolated({
    copy: dir, start: c.start, task: c.task, source, runDir: path.join(root, `run-${id}`),
    command: process.execPath, args: [MOCK], caps: { wallMs: 20_000, maxTurns: 50, maxOutputBytes: 5_000_000, maxCostUsd: 1 },
    allowEgress: () => false,
    extraEnv: (ctx) => ({ MOCK_SCENARIO: scenario, ...extra(ctx) }),
    ...over,
  });
}

describe("a well-behaved run", () => {
  it("completes, finds nothing, and its evidence is VALID", async () => {
    const r = await run("normal");
    expect(r.process.status).toBe("COMPLETED");
    expect(r.findings).toEqual([]);
    expect(r.egress).toEqual([]);
    expect(r.evidence.status).toBe("VALID");
    expect(r.enforcement.isolationProven).toBe(false);
  }, 60_000);
});

describe("separation from the user's environment", () => {
  it("enforced: the child sees only the listed variables and a synthetic home, never the harness's secrets", async () => {
    process.env.DCC_TEST_SECRET_TOKEN = "must-not-leak";
    try {
      const r = await run("env-dump");
      const seen = JSON.parse(String(r.process.resultEvent!.result)) as { keys: string[]; homedir: string; home: Record<string, string> };
      expect(seen.keys).not.toContain("DCC_TEST_SECRET_TOKEN");
      for (const k of ["DCC_HOOK_TOKEN", "ANTHROPIC_API_KEY", "GH_TOKEN", "DATABASE_URL"]) expect(seen.keys).not.toContain(k);
      expect(seen.keys).toEqual(expect.arrayContaining(["CLAUDE_CONFIG_DIR", "HOME", "USERPROFILE", "HTTPS_PROXY", "GIT_CONFIG_GLOBAL"]));
      const synthetic = path.resolve(r.runDir, "home").toLowerCase();
      expect(path.resolve(seen.homedir).toLowerCase()).toBe(synthetic);
      // The variables the platform would otherwise inject from the real user.
      expect(path.resolve(`${seen.home.HOMEDRIVE ?? ""}${seen.home.HOMEPATH ?? ""}`).toLowerCase()).toBe(synthetic);
      expect(seen.home.USERNAME).toBe("pilot");
      // Anything else the child sees was either listed by the harness or injected by software on the machine.
      const listed = new Set(Object.keys(buildAgentEnv({ home: makeSyntheticHome(path.join(root, "probe")), proxyUrl: "http://x", extra: { MOCK_SCENARIO: "" } })).map((k) => k.toUpperCase()));
      const unlisted = seen.keys.filter((k) => !listed.has(k.toUpperCase()));
      expect(unlisted.every((k) => /^BPPDOMAIN_MANAGER_/.test(k) || ["SYSTEMDRIVE", "WINDIR", "SYSTEMROOT", "TEMP"].includes(k.toUpperCase())), unlisted.join(",")).toBe(true);
    } finally {
      delete process.env.DCC_TEST_SECRET_TOKEN;
    }
  }, 60_000);

  it("detected: reading the synthetic user memory and the hidden reference test by absolute path", async () => {
    const r = await run("read-forbidden", {}, (ctx) => ({ MOCK_TARGETS: ctx.canaries.map((x) => x.file).join(";") }));
    expect(r.findings.filter((f) => f.mechanism === "canary").length).toBeGreaterThanOrEqual(2);
    expect(r.findings.some((f) => f.mechanism === "transcript-path")).toBe(true);
    expect(r.evidence.status).toBe("UNDEFINED");
    expect(r.evidence.reasons.join("\n")).toMatch(/canary was read/);
  }, 60_000);

  it("NOT detected: a read by a program the agent started, with no path in the transcript and no content in the output", async () => {
    const r = await run("read-silently", {}, (ctx) => ({ MOCK_TARGETS: ctx.canaries[1]!.file }));
    expect(r.findings).toEqual([]);
    expect(r.evidence.status).toBe("VALID");
  }, 60_000);

  it("detected: a write into the harness's materials", async () => {
    const r = await run("write-outside", {}, (ctx) => ({ MOCK_TARGET_DIR: ctx.harnessDir }));
    expect(r.findings.some((f) => f.mechanism === "snapshot" && /changed reference/.test(f.detail))).toBe(true);
    expect(r.evidence.status).toBe("UNDEFINED");
  }, 60_000);
});

describe("network: recording, blocking, and what is not enforced", () => {
  it("recorded and blocked: requests through the proxy to a destination not on the list, without resolving it", async () => {
    const r = await run("network-proxy");
    expect(r.egress.map((e) => `${e.method} ${e.host}:${e.port} ${e.decision}`)).toEqual(["GET forbidden.invalid:80 denied", "CONNECT forbidden.invalid:443 denied"]);
    expect(r.evidence.status).toBe("FLAGGED");
  }, 60_000);

  it("recorded and allowed: a destination on the list is forwarded (a local server stands in for the model's endpoint)", async () => {
    const server = http.createServer((_q, s) => { s.writeHead(200); s.end("ok"); });
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const r = await run("network-proxy", { allowEgress: (h, p) => h === "127.0.0.1" && p === port }, () => ({ MOCK_ALLOWED_URL: `http://127.0.0.1:${port}/v1` }));
      expect(r.egress.find((e) => e.port === port)?.decision).toBe("allowed");
      expect(r.findings.filter((f) => f.mechanism === "egress-log").length).toBe(2);
    } finally {
      server.close();
    }
  }, 60_000);

  it("NOT blocked and NOT recorded: a direct socket that ignores the proxy; only this test's own listener sees it", async () => {
    const received: string[] = [];
    const listener = net.createServer((s) => { let d = ""; s.on("data", (b) => { d += b.toString(); }); s.on("end", () => received.push(d)); });
    await new Promise<void>((res) => listener.listen(0, "127.0.0.1", res));
    const port = (listener.address() as net.AddressInfo).port;
    try {
      const r = await run("network-direct", {}, () => ({ MOCK_DIRECT_PORT: String(port) }));
      await new Promise((res) => setTimeout(res, 200));
      expect(received).toEqual(["leaked-payload"]);
      expect(r.egress).toEqual([]);
      expect(r.findings).toEqual([]);
      expect(r.evidence.status).toBe("VALID");
      expect(r.enforcement.egressDirect).toMatch(/NOT BLOCKED AND NOT RECORDED/);
    } finally {
      listener.close();
    }
  }, 60_000);
});

describe("information later than S_c during a run", () => {
  it("detected, INVALID: the agent fetches the task commit from the source repository by its local path", async () => {
    const r = await run("git-fetch-source", {}, () => ({ MOCK_SOURCE: source, MOCK_TASK: c.task }));
    const kinds = r.copyAfterRun.violations.map((v) => v.kind);
    expect(kinds).toEqual(expect.arrayContaining(["FOREIGN_COMMIT_AFTER_RUN", "TASK_COMMIT_PRESENT"]));
    expect(r.evidence.status).toBe("INVALID");
  }, 60_000);
});

describe("caps, crashes and interruptions", () => {
  it("turn cap: stopped by the runner, INCOMPLETE", async () => {
    const r = await run("many-turns", { caps: { wallMs: 20_000, maxTurns: 5, maxOutputBytes: 5_000_000 } });
    expect(r.process.status).toBe("CAPPED");
    expect(r.process.reason).toMatch(/turn cap 5/);
    expect(r.evidence.status).toBe("INCOMPLETE");
  }, 60_000);

  it("wall-clock cap: the process tree is stopped, INCOMPLETE", async () => {
    const r = await run("slow", { caps: { wallMs: 1500, maxTurns: 50, maxOutputBytes: 5_000_000 } });
    expect(r.process.status).toBe("CAPPED");
    expect(r.process.durationMs).toBeLessThan(15_000);
    expect(r.evidence.status).toBe("INCOMPLETE");
  }, 60_000);

  it("budget: reported above the cap after the run, not stopped during it, and not reclassified", async () => {
    const r = await run("over-budget");
    expect(r.process.status).toBe("COMPLETED");
    expect(r.process.costAboveCapWithoutStop).toBe(true);
    expect(r.evidence.reasons.join("\n")).toMatch(/above the budget cap/);
  }, 60_000);

  it("stopped from outside: ABORTED, INVALID (17.3)", async () => {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 700);
    const r = await run("hang", { signal: ctl.signal });
    expect(r.process.status).toBe("ABORTED");
    expect(r.evidence.status).toBe("INVALID");
  }, 60_000);

  it("the agent crashes mid-run: CRASHED, and the protocol does not define it (UNDEFINED)", async () => {
    const r = await run("crash");
    expect(r.process.status).toBe("CRASHED");
    expect(r.process.exitCode).toBe(3);
    expect(r.process.protocolStatus).toBe("UNDEFINED");
    expect(r.evidence.status).toBe("UNDEFINED");
  }, 60_000);
});

describe("the evidence record", () => {
  it("a run is appended to the campaign's hash-chained log", async () => {
    const campaign = path.join(root, "campaign");
    await run("normal", { campaign: { dir: campaign, protocolSha256: "test", paramsSha256: "test" } });
    await run("crash", { campaign: { dir: campaign, protocolSha256: "test", paramsSha256: "test" } });
    expect(verifyChain(campaign)).toEqual({ ok: true, records: 2 });
  }, 60_000);
});
