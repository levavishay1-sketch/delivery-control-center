import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "./ai-assist.ts";

/**
 * "How do I know nothing broke?" — the question a person asks after deciding
 * a conflict, and the one thing a screen full of code cannot answer by
 * looking.
 *
 * So DCC runs the repository's own checks on the merged result, before it is
 * pushed: an isolated copy at the merge commit, the repository's dependencies
 * made available to it, and the commands the repository itself declares. The
 * answer is the same one a developer gets from their terminal, which is the
 * only answer worth giving.
 *
 * Three things keep it honest:
 *
 * - **It runs the merged code, not the code next door.** The copy is a
 *   `git worktree` at the merge commit. Dependencies are linked in from the
 *   shared clone, except the repository's own workspace packages, which are
 *   linked to THIS copy — otherwise a check would compile the folder someone
 *   is editing and call the merge sound.
 * - **It only runs what the repository declares.** The commands come from its
 *   own `package.json` scripts, never from a list DCC invented; a repository
 *   with no checks is told so plainly instead of being given a green tick.
 * - **It reports what happened.** A check that fails brings back its own last
 *   lines, and a check DCC could not run says why.
 */

export type CheckResult = { name: string; command: string; ok: boolean; skipped?: string; ms: number; output: string };
export type VerifyResult = {
  /** false when the repository declares no checks — then nothing was proved, and the screen says so. */
  ran: boolean;
  why?: string;
  commit: string;
  checks: CheckResult[];
};

const VERIFY_ROOT = path.join(os.homedir(), ".dcc-verify");

/** The script names worth running on a merge, in the order a person would run them. Anything else is the repository's business. */
const WANTED = ["typecheck", "lint", "test", "audit:stale", "build"] as const;
/** `build` is slow and rarely says anything `typecheck` did not; it runs only when nothing else exists. */
const LAST_RESORT = "build";

const PER_CHECK_MS = 300_000;

function run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    const p = spawn(command, args, { cwd, windowsHide: true, shell: process.platform === "win32", env: { ...process.env, CI: "1", NO_COLOR: "1" } });
    let out = "";
    let done = false;
    const finish = (r: { code: number; out: string }) => { if (!done) { done = true; clearTimeout(killer); res(r); } };
    const killer = setTimeout(() => {
      if (process.platform === "win32" && p.pid) spawn("taskkill", ["/pid", String(p.pid), "/t", "/f"], { windowsHide: true });
      else p.kill("SIGKILL");
      finish({ code: 1, out: `${out}\n\nהבדיקה לא הסתיימה תוך ${Math.round(timeoutMs / 1000)} שניות ונעצרה.` });
    }, timeoutMs);
    p.stdout?.on("data", (d) => { out += d; });
    p.stderr?.on("data", (d) => { out += d; });
    p.on("close", (code) => finish({ code: code ?? 1, out: out.trim() }));
    p.on("error", (e) => finish({ code: 1, out: String(e) }));
  });
}

const readJson = (file: string): { scripts?: Record<string, string>; name?: string; workspaces?: string[] } | null => {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
};

/**
 * The dependencies, without installing them again: every entry of the shared
 * clone's `node_modules` linked into the copy — except the repository's own
 * workspace packages, which are linked to the copy's own sources. Without
 * that exception the checks would read the folder somebody is working in.
 */
function linkDependencies(from: string, to: string): string | null {
  const src = path.join(from, "node_modules");
  if (!existsSync(src)) return "אין תלויות מותקנות בעותק המקומי (node_modules), ולכן אי אפשר להריץ את הבדיקות מכאן.";
  const dst = path.join(to, "node_modules");
  mkdirSync(dst, { recursive: true });

  // Which package names belong to this repository itself.
  const own = new Map<string, string>();
  const root = readJson(path.join(to, "package.json"));
  for (const pattern of root?.workspaces ?? []) {
    const dir = pattern.replace(/\/\*$/, "");
    const full = path.join(to, dir);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full)) {
      const name = readJson(path.join(full, entry, "package.json"))?.name;
      if (name) own.set(name, path.join(full, entry));
    }
  }
  const ownScopes = new Set([...own.keys()].filter((n) => n.startsWith("@")).map((n) => n.split("/")[0]!));

  for (const entry of readdirSync(src)) {
    if (ownScopes.has(entry)) continue;
    try { symlinkSync(path.join(src, entry), path.join(dst, entry), "junction"); } catch { /* one link short is reported by the check itself */ }
  }
  for (const [name, dir] of own) {
    const target = path.join(dst, ...name.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    try { symlinkSync(dir, target, "junction"); } catch { /* same */ }
  }
  return null;
}

/** What this repository says a change is verified by. */
function checksOf(dir: string): { name: string; args: string[] }[] {
  const scripts = readJson(path.join(dir, "package.json"))?.scripts ?? {};
  const found = WANTED.filter((n) => scripts[n]);
  const use = found.filter((n) => n !== LAST_RESORT).length ? found.filter((n) => n !== LAST_RESORT) : found;
  return use.map((n) => ({ name: n, args: ["run", n] }));
}

/**
 * Run the repository's checks against one commit, in a copy of its own.
 * `sharedDir` is the clone the objects live in — it is read, never changed.
 */
export async function verifyCommit(sharedDir: string, commit: string, label: string): Promise<VerifyResult> {
  mkdirSync(VERIFY_ROOT, { recursive: true });
  const dir = path.join(VERIFY_ROOT, label);
  const LONG = process.platform === "win32" ? ["-c", "core.longpaths=true"] : [];
  await git([...LONG, "worktree", "remove", dir, "--force"], sharedDir);
  rmSync(dir, { recursive: true, force: true });
  await git(["worktree", "prune"], sharedDir);

  const added = await git([...LONG, "worktree", "add", "--detach", dir, commit], sharedDir, { timeoutMs: 300_000 });
  if (added.code !== 0) return { ran: false, why: `לא הצלחנו להכין עותק לבדיקה: ${added.out.slice(0, 200)}`, commit, checks: [] };

  try {
    const wanted = checksOf(dir);
    if (!wanted.length) {
      return { ran: false, why: "במאגר הזה אין סקריפטים של בדיקה (typecheck / lint / test / build), ולכן אין מה להריץ. אחרי הדחיפה כדאי לבדוק כמו שאתם רגילים.", commit, checks: [] };
    }
    const problem = linkDependencies(sharedDir, dir);
    if (problem) return { ran: false, why: problem, commit, checks: [] };

    const checks: CheckResult[] = [];
    for (const c of wanted) {
      const at = Date.now();
      const r = await run("npm", c.args, dir, PER_CHECK_MS);
      checks.push({ name: c.name, command: `npm run ${c.name}`, ok: r.code === 0, ms: Date.now() - at, output: r.out.split("\n").slice(-40).join("\n") });
    }
    return { ran: true, commit, checks };
  } finally {
    await git([...LONG, "worktree", "remove", dir, "--force"], sharedDir);
    rmSync(dir, { recursive: true, force: true });
    await git(["worktree", "prune"], sharedDir);
  }
}
