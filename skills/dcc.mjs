#!/usr/bin/env node
// dcc — the CLI the DCC skills call. Reads .dcc.json (repo) and an API
// token (dcc_pat_…) of the person working. Zero dependencies, and
// self-contained: a client repository gets a copy of this one file.
//
//   node dcc.mjs login          paste a token (from an admin, POST /tokens); it is checked and saved
//   node dcc.mjs whoami         who the token signs in as
//   node dcc.mjs resolve --branch feature/WI-1284-x
//   node dcc.mjs gap     --workitem <id> --description "..." --blocking --confidence 0.8
//   node dcc.mjs blocker --workitem <id> --type missing_access --question "..."
//   node dcc.mjs tasks   --workitem <id> --file tasks.json [--change <openspec-change-id>]
//   node dcc.mjs contention     --repo <name>
//   node dcc.mjs touches        --workitem <id> --repo <name> --paths a.ts,b.ts [--branch b --kind branch]
//   node dcc.mjs touches-release --workitem <id>
//   node dcc.mjs review  --workitem <id> --verdict pass|changes_requested --file findings.json [--pr <n> --overlap "a.ts,b.ts"]
//   node dcc.mjs brief   --workitem <id>
//
// --api <url> names the server when there is no .dcc.json (e.g. `login` on a new machine).
//
// The token: DCC_API_TOKEN, else ~/.dcc/credentials.json under the server's
// origin (what `login` writes). The same lookup as hooks/lib.mjs — inlined,
// because a client's copy of this file has no hooks folder beside it.
import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

/** A skill waits longer than a hook, but never forever on a hung server. */
const TIMEOUT_MS = 30_000;
const TOKEN_PREFIX = "dcc_pat_";
const LOGIN_HINT = "token revoked or expired — run node skills/dcc.mjs login";

function findConfig() {
  let dir = process.cwd();
  const root = parse(dir).root;
  while (true) {
    const f = join(dir, ".dcc.json");
    if (existsSync(f)) {
      try {
        return JSON.parse(readFileSync(f, "utf8"));
      } catch (e) {
        throw new Error(`${f} is not valid JSON: ${e.message}`, { cause: e });
      }
    }
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        o[k] = next;
        i++;
      } else o[k] = true;
    }
  }
  return o;
}

function credentialsFile() {
  return join(homedir(), ".dcc", "credentials.json");
}

function originOf(apiUrl) {
  try {
    return new URL(apiUrl).origin;
  } catch {
    throw new Error(`"${apiUrl}" is not a server address`);
  }
}

