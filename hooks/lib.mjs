// Shared helpers for the DCC Claude Code hooks. Zero dependencies.
//
// A hook must never break or slow down the session it runs in: every network
// call has a timeout, every failure becomes one stderr line, and the hooks
// always exit 0. Identity comes from an API token (dcc_pat_…) — the token's
// person is who the server records; nothing here says who the developer is.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

/** How long one call to the server may take before the hook gives up on it. */
export const TIMEOUT_MS = 5000;

/** The line a hook logs when the server refuses its token. */
export const LOGIN_HINT = "token revoked or expired — run node skills/dcc.mjs login";

/**
 * DCC sets DCC_CAPTURE=off on the Claude processes it starts itself: those
 * runs are already in its ledger, and capturing them again would count them twice.
 */
export function captureOff() {
  return (process.env.DCC_CAPTURE ?? "").trim().toLowerCase() === "off";
}

/** Read the hook event JSON Claude Code sends on stdin. */
export function readHookInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

/** Walk up from `start` for a `.dcc.json` — repo-level config. A file that does not parse counts as none. */
export function findRepoConfig(start) {
  let dir = start;
  const root = parse(dir).root;
  while (true) {
    const f = join(dir, ".dcc.json");
    if (existsSync(f)) {
      try {
        return { ...JSON.parse(readFileSync(f, "utf8")), _dir: dir };
      } catch (e) {
        log(`${f} is not valid JSON:`, e.message);
        return null;
      }
    }
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

/** Run git quietly, with a ceiling, so a slow or broken repository never holds the session up. */
export function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** The checked-out branch, or null on a detached HEAD or outside git. */
export function currentBranch(cwd) {
  try {
    return git(cwd, "branch", "--show-current") || null;
  } catch {
    return null;
  }
}

/** Where `dcc login` keeps tokens: one per server, keyed by the server's origin. */
export function credentialsFile() {
  return join(homedir(), ".dcc", "credentials.json");
}

/**
 * The API token for this server: DCC_API_TOKEN first (CI, or the env block of
 * the user-level ~/.claude/settings.json), then ~/.dcc/credentials.json under
 * the apiUrl's origin. Null when neither has one.
 */
export function findToken(apiUrl) {
  const fromEnv = process.env.DCC_API_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  let origin;
  try {
    origin = new URL(apiUrl).origin;
  } catch {
    return null;
  }
  try {
    const saved = JSON.parse(readFileSync(credentialsFile(), "utf8"))?.[origin];
    return typeof saved === "string" && saved.trim() ? saved.trim() : null;
  } catch {
    return null;
  }
}

/**
 * apiUrl + path, keeping any path prefix in apiUrl — `new URL("/events", "https://host/api")`
 * would drop the `/api`, which breaks a server behind a reverse proxy or the vite proxy.
 */
export function joinUrl(apiUrl, path) {
  return `${String(apiUrl).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
}

/** Drops null and undefined fields, so an absent value is never sent as `null`. */
export function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
}

/**
 * One call to the DCC server. Never throws. Returns `{ status, body }` when
 * the server answered, `{ skipped }` when nothing was sent, `{ failed }` when
 * the call did not complete (unreachable, timed out).
 */
export async function api(cfg, method, path, body) {
  if (captureOff()) return { skipped: "DCC_CAPTURE=off" };
  if (!cfg?.apiUrl) return { skipped: "no apiUrl in .dcc.json" };
  const token = findToken(cfg.apiUrl);
  if (!token) {
    return { skipped: "no API token — set DCC_API_TOKEN or run node skills/dcc.mjs login" };
  }
  const url = joinUrl(cfg.apiUrl, path);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    const why = e?.name === "TimeoutError" ? `no answer within ${TIMEOUT_MS / 1000} s` : e?.cause?.code ?? e?.message ?? String(e);
    return { failed: `${method} ${url}: ${why}` };
  }
}

/**
 * Says what went wrong with a call, or null when the server answered with
 * something other than a refusal (the caller decides what a 404 means).
 */
export function problem(res) {
  if (res.skipped) return res.skipped;
  if (res.failed) return res.failed;
  if (res.status === 401) return `${LOGIN_HINT} (${errorField(res.body, "error") ?? "401"})`;
  if (res.status === 403) {
    const permission = errorField(res.body, "permission");
    return permission ? `forbidden — the token's person lacks ${permission}` : `forbidden — ${errorField(res.body, "message") ?? "403"}`;
  }
  return null;
}

function errorField(text, key) {
  try {
    const v = JSON.parse(text)?.[key];
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

export function log(...a) {
  process.stderr.write(`[dcc-hook] ${a.join(" ")}\n`);
}

/**
 * Runs a hook's body so that nothing it does can fail the session: any
 * exception is one stderr line, and the process always exits 0.
 */
export async function runHook(body) {
  try {
    if (!captureOff()) await body();
  } catch (e) {
    log("hook failed:", e?.message ?? String(e));
  }
  process.exit(0);
}
