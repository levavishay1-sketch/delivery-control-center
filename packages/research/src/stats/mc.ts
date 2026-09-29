import { normalQuantile } from "./normal.ts";

/**
 * HELPER. How precise a Monte Carlo proportion is, so that every simulated
 * rate is reported with the uncertainty that comes from the number of
 * repetitions, and a comparison with an expected value is a z-score rather
 * than an eyeball.
 */

export type McProportion = { hits: number; reps: number; p: number; se: number; lo: number; hi: number };

/** The estimate, its standard error, and a Wilson score interval at `level` (two-sided). */
export function mcProportion(hits: number, reps: number, level = 0.95): McProportion {
  if (!Number.isInteger(reps) || reps < 1) throw new RangeError(`reps must be an integer >= 1, got ${reps}`);
  if (!Number.isInteger(hits) || hits < 0 || hits > reps) throw new RangeError(`hits must be an integer in [0, reps], got ${hits}`);
  const p = hits / reps;
  const z = normalQuantile(1 - (1 - level) / 2);
  const denom = 1 + (z * z) / reps;
  const centre = (p + (z * z) / (2 * reps)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / reps + (z * z) / (4 * reps * reps))) / denom;
  return { hits, reps, p, se: Math.sqrt((p * (1 - p)) / reps), lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/**
 * The z-score of an observed proportion against an expected probability,
 * with the standard error of the expected value (it stays defined when the
 * observed proportion is 0 or 1).
 */
export function zAgainst(expected: number, hits: number, reps: number): number {
  const se = Math.sqrt((expected * (1 - expected)) / reps);
  const obs = hits / reps;
  if (se === 0) return obs === expected ? 0 : Number.POSITIVE_INFINITY;
  return (obs - expected) / se;
}
