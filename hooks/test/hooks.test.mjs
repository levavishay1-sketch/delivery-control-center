// The capture hooks against a stand-in server: what each one sends, and that
// nothing — a refused token, a dead or silent server, DCC's own runs — can
// fail or hold up the session it runs in.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { joinUrl, compact, LOGIN_HINT } from "../lib.mjs";
import { startStub, deadOrigin, makeHome, envFor, makeRepo, runScript, hook, tempDir, cleanup, CLIENT_ID, BRANCH } from "./support.mjs";

after(cleanup);

const TOKEN = "dcc_pat_from_env";
const resolves = {
  "GET /api/resolve": { json: { workitemId: "11111111-1111-4111-8111-111111111111", key: "WI-12", title: "Pricing" } },
  "GET /api/workitems/11111111-1111-4111-8111-111111111111/brief": { text: "# Brief\nThe pricing rules." },
};

async function setup(routes, { home, repo = {} } = {}) {
  const stub = await startStub(routes);
  const r = makeRepo(`${stub.origin}/api`, repo);
  return { stub, ...r, home: home ?? makeHome() };
}

function lines(stderr) {
  return stderr.split("\n").filter(Boolean);
}

test("session-start resolves the branch with the token and prints the brief", async () => {
  const { stub, dir, home } = await setup(resolves);
  const r = await runScript(hook("session-start"), { cwd: dir, env: envFor(home, { DCC_API_TOKEN: TOKEN }), input: { cwd: dir, source: "startup" } });
  await stub.close();

  assert.equal(r.code, 0);
  assert.equal(stub.requests.length, 2);
  const [resolve, brief] = stub.requests;
  assert.equal(resolve.method, "GET");
  assert.equal(resolve.path, "/api/resolve");
  assert.equal(resolve.query.get("clientId"), CLIENT_ID);
  assert.equal(resolve.query.get("branch"), BRANCH);
  assert.equal(resolve.headers.authorization, `Bearer ${TOKEN}`);
  // none of the shared-secret headers the hooks used to send (matched by prefix, so the retired names stay out of the code)
  assert.deepEqual(Object.keys(resolve.headers).filter((h) => h.startsWith("x-dcc-")), []);
  assert.equal(brief.path, "/api/workitems/11111111-1111-4111-8111-111111111111/brief");
  assert.equal(brief.headers.authorization, `Bearer ${TOKEN}`);
  assert.match(r.stdout, /# Brief\nThe pricing rules\./);
});

test("a token saved by dcc login is found under the server's origin", async () => {
  const stub = await startStub(resolves);
  const home = makeHome({ "http://elsewhere.example": "dcc_pat_other", [stub.origin]: "dcc_pat_saved" });
  const { dir } = makeRepo(`${stub.origin}/api`);
  const r = await runScript(hook("session-start"), { cwd: dir, env: envFor(home), input: { cwd: dir } });
  await stub.close();

  assert.equal(r.code, 0);
  assert.equal(stub.requests[0].headers.authorization, "Bearer dcc_pat_saved");
});

test("DCC_API_TOKEN wins over a saved token", async () => {
  const stub = await startStub(resolves);
  const home = makeHome({ [stub.origin]: "dcc_pat_saved" });
  const { dir } = makeRepo(`${stub.origin}/api`);
  await runScript(hook("session-start"), { cwd: dir, env: envFor(home, { DCC_API_TOKEN: TOKEN }), input: { cwd: dir } });
  await stub.close();

  assert.equal(stub.requests[0].headers.authorization, `Bearer ${TOKEN}`);
});

test("without a token nothing is sent and one line says how to get one", async () => {
  const { stub, dir, home } = await setup(resolves);
  const r = await runScript(hook("session-start"), { cwd: dir, env: envFor(home), input: { cwd: dir } });
  await stub.close();

  assert.equal(r.code, 0);
  assert.equal(stub.requests.length, 0);
  assert.equal(r.stdout, "");
  assert.equal(lines(r.stderr).length, 1);
  assert.match(r.stderr, /no API token .*dcc\.mjs login/);
});

test("a refused token logs the login hint, prints no brief and exits 0", async () => {
  const { stub, dir, home } = await setup({ "GET /api/resolve": { status: 401, json: { error: "invalid_token", message: "Not signed in." } } });
  const r = await runScript(hook("session-start"), { cwd: dir, env: envFor(home, { DCC_API_TOKEN: TOKEN }), input: { cwd: dir } });
  await stub.close();

  assert.equal(r.code, 0);
  assert.equal(r.stdout, "");
  assert.ok(r.stderr.includes(LOGIN_HINT), r.stderr);
  assert.ok(r.stderr.includes("token revoked or expired — run node skills/dcc.mjs login"));
});

test("a 403 names the permission the token's person lacks", async () => {
  const { stub, dir, home } = await setup({
    "GET /api/resolve": { status: 403, json: { error: "forbidden", message: "You do not have permission for this.", permission: "requirements.read" } },
  });
  const r = await runScript(hook("session-start"), { cwd: dir, env: envFor(home, { DCC_API_TOKEN: TOKEN }), input: { cwd: dir } });
  await stub.close();

  assert.equal(r.code, 0);
  assert.match(r.stderr, /forbidden .*requirements\.read/);
});

test("a branch with no work item prints nothing and logs nothing", async () => {
  const { stub, dir, home } = await setup({});
  const r = await runScript(hook("session-start"), { cwd: dir, env: envFor(home, { DCC_API_TOKEN: TOKEN }), input: { cwd: dir } });
  await stub.close();

  assert.equal(r.code, 0);
  assert.equal(stub.requests.length, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
});

test("session-end posts the session with the last assistant text, cut to 500 characters", async () => {
  const { stub, dir, home } = await setup({ "POST /api/events": { status: 201, json: { eventId: "e", workitemId: null, assigned: false } } });
  const long = "final " + "a".repeat(600);
  const transcript = join(tempDir("dcc-transcript-"), "t.jsonl");
  writeFileSync(
    transcript,
    [
      { type: "user", message: { role: "user", content: "do it" } },
      { type: "assistant", message: { content: [{ type: "text", text: "first answer" }] } },
      "{ a torn line",
      { type: "assistant", message: { content: [{ type: "text", text: long }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] } },
    ]
      .map((l) => (typeof l === "string" ? l : JSON.stringify(l)))
      .join("\n"),
  );
  const r = await runScript(hook("session-end"), {
    cwd: dir,
    env: envFor(home, { DCC_API_TOKEN: TOKEN }),
    input: { cwd: dir, session_id: "sess-1", transcript_path: transcript, reason: "exit" },
  });
  await stub.close();

  assert.equal(r.code, 0);
  assert.equal(stub.requests.length, 1);
  const [post] = stub.requests;
  assert.equal(post.method, "POST");
  assert.equal(post.path, "/api/events");
  assert.equal(post.headers.authorization, `Bearer ${TOKEN}`);
  assert.match(post.headers["content-type"], /^application\/json/);
  assert.deepEqual(JSON.parse(post.body), {
    clientId: CLIENT_ID,
    branch: BRANCH,
    kind: "session",
    session: { sessionId: "sess-1", transcriptPath: transcript, summary: long.slice(0, 500) },
  });
  assert.match(r.stderr, /session → 201/);
});

test("session-end on a detached HEAD leaves the branch out instead of sending null", async () => {
  const { stub, dir, home } = await setup({ "POST /api/events": { status: 201, json: {} } }, { repo: { detached: true } });
  const r = await runScript(hook("session-end"), {
    cwd: dir,
    env: envFor(home, { DCC_API_TOKEN: TOKEN }),
    input: { cwd: dir, session_id: "sess-2", transcript_path: join(dir, "missing.jsonl") },
  });
  await stub.close();

  assert.equal(r.code, 0);
  const body = JSON.parse(stub.requests[0].body);
  assert.equal("branch" in body, false);
  assert.equal(body.session.summary, "Claude Code session");
});

test("post-tool-use posts a commit with its sha and the repository's name", async () => {
  const { stub, dir, home, head } = await setup({ "POST /api/events": { status: 201, json: {} } });
  const r = await runScript(hook("post-tool-use"), {
    cwd: dir,
    env: envFor(home, { DCC_API_TOKEN: TOKEN }),
    input: { cwd: dir, tool_name: "Bash", tool_input: { command: 'git commit -m "pricing"' }, tool_response: {} },
  });
  await stub.close();

  assert.equal(r.code, 0);
  assert.equal(stub.requests.length, 1);
  const [post] = stub.requests;
  assert.equal(post.path, "/api/events");
  assert.equal(post.headers.authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(JSON.parse(post.body), {
    clientId: CLIENT_ID,
    branch: BRANCH,
    kind: "git",
    git: { repo: "demo-repo", branch: BRANCH, kind: "commit", count: 1, shas: [head] },
  });
});

test("post-tool-use classifies a push and sends no count or shas for it", async () => {
  const { stub, dir, home } = await setup({ "POST /api/events": { status: 201, json: {} } });
  await runScript(hook("post-tool-use"), {
    cwd: dir,
    env: envFor(home, { DCC_API_TOKEN: TOKEN }),
    input: { cwd: dir, tool_name: "Bash", tool_input: { command: "git push -u origin HEAD" } },
  });
  await stub.close();

  assert.deepEqual(JSON.parse(stub.requests[0].body).git, { repo: "demo-repo", branch: BRANCH, kind: "push" });
});

test("post-tool-use ignores a command that is not git activity", async () => {
  const { stub, dir, home } = await setup({});
  const r = await runScript(hook("post-tool-use"), {
    cwd: dir,
    env: envFor(home, { DCC_API_TOKEN: TOKEN }),
    input: { cwd: dir, tool_name: "Bash", tool_input: { command: "ls -la" } },
  });
  await stub.close();

  assert.equal(r.code, 0);
  assert.equal(stub.requests.length, 0);
  assert.equal(r.stderr, "");
});

test("a server that never answers is given up on after five seconds, and the hook exits 0", async () => {
  const { stub, dir, home } = await setup({ "POST /api/events": { hang: true } });
  const r = await runScript(hook("session-end"), {
    cwd: dir,
    env: envFor(home, { DCC_API_TOKEN: TOKEN }),
    input: { cwd: dir, session_id: "sess-3", transcript_path: join(dir, "missing.jsonl") },
  });
  await stub.close();

  assert.equal(r.code, 0);
  assert.equal(stub.requests.length, 1);
  assert.ok(r.ms >= 4500 && r.ms < 9000, `took ${r.ms} ms`);
  assert.match(r.stderr, /no answer within 5 s/);
});

test("an unreachable server is one stderr line, and the hook exits 0", async () => {
  const origin = await deadOrigin();
  const { dir } = makeRepo(`${origin}/api`);
  const r = await runScript(hook("post-tool-use"), {
    cwd: dir,
    env: envFor(makeHome(), { DCC_API_TOKEN: TOKEN }),
    input: { cwd: dir, tool_name: "Bash", tool_input: { command: "git commit -m x" } },
  });

  assert.equal(r.code, 0);
  assert.equal(lines(r.stderr).length, 1);
  assert.match(r.stderr, /^\[dcc-hook\] POST .*\/api\/events: /);
});

test("DCC_CAPTURE=off: no hook sends anything", async () => {
  const { stub, dir, home } = await setup({ ...resolves, "POST /api/events": { status: 201, json: {} } });
  const env = envFor(home, { DCC_API_TOKEN: TOKEN, DCC_CAPTURE: "off" });
  const results = [
    await runScript(hook("session-start"), { cwd: dir, env, input: { cwd: dir } }),
    await runScript(hook("session-end"), { cwd: dir, env, input: { cwd: dir, session_id: "s" } }),
    await runScript(hook("post-tool-use"), { cwd: dir, env, input: { cwd: dir, tool_name: "Bash", tool_input: { command: "git commit -m x" } } }),
  ];
  await stub.close();

  assert.equal(stub.requests.length, 0);
  for (const r of results) {
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "");
  }
});

test("a revoked token on POST /events logs the login hint from both posting hooks, and they exit 0", async () => {
  // The real server answers a refused API token with an empty 401 body.
  const { stub, dir, home } = await setup({ "POST /api/events": { status: 401, text: "" } });
  const env = envFor(home, { DCC_API_TOKEN: TOKEN });
  const end = await runScript(hook("session-end"), { cwd: dir, env, input: { cwd: dir, session_id: "s", transcript_path: join(dir, "missing.jsonl") } });
  const commit = await runScript(hook("post-tool-use"), { cwd: dir, env, input: { cwd: dir, tool_name: "Bash", tool_input: { command: "git commit -m x" } } });
  await stub.close();

  assert.equal(stub.requests.length, 2);
  for (const r of [end, commit]) {
    assert.equal(r.code, 0);
    assert.ok(r.stderr.includes(`${LOGIN_HINT} (401)`), r.stderr);
  }
});

test("a 403 on POST /events names the permission", async () => {
  const { stub, dir, home } = await setup({
    "POST /api/events": { status: 403, json: { error: "forbidden", message: "You do not have permission for this.", permission: "requirements.read" } },
  });
  const r = await runScript(hook("post-tool-use"), {
    cwd: dir,
    env: envFor(home, { DCC_API_TOKEN: TOKEN }),
    input: { cwd: dir, tool_name: "Bash", tool_input: { command: "git push" } },
  });
  await stub.close();

  assert.equal(r.code, 0);
  assert.equal(lines(r.stderr).length, 1);
  assert.match(r.stderr, /forbidden — the token's person lacks requirements\.read/);
});

test("post-tool-use: switch -c is a new branch, gh pr create a pull request, and the repository's name falls back to origin", async () => {
  const { stub, dir, home } = await setup({ "POST /api/events": { status: 201, json: {} } });
  writeFileSync(join(dir, ".dcc.json"), JSON.stringify({ apiUrl: `${stub.origin}/api`, clientId: CLIENT_ID }));
  execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/shop-api.git"], { cwd: dir, stdio: "ignore" });
  const env = envFor(home, { DCC_API_TOKEN: TOKEN });
  for (const command of ["git switch -c feature/WI-12-next", 'gh pr create --title "Pricing"']) {
    await runScript(hook("post-tool-use"), { cwd: dir, env, input: { cwd: dir, tool_name: "Bash", tool_input: { command } } });
  }
  await stub.close();

  assert.deepEqual(
    stub.requests.map((q) => JSON.parse(q.body).git),
    [
      { repo: "shop-api", branch: BRANCH, kind: "branch_created" },
      { repo: "shop-api", branch: BRANCH, kind: "pull_request" },
    ],
  );
});

test("post-tool-use on a detached HEAD sends nothing, as before", async () => {
  const { stub, dir, home } = await setup({ "POST /api/events": { status: 201, json: {} } }, { repo: { detached: true } });
  const r = await runScript(hook("post-tool-use"), {
    cwd: dir,
    env: envFor(home, { DCC_API_TOKEN: TOKEN }),
    input: { cwd: dir, tool_name: "Bash", tool_input: { command: "git commit -m x" } },
  });
  await stub.close();

  assert.equal(r.code, 0);
  assert.equal(stub.requests.length, 0);
});

test("session-start gives up on a silent server: the session starts with no brief and no delay past the timeout", async () => {
  const { stub, dir, home } = await setup({ "GET /api/resolve": { hang: true } });
  const r = await runScript(hook("session-start"), { cwd: dir, env: envFor(home, { DCC_API_TOKEN: TOKEN }), input: { cwd: dir } });
  await stub.close();

  assert.equal(r.code, 0);
  assert.equal(r.stdout, "");
  assert.ok(r.ms < 9000, `took ${r.ms} ms`);
  assert.match(r.stderr, /GET .*\/api\/resolve\?.*: no answer within 5 s/);
});

test("outside a DCC repository nothing is sent or logged; a broken .dcc.json is one line", async () => {
  const stub = await startStub(resolves);
  const bare = tempDir("dcc-bare-");
  const env = envFor(makeHome(), { DCC_API_TOKEN: TOKEN });
  const none = await runScript(hook("session-start"), { cwd: bare, env, input: { cwd: bare } });
  writeFileSync(join(bare, ".dcc.json"), "{ not json");
  const broken = await runScript(hook("session-end"), { cwd: bare, env, input: { cwd: bare, session_id: "s" } });
  await stub.close();

  assert.equal(stub.requests.length, 0);
  assert.equal(none.code, 0);
  assert.equal(none.stderr, "");
  assert.equal(broken.code, 0);
  assert.equal(lines(broken.stderr).length, 1);
  assert.match(broken.stderr, /\.dcc\.json is not valid JSON/);
});

test("DCC_CAPTURE is read without regard to case or spaces", async () => {
  const { stub, dir, home } = await setup({ "POST /api/events": { status: 201, json: {} } });
  const r = await runScript(hook("post-tool-use"), {
    cwd: dir,
    env: envFor(home, { DCC_API_TOKEN: TOKEN, DCC_CAPTURE: " OFF " }),
    input: { cwd: dir, tool_name: "Bash", tool_input: { command: "git commit -m x" } },
  });
  await stub.close();

  assert.equal(r.code, 0);
  assert.equal(stub.requests.length, 0);
  assert.equal(r.stderr, "");
});

test("a credentials file that does not parse counts as no token", async () => {
  const stub = await startStub(resolves);
  const home = makeHome();
  mkdirSync(join(home, ".dcc"));
  writeFileSync(join(home, ".dcc", "credentials.json"), "not json");
  const { dir } = makeRepo(`${stub.origin}/api`);
  const r = await runScript(hook("session-start"), { cwd: dir, env: envFor(home), input: { cwd: dir } });
  await stub.close();

  assert.equal(r.code, 0);
  assert.equal(stub.requests.length, 0);
  assert.match(r.stderr, /no API token/);
});

test("session-end reads an assistant message whose content is plain text", async () => {
  const { stub, dir, home } = await setup({ "POST /api/events": { status: 201, json: {} } });
  const transcript = join(tempDir("dcc-transcript-"), "t.jsonl");
  writeFileSync(transcript, JSON.stringify({ role: "assistant", message: { content: "All done." } }) + "\n");
  await runScript(hook("session-end"), {
    cwd: dir,
    env: envFor(home, { DCC_API_TOKEN: TOKEN }),
    input: { cwd: dir, session_id: "s", transcript_path: transcript },
  });
  await stub.close();

  assert.equal(JSON.parse(stub.requests[0].body).session.summary, "All done.");
});

test("joinUrl keeps a path prefix in apiUrl", () => {
  assert.equal(joinUrl("https://dcc.example.com/api", "/events"), "https://dcc.example.com/api/events");
  assert.equal(joinUrl("https://dcc.example.com/api/", "/resolve?branch=a%2Fb"), "https://dcc.example.com/api/resolve?branch=a%2Fb");
  assert.equal(joinUrl("http://localhost:5080", "/events"), "http://localhost:5080/events");
});

test("compact drops null and undefined, and keeps falsy values that mean something", () => {
  assert.deepEqual(compact({ a: null, b: undefined, c: 0, d: "", e: false, f: "x" }), { c: 0, d: "", e: false, f: "x" });
});
