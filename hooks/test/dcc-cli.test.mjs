// skills/dcc.mjs against a stand-in server: login checks a pasted token and
// saves it for that server only, whoami says who it signs in as, and a skill
// call sends the token and turns a refusal into words a person can act on.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { startStub, deadOrigin, makeHome, envFor, runScript, tempDir, cleanup, CLI, CLIENT_ID } from "./support.mjs";

after(cleanup);

const me = { "GET /api/auth/me": { json: { user: { id: "u", email: "dana@example.com", displayName: "Dana", kind: "person" }, permissions: {}, mustChangePassword: false } } };

/** A folder with a .dcc.json pointing at the stub, under its /api prefix. */
function project(origin) {
  const dir = tempDir("dcc-cli-");
  writeFileSync(join(dir, ".dcc.json"), JSON.stringify({ apiUrl: `${origin}/api`, clientId: CLIENT_ID, repo: "demo-repo" }));
  return dir;
}

const saved = (home) => JSON.parse(readFileSync(join(home, ".dcc", "credentials.json"), "utf8"));

test("login checks the pasted token with /auth/me and saves it under the server's origin", async () => {
  const stub = await startStub(me);
  const home = makeHome({ "http://elsewhere.example": "dcc_pat_other" });
  const r = await runScript(CLI, { args: ["login"], cwd: project(stub.origin), env: envFor(home), input: "dcc_pat_good\n" });
  await stub.close();

  assert.equal(r.code, 0, r.stderr);
  assert.equal(stub.requests.length, 1);
  assert.equal(stub.requests[0].path, "/api/auth/me");
  assert.equal(stub.requests[0].headers.authorization, "Bearer dcc_pat_good");
  assert.deepEqual(saved(home), { "http://elsewhere.example": "dcc_pat_other", [stub.origin]: "dcc_pat_good" });
  assert.match(r.stdout, /signed in as Dana <dana@example\.com>/);
  if (process.platform !== "win32") {
    assert.equal(statSync(join(home, ".dcc", "credentials.json")).mode & 0o777, 0o600);
  }
});

test("login with a token the server refuses saves nothing", async () => {
  const stub = await startStub({ "GET /api/auth/me": { status: 401, json: { error: "invalid_token", message: "Not signed in." } } });
  const home = makeHome();
  const r = await runScript(CLI, { args: ["login"], cwd: project(stub.origin), env: envFor(home), input: "dcc_pat_revoked\n" });
  await stub.close();

  assert.equal(r.code, 1);
  assert.match(r.stderr, /refused this token \(invalid_token\)/);
  assert.equal(existsSync(join(home, ".dcc", "credentials.json")), false);
});

test("login rejects something that is not an API token without sending it", async () => {
  const stub = await startStub(me);
  const r = await runScript(CLI, { args: ["login"], cwd: project(stub.origin), env: envFor(makeHome()), input: "hunter2\n" });
  await stub.close();

  assert.equal(r.code, 1);
  assert.equal(stub.requests.length, 0);
  assert.match(r.stderr, /not a DCC API token/);
});

test("login works with --api where there is no .dcc.json", async () => {
  const stub = await startStub(me);
  const home = makeHome();
  const r = await runScript(CLI, { args: ["login", "--api", `${stub.origin}/api`], cwd: tempDir("dcc-bare-"), env: envFor(home), input: "dcc_pat_good" });
  await stub.close();

  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(saved(home), { [stub.origin]: "dcc_pat_good" });
});

test("whoami signs in with the saved token and says who it is", async () => {
  const stub = await startStub(me);
  const home = makeHome({ [stub.origin]: "dcc_pat_saved" });
  const r = await runScript(CLI, { args: ["whoami"], cwd: project(stub.origin), env: envFor(home) });
  await stub.close();

  assert.equal(r.code, 0, r.stderr);
  assert.equal(stub.requests[0].headers.authorization, "Bearer dcc_pat_saved");
  assert.match(r.stdout, /^Dana <dana@example\.com> — token from .*credentials\.json/);
});

