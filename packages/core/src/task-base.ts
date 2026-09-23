/**
 * What a task's branch is built on — pure (no git, no database), so the
 * decision is tested on its own; `ai-assist.ts` gathers the facts from git.
 *
 * A task may be developed while the tasks it depends on are not finished.
 * When exactly one line of that unfinished work already exists as code — a
 * dependency's branch that is not in the default branch yet — the new branch
 * starts from it, so Claude sees and builds on what was already done. What is
 * not in that base is named, so the prompt, the checks and the screen can say
 * what the task was developed without.
 */

export type DependencyFacts = {
  id: string;
  seq: number;
  intent: string;
  /** The dependency's own state; a finished one with no code of its own needs nothing from git. */
  state: string;
  /** Its branch, when it has commits of its own; null = it was never developed (or produced nothing). */
  branch: string | null;
  /** Its work is already in the default branch — nothing to build on top of. */
  merged: boolean;
};

export type BasePlan = {
  /** The dependency whose branch this task starts from; null = the default branch. */
  on: DependencyFacts | null;
  /** Dependencies whose work is not in that base — the task is developed without it. */
  missing: { dep: DependencyFacts; why: "not_developed" | "parallel" }[];
};

/**
 * `contains(a, b)` — a's branch already holds b's work (b's tip is an ancestor of a's).
 * A dependency with code that is not merged is a candidate; the base is the one
 * candidate that holds all the others (a chain stacks on its last link). Two
 * candidates that are not in one line cannot both be a base without merging them
 * — then the task starts from the default branch and names both as missing.
 */
export function chooseBase(deps: DependencyFacts[], contains: (a: DependencyFacts, b: DependencyFacts) => boolean): BasePlan {
  const candidates = deps.filter((d) => d.branch && !d.merged);
  const on = candidates.find((c) => candidates.every((o) => o === c || contains(c, o))) ?? null;
  const missing: BasePlan["missing"] = [];
  for (const d of deps) {
    if (d.merged) continue;
    if (!d.branch) {
      // Finished without code of its own (a decision, a setting): there is nothing to wait for.
      if (d.state !== "done") missing.push({ dep: d, why: "not_developed" });
      continue;
    }
    if (on && (d === on || contains(on, d))) continue;
    missing.push({ dep: d, why: "parallel" });
  }
  return { on, missing };
}

/** The dependencies as the prompt names them: `#3 (short intent)`. */
export const depLabel = (d: Pick<DependencyFacts, "seq" | "intent">) => `#${d.seq} (${d.intent.slice(0, 80)})`;
