/**
 * Which git branch is a task's — one answer, kept in one place.
 *
 * A task's branch is a fact recorded the moment a run creates it (`task.branch`)
 * and read from there ever after. The name is NOT worked out again from the
 * requirement's key or the task's wording: both change (a requirement gets its
 * real key, an instruction is edited), and a name worked out again then points
 * at a branch that is not there — the task looks never developed, or as if it
 * changed nothing. The formula below is only for naming a branch the first time,
 * and for tasks from before the name was recorded.
 *
 * Pure — no database, no git. The unit test drives it directly.
 */

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** The name a NEW branch for the task is given. Never use it to find an existing one — see `branchOf`. */
export const taskBranchName = (reqKey: string | null | undefined, t: { seq: number; intent: string }) =>
  `task/${reqKey ?? "REQ"}-t${t.seq}${slug(t.intent) ? `-${slug(t.intent)}` : ""}`;

/** The task's branch: the one recorded when it was created; only a task with none recorded falls back to the name it would be given now. */
export const branchOf = (reqKey: string | null | undefined, t: { seq: number; intent: string; branch?: string | null }) =>
  t.branch || taskBranchName(reqKey, t);

/**
 * The branch to record for a task that has none, from what actually happened:
 * the branches its own development runs report, newest first, then the name it
 * would get now. The first that exists in the clone wins — a run's own record
 * beats a formula. Null when none exists (the task was never developed, or its
 * branch is gone): nothing is guessed.
 */
export function branchToRecord(input: { runBranches: string[]; derived: string; exists: (branch: string) => boolean }): string | null {
  const seen = new Set<string>();
  for (const b of [...input.runBranches, input.derived]) {
    if (!b || seen.has(b)) continue;
    seen.add(b);
    if (input.exists(b)) return b;
  }
  return null;
}
