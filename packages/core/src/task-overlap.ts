/**
 * Two tasks that changed the same file — the pure part: which files, and what
 * git said when the two branches were merged in a scratch tree.
 *
 * Whether the pair is a problem depends on how the tasks relate: when one holds
 * the other's work (a dependency the task was built on) there is nothing to
 * merge; when neither does, the person should be told the two touch the same
 * file and whether they combine cleanly or conflict. No database, no git.
 */

/** The files both lists name, sorted. */
export function sharedFiles(a: string[], b: string[]): string[] {
  const inB = new Set(b);
  return [...new Set(a.filter((f) => inB.has(f)))].sort();
}

export type MergePreview = { clean: true } | { clean: false; conflictFiles: string[] };

/**
 * `git merge-tree --write-tree --name-only` output and exit code. Exit 0 = a clean merge; exit 1 = conflicts, listed by name
 * after the tree id, up to the first blank line; anything else is an error git did not explain as a conflict.
 */
export function readMergeTree(code: number, out: string): MergePreview | null {
  if (code === 0) return { clean: true };
  if (code !== 1) return null;
  const lines = out.replace(/\r\n/g, "\n").split("\n");
  const files: string[] = [];
  for (const l of lines.slice(1)) {
    if (!l.trim()) break;
    files.push(l.trim());
  }
  return { clean: false, conflictFiles: [...new Set(files)] };
}
