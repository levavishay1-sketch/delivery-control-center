// Shared helpers for the DCC Claude Code hooks. Zero dependencies.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { execFileSync } from "node:child_process";

/** Read the hook event JSON Claude Code sends on stdin. */
export function readHookInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

/** Walk up from `start` for a `.dcc.json` — repo-level config. */
export function findRepoConfig(start) {
  let dir = start;
  const root = parse(dir).root;
  while (true) {
    const f = join(dir, ".dcc.json");
    if (existsSync(f)) return { ...JSON.parse(readFileSync(f, "utf8")), _dir: dir };
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

export function currentBranch(cwd) {
  try {
    return execFileSync("git", ["branch", "--show-current"], { cwd, encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

/** Per-user identity + shared secret, from the environment. */
export function identity() {
  return {
    email: process.env.DCC_DEV_EMAIL,
    token: process.env.DCC_HOOK_TOKEN,
  };
}

export async function api(cfg, method, path, body) {
  const { email, token } = identity();
  if (!cfg?.apiUrl || !email || !token) return { skipped: "missing config (.dcc.json / DCC_DEV_EMAIL / DCC_HOOK_TOKEN)" };
  const res = await fetch(new URL(path, cfg.apiUrl), {
    method,
    headers: {
      "content-type": "application/json",
      "x-dcc-hook-token": token,
      "x-dcc-dev-email": email,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

export function log(...a) {
  process.stderr.write(`[dcc-hook] ${a.join(" ")}\n`);
}
