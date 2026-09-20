import { spawn } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Opening a folder of DCC's own on the machine the API runs on.
 *
 * The code map shows a path for work that exists only on this computer, and a
 * button that opens it. Because a web request must never be able to open an
 * arbitrary place on disk, only folders under DCC's own working roots qualify:
 * the shared clones and the isolated onboarding copies.
 */

export const REPO_CACHE_ROOT = path.join(os.homedir(), ".dcc-repos");
export const ONBOARDING_WORK_ROOT = path.join(os.homedir(), ".dcc-repos-onboarding");
const ROOTS = [REPO_CACHE_ROOT, ONBOARDING_WORK_ROOT];

/** A path as a person on this platform would write it. */
export const displayPath = (p: string) => path.normalize(p);

const inside = (child: string, root: string) => {
  const rel = path.relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

export class FolderRefused extends Error {}

export function openLocalFolder(requested: string): { opened: string } {
  if (!requested || typeof requested !== "string") throw new FolderRefused("לא נבחרה תיקייה");
  const abs = path.resolve(requested);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new FolderRefused("התיקייה לא קיימת במחשב הזה");
  // Symlinks and `..` are resolved before the check, so a path that only looks like it is under a root does not pass.
  const real = realpathSync(abs);
  if (!ROOTS.some((r) => existsSync(r) && inside(real, realpathSync(r)))) throw new FolderRefused("אפשר לפתוח רק תיקיות של DCC עצמו");

  const [cmd, args] =
    process.platform === "win32" ? ["explorer.exe", [displayPath(real)]]
    : process.platform === "darwin" ? ["open", [real]]
    : ["xdg-open", [real]];
  // Fire and forget: Explorer reports a non-zero exit code even when it opened the folder.
  const child = spawn(cmd, args as string[], { detached: true, stdio: "ignore" });
  child.on("error", () => { /* no file manager on this machine */ });
  child.unref();
  return { opened: displayPath(real) };
}
