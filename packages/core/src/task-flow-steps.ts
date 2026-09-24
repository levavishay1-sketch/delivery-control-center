/**
 * The steps a task went through, as its screen draws them: development (with
 * the build), checks, review — and a "dependency" step wherever a dependency's
 * work came into the task after the task had already started. Pure (no
 * database, no git), so it is tested on its own; `ai-assist.ts` gathers the runs.
 *
 * A dependency that is there before the first run leaves no step: the task
 * simply starts with it. One that arrives later is taken in by Rollback and a
 * run again (a person's action, never automatic), which rebuilds the task on
 * it — that rebuild is the dependency step — and whatever the task had already
 * been through after development (checks, review) is gone through again, as
 * steps of its own, so the history stays visible instead of being overwritten.
 */
import type { RunPhase } from "./task-status.ts";

export type FlowBase = { on: { seq: number; sha: string | null } | null; without: number[] };

export type FlowCycle = {
  state: "running" | "done" | "error" | "rolled_back";
  startedAt: string;
  /** What the run was built on and without; absent on a run from before that was recorded. */
  base?: FlowBase;
  /** Whether the run actually verified the build — false on a run from before the build check existed, or whose build check never ran. */
  buildVerified: boolean;
  buildFailed: boolean;
  /** The checks after the build — tests, regression, E2E. */
  checks: { ran: number; passed: number; failed: number; waiting: number };
  /** It was pushed, or the task was closed on it. */
  reviewed: boolean;
};

export type FlowNow = {
  running: RunPhase | null;
  closed: boolean;
  /** Dependencies whose work exists now and is not in the task yet — a rebuild on them is waiting. */
  pendingDeps: number[];
};

export type FlowStepKind = "develop" | "dependency" | "checks" | "review";
export type FlowStepState = "done" | "current" | "todo" | "failed" | "waiting";
export type FlowStep = {
  kind: FlowStepKind;
  state: FlowStepState;
  /** 1 for the first time through, 2 after the first dependency step, and so on. */
  round: number;
  /** A step of an earlier round — what happened then, no longer acted on. */
  past: boolean;
  /** Dependency steps: the tasks whose work came in. */
  deps?: number[];
  /** When the round started. */
  at?: string;
  /** One line on what happened in it. */
  note?: string;
};

const refs = (xs: number[]) => xs.map((s) => `#${s}`).join(", ");

/**
 * What the last cycle's own build/checks state should say, read live instead of
 * from that cycle's saved snapshot — "🔁 הרץ X שוב" reruns one check on its own
 * id, never touching the task's own run row, so the snapshot goes stale the
 * moment someone does exactly that. Call with the task's current active checks
 * (kind, result, cause) and overlay the result onto the last cycle before it
 * reaches `flowSteps`.
 */
export function liveCycleState(checks: { kind: string | null; result: string | null; cause: string | null }[]): Pick<FlowCycle, "buildVerified" | "buildFailed" | "checks"> {
  const build = checks.find((c) => c.kind === "build");
  const after = checks.filter((c) => c.kind !== "build" && c.result != null);
  return {
    buildVerified: !!build && build.result != null,
    buildFailed: build?.result === "failed",
    checks: {
      ran: after.length, passed: after.filter((c) => c.result === "passed").length,
      failed: after.filter((c) => c.result === "failed" && c.cause !== "dependency_missing").length,
      waiting: after.filter((c) => c.result === "waiting").length,
    },
  };
}

/** The dependencies whose work is in `next` and was not in `prev`: one it was built without, or a base that moved on. */
export function gainedDeps(prev: FlowBase, next: FlowBase): number[] {
  const out = new Set<number>();
  for (const s of prev.without) if (!next.without.includes(s)) out.add(s);
  const moved = prev.on && next.on && prev.on.seq === next.on.seq && prev.on.sha && next.on.sha && prev.on.sha !== next.on.sha;
  if (next.on && (!prev.on || prev.on.seq !== next.on.seq || moved)) out.add(next.on.seq);
  return [...out].sort((a, b) => a - b);
}

