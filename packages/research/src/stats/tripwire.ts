import type { Rng } from "./rng.ts";

/**
 * The repository-level tripwire of section 8.3.2 and MDR-Repo of 8.3.1.
 *
 * PROTOCOL (8.3.2): a task trips when it fails in all r runs of arm C and
 * passes in all r runs of arm A. A tripwire that fires prevents Verified.
 * Reading used here: the repository's tripwire fires when at least one task
 * of its set trips (the rule is stated per task; a single tripped task is
 * what the section says prevents Verified).
 *
 * PROTOCOL (8.3.1): MDR-Repo is the smallest uniform drop in a task's success
 * probability that this decision rule detects at the set power; the full
 * detection curve and the rate of firing when there is no difference are
 * reported; if no drop reaches the power, MDR-Repo is UNKNOWN.
 *
 * NOT DEFINED BY THE PROTOCOL, so both are offered and neither is chosen:
 *  - the drop model: `additive` (p_C = max(0, p_A - x)) or `relative`
 *    (p_C = p_A (1 - x));
 *  - whether MDR-Repo is computed on the repository's own task set
 *    (`fireProbabilityForSet`) or on the pilot's distribution of tasks
 *    (`fireProbabilityForMixture`). The second is the average of the first
 *    over sets drawn from the distribution, not the value for any one set.
 *
 * Assumption of every function here: runs are independent Bernoulli trials,
 * every run completes (no INCOMPLETE or INVALID), and r is the same in both
 * arms. The tripwire under the sensitivity analysis of 3.2 is not defined
 * (open point 1 of step 2).
 */

export type DropModel = "additive" | "relative";

/** A distribution of baseline success probabilities: tasks drawn independently with these weights. */
export type Mixture = readonly { p: number; w: number }[];

export function dropped(pA: number, x: number, model: DropModel): number {
  if (!(pA >= 0 && pA <= 1)) throw new RangeError(`p_A must be in [0, 1], got ${pA}`);
  if (!(x >= 0 && x <= 1)) throw new RangeError(`the drop must be in [0, 1], got ${x}`);
  return model === "additive" ? Math.max(0, pA - x) : pA * (1 - x);
}

/** PROTOCOL (8.3.2), one task: P(all r runs fail in C and all r pass in A) = (1 - p_C)^r * p_A^r. */
export function taskTripProbability(pA: number, pC: number, r: number): number {
  if (!Number.isInteger(r) || r < 1) throw new RangeError(`r must be an integer >= 1, got ${r}`);
  return (1 - pC) ** r * pA ** r;
}

/** The repository's own task set: 1 - prod(1 - q_i). */
export function fireProbabilityForSet(pAs: readonly number[], x: number, r: number, model: DropModel): number {
  if (pAs.length === 0) throw new RangeError("fireProbabilityForSet: a repository with no runnable task has no tripwire");
  let none = 1;
  for (const p of pAs) none *= 1 - taskTripProbability(p, dropped(p, x, model), r);
  return 1 - none;
}

/** m tasks drawn independently from a distribution: 1 - (1 - E[q])^m. */
export function fireProbabilityForMixture(mix: Mixture, m: number, x: number, r: number, model: DropModel): number {
  if (!Number.isInteger(m) || m < 1) throw new RangeError(`m must be an integer >= 1, got ${m}`);
  const total = mix.reduce((a, c) => a + c.w, 0);
  if (!(total > 0)) throw new RangeError("the mixture has no weight");
  const eq = mix.reduce((a, c) => a + (c.w / total) * taskTripProbability(c.p, dropped(c.p, x, model), r), 0);
  return 1 - (1 - eq) ** m;
}

export type MdrResult =
  | { status: "reached"; x: number; fireAtZero: number }
  | { status: "unreachable"; x: null; fireAtZero: number }
  | { status: "fires-without-drop"; x: null; fireAtZero: number };

/**
 * MDR-Repo for a fire-probability curve that rises with the drop: the
 * smallest x in [0, xMax] with P(fire | x) >= power, by bisection to `tol`.
 *  - `unreachable`: even xMax does not reach the power; MDR-Repo is UNKNOWN (8.3.1).
 *  - `fires-without-drop`: the rule already fires at least as often as the
 *    power with no drop at all. The literal "smallest drop" would be 0, but
 *    that is false firing, not detection, so no value is returned. Under the
 *    protocol such a tripwire is not usable once U35 is set below the power.
 */
export function mdrRepo(fire: (x: number) => number, power: number, xMax = 1, tol = 1e-6): MdrResult {
  if (!(power > 0 && power < 1)) throw new RangeError(`power must be in (0, 1), got ${power}`);
  const fireAtZero = fire(0);
  if (fireAtZero >= power) return { status: "fires-without-drop", x: null, fireAtZero };
  if (fire(xMax) < power) return { status: "unreachable", x: null, fireAtZero };
  let lo = 0, hi = xMax;
  while (hi - lo > tol) {
    const mid = (lo + hi) / 2;
    if (fire(mid) >= power) hi = mid; else lo = mid;
  }
  return { status: "reached", x: hi, fireAtZero };
}

/**
 * HELPER. The mean absolute drop in success probability over a mixture for a
 * drop x under each model, so that the two models can be compared on one
 * scale: additive E[min(p, x)], relative x * E[p]. With a single baseline p
 * the two models give the same p_C and differ only in units.
 */
export function meanAbsoluteDrop(mix: Mixture, x: number, model: DropModel): number {
  const total = mix.reduce((a, c) => a + c.w, 0);
  return mix.reduce((a, c) => a + (c.w / total) * (c.p - dropped(c.p, x, model)), 0);
}

/**
 * Monte Carlo check of the closed forms above: draws every run of every
 * task in both arms and applies the rule to the outcomes themselves, so it
 * shares no formula with them. Returns how many of `reps` repositories fired.
 */
export function simulateFires(rng: Rng, pAs: readonly number[], x: number, r: number, model: DropModel, reps: number): number {
  let fired = 0;
  for (let k = 0; k < reps; k++) {
    let any = false;
    for (const pA of pAs) {
      const pC = dropped(pA, x, model);
      if (rng.binomial(r, pC) === 0 && rng.binomial(r, pA) === r) { any = true; }
    }
    if (any) fired++;
  }
  return fired;
}

/** Draws m baseline probabilities from a mixture. */
export function drawTasks(rng: Rng, mix: Mixture, m: number): number[] {
  const w = mix.map((c) => c.w);
  return Array.from({ length: m }, () => mix[rng.pick(w)]!.p);
}