test("whoami prefers DCC_API_TOKEN", async () => {
  const stub = await startStub(me);
  const home = makeHome({ [stub.origin]: "dcc_pat_saved" });
  const r = await runScript(CLI, { args: ["whoami"], cwd: project(stub.origin), env: envFor(home, { DCC_API_TOKEN: "dcc_pat_env" }) });
  await stub.close();

  assert.equal(stub.requests[0].headers.authorization, "Bearer dcc_pat_env");
  assert.match(r.stdout, /token from DCC_API_TOKEN/);
});

test("whoami without a token says how to get one", async () => {
  const stub = await startStub(me);
  const r = await runScript(CLI, { args: ["whoami"], cwd: project(stub.origin), env: envFor(makeHome()) });
  await stub.close();

  assert.equal(r.code, 1);
  assert.equal(stub.requests.length, 0);
  assert.match(r.stderr, /no API token .*dcc\.mjs login/);
});

test("whoami with a revoked token prints the login hint", async () => {
  const stub = await startStub({ "GET /api/auth/me": { status: 401, json: { error: "invalid_token" } } });
  const r = await runScript(CLI, { args: ["whoami"], cwd: project(stub.origin), env: envFor(makeHome(), { DCC_API_TOKEN: "dcc_pat_old" }) });
  await stub.close();

  assert.equal(r.code, 1);
  assert.ok(r.stderr.includes("token revoked or expired — run node skills/dcc.mjs login"), r.stderr);
});

test("gap posts as the token's person, with the repository's clientId in the body", async () => {
  const stub = await startStub({ "POST /api/workitems/wi-1/gaps": { status: 201, json: { id: "g1" } } });
  const r = await runScript(CLI, {
    args: ["gap", "--workitem", "wi-1", "--description", "Undefined case", "--blocking", "--confidence", "0.8"],
    cwd: project(stub.origin),
    env: envFor(makeHome(), { DCC_API_TOKEN: "dcc_pat_env" }),
  });
  await stub.close();

  assert.equal(r.code, 0, r.stderr);
  const [post] = stub.requests;
  assert.equal(post.method, "POST");
  assert.equal(post.headers.authorization, "Bearer dcc_pat_env");
  assert.deepEqual(Object.keys(post.headers).filter((h) => h.startsWith("x-dcc-")), []);
  assert.deepEqual(JSON.parse(post.body), { clientId: CLIENT_ID, description: "Undefined case", blocking: true, confidence: 0.8, mode: "delegated" });
  assert.match(r.stdout, /"id":"g1"/);
});

test("a refused skill call names the missing permission", async () => {
  const stub = await startStub({
    "POST /api/workitems/wi-1/blockers": { status: 403, json: { error: "forbidden", message: "You do not have permission for this.", permission: "requirements.edit" } },
  });
  const r = await runScript(CLI, {
    args: ["blocker", "--workitem", "wi-1", "--question", "Which credential?"],
    cwd: project(stub.origin),
    env: envFor(makeHome(), { DCC_API_TOKEN: "dcc_pat_env" }),
  });
  await stub.close();

  assert.equal(r.code, 1);
  assert.match(r.stderr, /forbidden — you lack requirements\.edit/);
});

