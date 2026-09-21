import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ChangedFile } from "./types.ts";

/**
 * The change a run made, as diff text — for the assistants that are asked what
 * the change is or whether it is sound. The chat's reading tools are Read, Grep
 * and Glob — no `git` — so the change is written to a file it can read
 * (`writeChangesDiff`); the file notes get the same text inside their prompt
 * (`buildChangesDiff`). Tracked files come from `git diff` against the baseline;
 * new files git does not track yet are written as all-added files. Lock files are
 * listed without their body (thousands of generated lines nobody reads), and a
 * file or a whole diff that is very long is cut with a line saying so. `git` is
 * passed in, so this module touches nothing but git and the file system.
 */

type GitFn = (args: string[], cwd: string, opts?: { timeoutMs?: number }) => Promise<{ code: number; out: string }>;

const GENERATED = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock)$/;

export type ChangesDiff = { text: string; shown: number; withoutBody: string[]; cut: string[] };
export type DiffLimits = { maxFileLines?: number; maxTotalChars?: number };

export async function buildChangesDiff(git: GitFn, dir: string, baselineSha: string, files: ChangedFile[], limits: DiffLimits = {}): Promise<ChangesDiff> {
  const maxFileLines = limits.maxFileLines ?? 700;
  const maxTotal = limits.maxTotalChars ?? 200_000;
  const parts: string[] = [];
  const result: ChangesDiff = { text: "", shown: 0, withoutBody: [], cut: [] };
  let total = 0;
  for (const f of files) {
    const stats = `${f.status} +${f.additions} −${f.deletions}`;
    if (GENERATED.test(f.path)) {
      parts.push(`### ${f.path} (${stats}) — generated lock file, diff not shown\n`);
      result.withoutBody.push(f.path);
      continue;
    }
    if (total >= maxTotal) {
      parts.push(`### ${f.path} (${stats}) — not shown: the diff is already long enough\n`);
      result.cut.push(f.path);
      continue;
    }
    let text = "";
    const tracked = await git(["diff", baselineSha, "--", f.path], dir, { timeoutMs: 30_000 });
    if (tracked.code === 0 && tracked.out.trim()) {
      text = tracked.out;
    } else {
      const full = path.join(dir, f.path);
      if (!existsSync(full) || !statSync(full).isFile()) continue;
      const buf = readFileSync(full);
      if (buf.includes(0)) { parts.push(`### ${f.path} (${stats}) — binary file, not shown\n`); result.withoutBody.push(f.path); continue; }
      const lines = buf.toString("utf8").split("\n");
      text = [`diff --git a/${f.path} b/${f.path}`, "new file mode 100644", "--- /dev/null", `+++ b/${f.path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n");
    }
    const lines = text.split("\n");
    if (lines.length > maxFileLines) {
      text = `${lines.slice(0, maxFileLines).join("\n")}\n… (${lines.length - maxFileLines} more lines of this file's diff are not shown)`;
      result.cut.push(f.path);
    }
    parts.push(`### ${f.path} (${stats})\n${text}\n`);
    total += text.length;
    result.shown++;
  }
  result.text = parts.join("\n");
  return result;
}

/** The same, written to a file — the chat reads it with its own tools. */
export async function writeChangesDiff(git: GitFn, dir: string, baselineSha: string, files: ChangedFile[], outFile: string): Promise<ChangesDiff> {
  const built = await buildChangesDiff(git, dir, baselineSha, files);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, built.text, "utf8");
  return built;
}
