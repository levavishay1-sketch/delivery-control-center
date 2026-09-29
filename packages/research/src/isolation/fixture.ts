import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { git } from "./git.ts";

/**
 * HELPER, tests and reports only. A small synthetic source repository with a
 * known history, so that the copy and the temporal-order checks can be
 * exercised, including deliberate violations, without touching any real
 * repository:
 *
 *   base -- F -- start (S_c) -- task (c) -- later      (branch main, tag v1 on task)
 *     \
 *      side    (dated between F and S_c, not an ancestor of S_c)
 *
 * The task commit introduces `computeLedgerChecksum`, a name that occurs
 * nowhere before it.
 */

export type FixtureCommits = { base: string; F: string; side: string; start: string; task: string; later: string };

const at = (day: number) => `2026-01-${String(day).padStart(2, "0")}T10:00:00+00:00`;

function commit(dir: string, day: number, message: string, files: Record<string, string>): string {
  for (const [p, content] of Object.entries(files)) {
    const full = path.join(dir, p);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "--quiet", "-m", message], { env: { GIT_AUTHOR_DATE: at(day), GIT_COMMITTER_DATE: at(day) } });
  return git(dir, ["rev-parse", "HEAD"]);
}

export function makeFixtureRepo(dir: string): FixtureCommits {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "--quiet", "--initial-branch=main"]);
  const base = commit(dir, 1, "Ledger with sums", {
    "README.md": "# ledger\n",
    "src/ledger.js": "export function sumEntries(entries) {\n  return entries.reduce((a, e) => a + e.amount, 0);\n}\n",
    "test/ledger.test.js": "import { sumEntries } from '../src/ledger.js';\nif (sumEntries([{ amount: 2 }]) !== 2) throw new Error('sum');\n",
  });
  const F = commit(dir, 3, "Document the ledger", { "docs/ledger.md": "Entries are summed by sumEntries.\n" });
  git(dir, ["checkout", "--quiet", "-b", "side", base]);
  const side = commit(dir, 4, "Side experiment", { "src/side.js": "export const sideFlag = true;\n" });
  git(dir, ["checkout", "--quiet", "main"]);
  const start = commit(dir, 5, "Validate entries", { "src/ledger.js": "export function sumEntries(entries) {\n  if (!Array.isArray(entries)) throw new TypeError('entries');\n  return entries.reduce((a, e) => a + e.amount, 0);\n}\n" });
  const task = commit(dir, 7, "Add a ledger checksum", {
    "src/checksum.js": "export function computeLedgerChecksum(entries) {\n  return entries.map((e) => e.amount).join('|');\n}\n",
    "test/checksum.test.js": "import { computeLedgerChecksum } from '../src/checksum.js';\nif (computeLedgerChecksum([{ amount: 1 }]) !== '1') throw new Error('checksum');\n",
  });
  git(dir, ["tag", "v1", task]);
  const later = commit(dir, 9, "Later work", { "docs/later.md": "later\n" });
  return { base, F, side, start, task, later };
}