function readCredentials() {
  try {
    const all = JSON.parse(readFileSync(credentialsFile(), "utf8"));
    return all && typeof all === "object" && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

/** DCC_API_TOKEN, then the saved token for this server. */
function findToken(apiUrl) {
  const fromEnv = process.env.DCC_API_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, from: "DCC_API_TOKEN" };
  const saved = readCredentials()[originOf(apiUrl)];
  return typeof saved === "string" && saved.trim() ? { token: saved.trim(), from: credentialsFile() } : null;
}

/** Keeps a path prefix in apiUrl (https://host/api) — `new URL("/x", base)` would drop it. */
function joinUrl(apiUrl, path) {
  return `${String(apiUrl).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
}

/** One request; the answer as { status, text }. Unreachable or timed out throws. */
async function send(apiUrl, token, method, path, body) {
  const url = joinUrl(apiUrl, path);
  try {
    const res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    const why = e?.name === "TimeoutError" ? `no answer within ${TIMEOUT_MS / 1000} s` : e?.cause?.code ?? e?.message;
    throw new Error(`${method} ${url}: ${why}`, { cause: e });
  }
}

function field(text, key) {
  try {
    const v = JSON.parse(text)?.[key];
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

/** A refusal in words a person can act on. */
function refusal(status, text) {
  if (status === 401) return `${LOGIN_HINT} (${field(text, "error") ?? "401"})`;
  if (status === 403) {
    const permission = field(text, "permission");
    return permission ? `forbidden — you lack ${permission}` : `forbidden — ${field(text, "message") ?? text}`;
  }
  return `${status} ${text}`;
}

function serverFor(c, a) {
  const apiUrl = typeof a.api === "string" ? a.api : c?.apiUrl;
  if (!apiUrl) throw new Error(`no .dcc.json found from ${process.cwd()} — or pass --api <server address>`);
  return apiUrl;
}

/** Reads the token from stdin: piped, or typed/pasted at a terminal without echoing it. */
async function readToken() {
  const stdin = process.stdin;
  process.stderr.write(`Paste your DCC API token (${TOKEN_PREFIX}…) and press Enter: `);
  if (!stdin.isTTY) {
    // Piped, or a terminal Node sees as a pipe (Git Bash's mintty): the first non-empty line is the token.
    // Waiting for the end of input instead would leave a person who pressed Enter at a prompt that never returns.
    return await new Promise((resolve) => {
      let all = "";
      const done = () => {
        stdin.off("data", onData);
        stdin.off("end", done);
        stdin.off("error", done);
        stdin.destroy();
        process.stderr.write("\n");
        resolve(all.split(/\r?\n|\r/).map((l) => l.trim()).find(Boolean) ?? "");
      };
      const onData = (chunk) => {
        all += chunk;
        if (/\S[^\r\n]*[\r\n]/.test(all)) done();
      };
      stdin.setEncoding("utf8");
      stdin.on("data", onData);
      stdin.once("end", done);
      stdin.once("error", done);
    });
  }
  return await new Promise((resolve) => {
    let typed = "";
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    const finish = () => {
      stdin.setRawMode(false);
      stdin.off("data", onData);
      stdin.pause();
      process.stderr.write("\n");
      resolve(typed.trim());
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return finish();
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stderr.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") typed = typed.slice(0, -1);
        else typed += ch;
      }
    };
    stdin.on("data", onData);
    stdin.resume();
  });
}

/**
 * Saves the token, readable by its owner only: 0600 in a 0700 folder on
 * Linux and macOS; on Windows, inheritance is cut and only the current user
 * keeps access (best effort — the profile folder is private to them anyway).
 */
function saveToken(origin, token) {
  const file = credentialsFile();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const all = { ...readCredentials(), [origin]: token };
  writeFileSync(file, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
  if (process.platform === "win32") {
    const user = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME;
    try {
      if (user) execFileSync("icacls", [file, "/inheritance:r", "/grant:r", `${user}:F`], { stdio: "ignore", timeout: 10_000 });
    } catch {
      console.error(`note: could not restrict ${file} to ${user}; it keeps the permissions of your profile folder`);
    }
  } else {
    chmodSync(file, 0o600);
  }
  return file;
}

function describeUser(me) {
  const u = me?.user ?? {};
  return `${u.displayName ?? "?"} <${u.email ?? "?"}>${u.kind && u.kind !== "person" ? ` (${u.kind})` : ""}`;
}

async function login(apiUrl) {
  const token = await readToken();
  if (!token) throw new Error("no token given");
  if (!token.startsWith(TOKEN_PREFIX) || /\s/.test(token)) {
    throw new Error(`that is not a DCC API token — it starts with ${TOKEN_PREFIX}`);
  }
  const me = await send(apiUrl, token, "GET", "/auth/me");
  if (me.status === 401) throw new Error(`the server refused this token (${field(me.text, "error") ?? "401"}) — it may be revoked or expired; ask for a new one`);
  if (me.status !== 200) throw new Error(`could not check the token: ${refusal(me.status, me.text)}`);
  const file = saveToken(originOf(apiUrl), token);
  console.log(`signed in as ${describeUser(JSON.parse(me.text))} — saved for ${originOf(apiUrl)} in ${file}`);
}

async function whoami(apiUrl) {
  const found = findToken(apiUrl);
  if (!found) throw new Error(`no API token for ${originOf(apiUrl)} — set DCC_API_TOKEN or run node skills/dcc.mjs login`);
  const me = await send(apiUrl, found.token, "GET", "/auth/me");
  if (me.status !== 200) throw new Error(refusal(me.status, me.text));
  console.log(`${describeUser(JSON.parse(me.text))} — token from ${found.from}, server ${apiUrl}`);
}

const [cmd, ...rest] = process.argv.slice(2);
const a = args(rest);

try {
  const c = findConfig();
  const apiUrl = () => serverFor(c, a);
  const clientId = () => {
    if (!c?.clientId) throw new Error("no clientId in .dcc.json");
    return c.clientId;
  };

  /** A call as the token's person; the body carries the repo's clientId, as it always did. */
  async function call(method, path, body) {
    const server = apiUrl();
    const found = findToken(server);
    if (!found) throw new Error(`no API token for ${originOf(server)} — set DCC_API_TOKEN or run node skills/dcc.mjs login`);
    const res = await send(server, found.token, method, path, body ? { clientId: c?.clientId, ...body } : undefined);
    if (res.status < 200 || res.status >= 300) throw new Error(refusal(res.status, res.text));
    return res.text;
  }

  if (cmd === "login") {
    await login(apiUrl());
  } else if (cmd === "whoami") {
    await whoami(apiUrl());
  } else if (cmd === "resolve") {
    console.log(await call("GET", `/resolve?clientId=${encodeURIComponent(clientId())}&branch=${encodeURIComponent(a.branch)}`));
  } else if (cmd === "brief") {
    console.log(await call("GET", `/workitems/${a.workitem}/brief`));
  } else if (cmd === "gap") {
    console.log(
      await call("POST", `/workitems/${a.workitem}/gaps`, {
        description: a.description,
        blocking: !!a.blocking,
        confidence: Number(a.confidence ?? 0.5),
        mode: "delegated",
      }),
    );
  } else if (cmd === "blocker") {
    console.log(
      await call("POST", `/workitems/${a.workitem}/blockers`, {
        questionType: a.type ?? "unclear_requirement",
        question: a.question,
      }),
    );
  } else if (cmd === "contention") {
    console.log(await call("GET", `/repos/${encodeURIComponent(a.repo)}/contention?clientId=${encodeURIComponent(clientId())}`));
  } else if (cmd === "touches") {
    console.log(
      await call("POST", `/workitems/${a.workitem}/touches`, {
        repo: a.repo,
        branch: a.branch,
        kind: a.kind || "declared",
        paths: String(a.paths).split(",").map((s) => s.trim()).filter(Boolean),
      }),
    );
  } else if (cmd === "touches-release") {
    console.log(await call("POST", `/workitems/${a.workitem}/touches/release`, {}));
  } else if (cmd === "review") {
    const findings = a.file ? JSON.parse(readFileSync(a.file, "utf8")) : [];
    console.log(
      await call("POST", `/workitems/${a.workitem}/review`, {
        prRef: a.pr ? String(a.pr) : undefined,
        verdict: a.verdict,
        findings,
        overlapFocus: a.overlap ? String(a.overlap).split(",").map((s) => s.trim()) : [],
      }),
    );
  } else if (cmd === "tasks") {
    const parsed = JSON.parse(readFileSync(a.file, "utf8"));
    const tasks = Array.isArray(parsed) ? parsed : parsed.tasks;
    console.log(
      await call("POST", `/workitems/${a.workitem}/tasks`, {
        tasks,
        openspecChangeId: a.change || parsed.openspecChangeId,
      }),
    );
  } else {
    console.error(
      "usage: dcc <login|whoami|resolve|brief|gap|blocker|tasks|contention|touches|touches-release|review> [--flags]",
    );
    process.exit(2);
  }
} catch (e) {
  console.error("dcc error:", String(e?.message ?? e));
  process.exit(1);
}
