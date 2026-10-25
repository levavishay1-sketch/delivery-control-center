// What the hook and CLI tests share: a stand-in DCC server, a throwaway git
// repository with a .dcc.json, a private home folder, and a way to run a
// script the way Claude Code does (JSON on stdin, output collected).
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const HOOKS = join(ROOT, "hooks");
export const CLI = join(ROOT, "skills", "dcc.mjs");
export const CLIENT_ID = "2d9ec8f0-0000-4000-8000-000000000001";
export const BRANCH = "feature/WI-12-pricing";

const cleanups = [];
export function cleanup() {
  for (const c of cleanups.splice(0)) {
    try {
      c();
    } catch {
      /* a temp folder Windows still holds open is not a test failure */
    }
  }
}

export function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * A stand-in DCC server. `routes` maps "METHOD /path" (no query) to a reply:
 * `{ status, json }`, `{ status, text }`, or `{ hang: true }` for a server
 * that takes the request and never answers. Every request is recorded.
 */
export async function startStub(routes = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://stub");
      requests.push({ method: req.method, path: url.pathname, url: req.url, query: url.searchParams, headers: req.headers, body });
      const reply = routes[`${req.method} ${url.pathname}`] ?? { status: 404, json: { error: "not_found", message: "no match" } };
      if (reply.hang) return;
      if (reply.json !== undefined) {
        res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
        res.end(JSON.stringify(reply.json));
      } else {
        res.writeHead(reply.status ?? 200, { "content-type": "text/markdown" });
        res.end(reply.text ?? "");
      }
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const stub = {
    origin,
    requests,
    async close() {
      server.closeAllConnections();
      await new Promise((ok) => server.close(ok));
    },
  };
  cleanups.push(() => server.closeAllConnections());
  return stub;
}

/** A port nothing listens on. */
export async function deadOrigin() {
  const s = createServer();
  await new Promise((ok) => s.listen(0, "127.0.0.1", ok));
  const port = s.address().port;
  await new Promise((ok) => s.close(ok));
  return `http://127.0.0.1:${port}`;
}

/** A home folder of its own, so the developer's real ~/.dcc and git config never leak in. */
export function makeHome(credentials) {
  const home = tempDir("dcc-home-");
  if (credentials) {
    mkdirSync(join(home, ".dcc"));
    writeFileSync(join(home, ".dcc", "credentials.json"), JSON.stringify(credentials));
  }
  return home;
}

/** The environment a script runs in: none of the caller's DCC settings, a private home. */
export function envFor(home, extra = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: "1" };
  delete env.DCC_API_TOKEN;
  delete env.DCC_CAPTURE;
  return { ...env, ...extra };
}

/** A git repository on `branch` with one commit and a .dcc.json pointing at `apiUrl`. */
export function makeRepo(apiUrl, { branch = BRANCH, detached = false } = {}) {
  const dir = tempDir("dcc-repo-");
  const home = makeHome();
  const run = (...args) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
      cwd: dir,
      env: envFor(home),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  run("init", "-q");
  run("checkout", "-q", "-b", branch);
  run("commit", "-q", "--allow-empty", "-m", "first");
  if (detached) run("checkout", "-q", "--detach");
  writeFileSync(join(dir, ".dcc.json"), JSON.stringify({ apiUrl, clientId: CLIENT_ID, repo: "demo-repo" }));
  return { dir, head: run("rev-parse", "HEAD") };
}

/** Runs a script as Claude Code runs a hook: `input` on stdin, then waits for it to exit. */
export function runScript(script, { args = [], cwd, env, input = "" }) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, [script, ...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }));
    child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
  });
}

export const hook = (name) => join(HOOKS, `${name}.mjs`);