test("every skill command keeps the old route and body", async () => {
  const W = "11111111-1111-4111-8111-111111111111";
  const stub = await startStub({
    "GET /api/resolve": { json: { workitemId: W } },
    [`GET /api/workitems/${W}/brief`]: { text: "# Brief" },
    [`POST /api/workitems/${W}/tasks`]: { status: 201, json: { taskIds: [], dependencyCount: 0 } },
    "GET /api/repos/shop%20api/contention": { json: { contention: [] } },
    [`POST /api/workitems/${W}/touches`]: { status: 201, json: { repoId: "r", overlaps: [] } },
    [`POST /api/workitems/${W}/touches/release`]: { json: { released: true } },
    [`POST /api/workitems/${W}/review`]: { status: 201, json: { id: "rv" } },
  });
  const cwd = project(stub.origin);
  writeFileSync(join(cwd, "tasks.json"), JSON.stringify({ openspecChangeId: "pricing", tasks: [{ intent: "Build it" }] }));
  writeFileSync(join(cwd, "findings.json"), JSON.stringify([{ file: "a.ts", severity: "warn", note: "n" }]));
  const env = envFor(makeHome(), { DCC_API_TOKEN: "dcc_pat_env" });
  const runs = [
    ["resolve", "--branch", "feature/WI-12-x"],
    ["brief", "--workitem", W],
    ["tasks", "--workitem", W, "--file", "tasks.json"],
    ["contention", "--repo", "shop api"],
    ["touches", "--workitem", W, "--repo", "shop", "--paths", "a.ts, b.ts", "--branch", "feature/x", "--kind", "branch"],
    ["touches-release", "--workitem", W],
    ["review", "--workitem", W, "--verdict", "changes_requested", "--file", "findings.json", "--pr", "42", "--overlap", "a.ts,b.ts"],
  ];
  for (const args of runs) {
    const r = await runScript(CLI, { args, cwd, env });
    assert.equal(r.code, 0, `${args[0]}: ${r.stderr}`);
  }
  await stub.close();

  const got = stub.requests.map((q) => ({ call: `${q.method} ${q.url}`, body: q.body ? JSON.parse(q.body) : undefined, auth: q.headers.authorization }));
  assert.ok(got.every((g) => g.auth === "Bearer dcc_pat_env"));
  assert.deepEqual(
    got.map(({ call, body }) => ({ call, body })),
    [
      { call: `GET /api/resolve?clientId=${CLIENT_ID}&branch=feature%2FWI-12-x`, body: undefined },
      { call: `GET /api/workitems/${W}/brief`, body: undefined },
      { call: `POST /api/workitems/${W}/tasks`, body: { clientId: CLIENT_ID, tasks: [{ intent: "Build it" }], openspecChangeId: "pricing" } },
      { call: `GET /api/repos/shop%20api/contention?clientId=${CLIENT_ID}`, body: undefined },
      { call: `POST /api/workitems/${W}/touches`, body: { clientId: CLIENT_ID, repo: "shop", branch: "feature/x", kind: "branch", paths: ["a.ts", "b.ts"] } },
      { call: `POST /api/workitems/${W}/touches/release`, body: { clientId: CLIENT_ID } },
      {
        call: `POST /api/workitems/${W}/review`,
        body: { clientId: CLIENT_ID, prRef: "42", verdict: "changes_requested", findings: [{ file: "a.ts", severity: "warn", note: "n" }], overlapFocus: ["a.ts", "b.ts"] },
      },
    ],
  );
});

test("login takes the first line and does not wait for the end of input (Git Bash shows Node a pipe, not a terminal)", async () => {
  const stub = await startStub(me);
  const home = makeHome();
  const child = spawn(process.execPath, [CLI, "login"], { cwd: project(stub.origin), env: envFor(home), stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
  child.stdin.write("\r\n  dcc_pat_typed  \r\n"); // a blank line first, then the token and Enter — stdin stays open
  const code = await Promise.race([
    new Promise((ok) => child.on("close", ok)),
    new Promise((ok) => setTimeout(() => ok("still waiting"), 10_000)),
  ]);
  if (code === "still waiting") child.kill();
  await stub.close();

  assert.equal(code, 0);
  assert.equal(stub.requests[0].headers.authorization, "Bearer dcc_pat_typed");
  assert.deepEqual(saved(home), { [stub.origin]: "dcc_pat_typed" });
  assert.match(stdout, /signed in as Dana/);
});

test("an unreachable server is one error line and exit 1", async () => {
  const origin = await deadOrigin();
  const r = await runScript(CLI, { args: ["whoami"], cwd: project(origin), env: envFor(makeHome(), { DCC_API_TOKEN: "dcc_pat_env" }) });

  assert.equal(r.code, 1);
  assert.match(r.stderr, /^dcc error: GET http:\/\/127\.0\.0\.1:\d+\/api\/auth\/me: /);
});

test("an unknown command prints the usage and exits 2", async () => {
  const r = await runScript(CLI, { args: ["frobnicate"], cwd: tempDir("dcc-bare-"), env: envFor(makeHome()) });

  assert.equal(r.code, 2);
  assert.match(r.stderr, /^usage: dcc <login\|whoami\|resolve/);
});

test("without a .dcc.json a command says so instead of crashing", async () => {
  const r = await runScript(CLI, { args: ["whoami"], cwd: tempDir("dcc-bare-"), env: envFor(makeHome(), { DCC_API_TOKEN: "dcc_pat_env" }) });

  assert.equal(r.code, 1);
  assert.match(r.stderr, /^dcc error: no \.dcc\.json found from .* — or pass --api/);
});
