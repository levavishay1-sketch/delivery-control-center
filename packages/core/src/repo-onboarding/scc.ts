import { spawn } from "node:child_process";

/**
 * Wrapper around `scc` (Sloc Cloc and Code — github.com/boyter/scc, MIT
 * licence) — a real, maintained, accuracy-focused code counter, used here
 * to replace `scanner.ts`'s old hand-rolled "count files by extension"
 * language detection. Real per-language lines-of-code (code/comment/
 * blank) and a cyclomatic-complexity estimate, not just a file tally —
 * directly useful to the `classification` stage, which previously had to
 * guess "complexity: high/medium/low" from a bare file/language list.
 *
 * Treated as an ambient CLI the deployment provides (installed once via
 * winget/choco/brew/apt/`go install`), the same model this codebase
 * already uses for `gh` in `github-pull-request.ts` — DCC does not
 * download, bundle, or manage the binary itself. `scanRepository` falls
 * back to the old extension-counting logic when it's missing, so a repo
 * without `scc` on PATH never hard-fails onboarding over it.
 */

export type SccLanguage = {
  name: string;
  fileCount: number;
  lines: number;
  code: number;
  comment: number;
  blank: number;
  /** scc's cyclomatic-complexity-style estimate, summed across every file
   *  of this language — 0 for languages scc has no complexity rules for
   *  (markup/data formats), not "no complexity". */
  complexity: number;
};

export class SccNotAvailableError extends Error {}

type SccJsonRow = {
  Name: string;
  Count: number;
  Lines: number;
  Code: number;
  Comment: number;
  Blank: number;
  Complexity: number;
};

/** Directories `scc` skips outright, on top of whatever the repo's own
 *  `.gitignore`/`.ignore` already excludes (which `scc` respects by
 *  default) — needed because not every repo actually gitignores its own
 *  vendored/build output (confirmed live: Altshuler Trade's legacy
 *  packages-config `.NET` style commits `packages/` straight into git —
 *  without this list `scc` counted 456MB/6.9M lines of vendored NuGet
 *  XML as if it were the repo's own code). Mirrors the old scanner's
 *  `KNOWN_JUNK_DIR_NAMES`. */
const SCC_EXCLUDE_DIRS = [
  ".git", ".hg", ".svn", "bin", "obj", "dist", "build", "out", "target",
  "node_modules", "vendor", "packages", ".next", ".nuxt", "__pycache__",
  ".venv", "venv", ".gradle", ".terraform",
];

/** Runs `scc --format json` against `dir` and returns per-language stats.
 *  Rejects with `SccNotAvailableError` specifically when `scc` isn't on
 *  PATH (`ENOENT`), so callers can distinguish "not installed" (a
 *  legitimate fallback case) from a real failure. */
export function runScc(dir: string): Promise<SccLanguage[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "scc",
      ["--format", "json", "--exclude-dir", SCC_EXCLUDE_DIRS.join(","), "--no-gen", dir],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") reject(new SccNotAvailableError("scc is not installed / not on PATH"));
      else reject(err);
    });
    child.on("close", (code) => {
      if (code !== 0) { reject(new Error(`scc exited with code ${code}: ${stderr.slice(0, 500)}`)); return; }
      try {
        const raw = JSON.parse(stdout) as SccJsonRow[];
        resolve(raw.map((r): SccLanguage => ({
          name: r.Name, fileCount: r.Count, lines: r.Lines, code: r.Code, comment: r.Comment, blank: r.Blank, complexity: r.Complexity,
        })));
      } catch (e) {
        reject(new Error(`failed to parse scc JSON output: ${(e as Error).message}`));
      }
    });
  });
}