const baseNote = (b?: FlowBase) => {
  if (!b) return undefined;
  const parts = [b.on ? `נבנתה על גבי #${b.on.seq}` : "", b.without.length ? `בלי ${refs(b.without)}` : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
};
const checksNote = (c: FlowCycle["checks"]) =>
  `${c.passed}/${c.ran} עברו${c.failed ? `, ${c.failed} נכשלו` : ""}${c.waiting ? `, ${c.waiting} מחכות לתלות` : ""}`;

export function flowSteps(cycles: FlowCycle[], now: FlowNow): FlowStep[] {
  // Rounds: a run that took in a dependency the run before it did not have starts a new one.
  const rounds: { deps: number[]; cycles: FlowCycle[] }[] = [];
  let lastBase: FlowBase | undefined;
  for (const c of cycles) {
    const gained = lastBase && c.base ? gainedDeps(lastBase, c.base) : [];
    if (!rounds.length || gained.length) rounds.push({ deps: gained, cycles: [c] });
    else rounds.at(-1)!.cycles.push(c);
    if (c.base) lastBase = c.base;
  }
  const pending = now.running ? [] : now.pendingDeps;
  if (!rounds.length && !pending.length) rounds.push({ deps: [], cycles: [] });

  const steps: FlowStep[] = [];
  rounds.forEach((r, i) => {
    const round = i + 1;
    const at = r.cycles[0]?.startedAt;
    const first = i === 0;
    const live = i === rounds.length - 1 && !pending.length;
    const workKind: FlowStepKind = first ? "develop" : "dependency";
    const deps = first ? undefined : r.deps;

    if (!live) {
      const built = r.cycles.filter((c) => c.state === "done" || c.state === "rolled_back");
      const withChecks = built.filter((c) => c.checks.ran > 0);
      steps.push({ kind: workKind, state: built.length ? "done" : "failed", round, past: true, deps, at, note: baseNote(built.at(-1)?.base) });
      if (withChecks.length) steps.push({ kind: "checks", state: "done", round, past: true, at, note: checksNote(withChecks.at(-1)!.checks) });
      if (r.cycles.some((c) => c.reviewed)) steps.push({ kind: "review", state: "done", round, past: true, at });
      return;
    }

    const last = r.cycles.at(-1);
    const work: FlowStepState =
      now.running === "develop" || now.running === "build" ? "current"
      : now.running === "test" ? "done"
      : !last || last.state === "rolled_back" ? "current"
      : last.state === "error" || last.buildFailed ? "failed"
      // A run from before the build check existed, or whose build check never ran, has not
      // actually shown the build passes — "פיתוח (כולל Build)" stays open, not done, until it has.
      : !last.buildVerified ? "current"
      : "done";
    const checks: FlowStepState =
      now.running === "test" ? "current"
      : work !== "done" ? "todo"
      : !last || last.checks.ran === 0 ? "current"
      : last.checks.failed ? "failed"
      : last.checks.waiting ? "waiting"
      : "done";
    const review: FlowStepState = now.closed ? "done" : checks === "done" || checks === "waiting" ? "current" : "todo";
    steps.push({ kind: workKind, state: work, round, past: false, deps, at, note: baseNote(last?.base) });
    steps.push({ kind: "checks", state: checks, round, past: false, at, ...(last && last.checks.ran ? { note: checksNote(last.checks) } : {}) });
    steps.push({ kind: "review", state: review, round, past: false, at });
  });

  if (pending.length) {
    const round = rounds.length + 1;
    steps.push({ kind: "dependency", state: "current", round, past: false, deps: pending, note: `${refs(pending)} פותחה מאז — Rollback והרצה חוזרת יבנו את המשימה עליה` });
    steps.push({ kind: "checks", state: "todo", round, past: false });
    steps.push({ kind: "review", state: "todo", round, past: false });
  }
  return steps;
}
