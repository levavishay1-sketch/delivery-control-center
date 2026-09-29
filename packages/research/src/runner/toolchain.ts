import { createHash } from "node:crypto";
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where a run lives, and which tools its agent can find.
 *
 * RUN ROOT: outside the user's profile, so that the agent's working
 * directory, its synthetic home and temp, and every path the harness hands
 * it name no real user. On Windows the default is <SystemDrive>\dcc-pilot,
 * which a standard user can create; it is a plain folder, not a setting.
 *
 * PATH: never the user's. An explicit, minimal list: a bin folder in the run
 * root holding a hard link to node.exe (node needs no other file), and git
 * for Windows' own `cmd` folder (git.exe there locates the rest of its
 * installation, so it cannot be linked elsewhere). Nothing else. A tool
 * folder under the user's profile is refused, not silently used.
 *
 * JOB HELPER (Windows): job-run.exe, compiled from job-run.cs with the .NET
 * Framework's in-box csc.exe into the run root's bin folder; no download.
 */

export function defaultRunRoot(): string {
  return process.platform === "win32" ? path.join(`${process.env.SystemDrive ?? "C:"}\\`, "dcc-pilot") : path.join("/tmp", "dcc-pilot");
}

/** The real profile, in its long and its short (8.3) spellings, and the account name, lower-cased; for checks only, never printed. */
export function realIdentity(): { profiles: string[]; user: string } {
  const long = os.homedir().toLowerCase();
  const tmp = os.tmpdir().toLowerCase();
  const short = tmp.includes(`${path.sep}users${path.sep}`) ? tmp.split(path.sep).slice(0, 3).join(path.sep) : long;
  const user = (os.userInfo().username || process.env.USERNAME || process.env.USER || "").toLowerCase();
  return { profiles: [...new Set([long, short])], user };
}

export function underProfile(p: string): boolean {
  const l = path.resolve(p).toLowerCase();
  return realIdentity().profiles.some((prof) => l === prof || l.startsWith(prof + path.sep));
}

function whereGitCmdDir(): string {
  if (process.platform !== "win32") return path.dirname(execFileSync("which", ["git"], { encoding: "utf8" }).trim());
  const found = execFileSync("where", ["git"], { encoding: "utf8" }).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const cmd = found.find((f) => /[\\/]cmd[\\/]git\.exe$/i.test(f)) ?? found[0];
  if (!cmd) throw new Error("git not found");
  return path.dirname(cmd);
}

export type Toolchain = { binDir: string; node: string; pathDirs: string[]; jobHelper: string | null };

export function prepareToolchain(runRoot: string): Toolchain {
  const binDir = path.join(runRoot, "bin");
  mkdirSync(binDir, { recursive: true });
  const nodeName = process.platform === "win32" ? "node.exe" : "node";
  const node = path.join(binDir, nodeName);
  if (!existsSync(node)) {
    try { linkSync(process.execPath, node); } catch { copyFileSync(process.execPath, node); }
  }
  const gitDir = whereGitCmdDir();
  const pathDirs = [binDir, gitDir];
  const inProfile = pathDirs.filter(underProfile);
  if (inProfile.length) throw new Error(`a required tool folder is under the user's profile (${inProfile.length}); refusing to expose it`);
  return { binDir, node, pathDirs, jobHelper: process.platform === "win32" ? buildJobHelper(binDir) : null };
}

export const JOB_SOURCE = fileURLToPath(new URL("./job-run.cs", import.meta.url));

export function buildJobHelper(binDir: string): string {
  const src = readFileSync(JOB_SOURCE);
  const hash = createHash("sha256").update(src).digest("hex").slice(0, 16);
  const exe = path.join(binDir, `job-run-${hash}.exe`);
  if (existsSync(exe)) return exe;
  const root = process.env.SystemRoot ?? "C:\\Windows";
  const csc = [path.join(root, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"), path.join(root, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")].find(existsSync);
  if (!csc) throw new Error("csc.exe of the .NET Framework was not found; the job helper cannot be built");
  execFileSync(csc, ["/nologo", "/optimize+", "/target:exe", `/out:${exe}`, JOB_SOURCE], { stdio: "pipe" });
  return exe;
}

export const MOCK_AGENT_SOURCE = fileURLToPath(new URL("./fixtures/mock-agent.mjs", import.meta.url));

/** Copies the mock agent into the bin folder, so that its path in the child's argv names no real user. */
export function stageMockAgent(tc: Toolchain): string {
  const target = path.join(tc.binDir, "mock-agent.mjs");
  copyFileSync(MOCK_AGENT_SOURCE, target);
  return target;
}
