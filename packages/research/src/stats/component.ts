import { mcProportion, type McProportion } from "./mc.ts";
import { normalQuantile } from "./normal.ts";
import type { Rng } from "./rng.ts";
import { studentTQuantile } from "./special.ts";
import type { Mixture } from "./tripwire.ts";

/**
 * MDE-Component (sections 6.2 and 8.3.1): the smallest effect, in either
 * direction, that the ablation of one component detects at the set power.
 *
 * PROTOCOL: the component is measured against the set without it, on ground
 * truth tasks of one repository, with a confidence interval for the success
 * difference; epsilon may not be smaller than this MDE (6.2, U4).
 *
 * ASSUMPTIONS OF THIS CODE, not stated by the protocol:
 *  - the effect is additive on each task's success probability,
 *    p_with = clip(p_without + x), x > 0 helps and x < 0 harms;
 *  - "detected" means the one-sided interval excludes zero in the effect's
 *    direction (the MDE cannot be defined against epsilon, since epsilon is
 *    bounded by it);
 *  - the interval is a paired interval over tasks on d_i, by the normal
 *    quantile (`z`) or by Student's t (`t`). The protocol leaves the interval
 *    method open (open point) and its level to U38, so both methods and a
 *    grid of levels are offered, and neither is chosen.
 * Cost (kappa) is not simulated: it depends on open point 3 of step 2.
 */

export type IntervalMethod = "z" | "t";

export type AblationDesign = { mix: Mixture; tasks: number; runs: number; level: number; method: IntervalMethod };

const clip = (p: number) => Math.min(1, Math.max(0, p));

/** The mean true effect over the mixture after clipping, for a nominal shift x. */
export function realizedEffect(mix: Mixture, x: number): number {
  const total = mix.reduce((a, c) => a + c.w, 0);
  return mix.reduce((a, c) => a + (c.w / total) * (clip(c.p + x) - c.p), 0);
}

function quantile(design: AblationDesign): number {
  const { level, method, tasks } = design;
  if (!(level > 0.5 && level < 1)) throw new RangeError(`level must be in (0.5, 1), got ${level}`);
  if (tasks < 2) return 0; // unused: one task decides by the sign of its mean
  return method === "z" ? normalQuantile(level) : studentTQuantile(level, tasks - 1);
}

/**
 * One simulated ablation: returns +1 if a benefit is detected, -1 if a harm
 * is detected, 0 otherwise. With one task, or every d_i equal (s = 0), the
 * interval has zero width and the sign of the mean decides; this is the
 * degenerate behaviour of the paired interval and is reported, not patched.
 */
export function ablationOnce(rng: Rng, design: AblationDesign, x: number, q: number): -1 | 0 | 1 {
  const { mix, tasks, runs } = design;
  const w = mix.map((c) => c.w);
  let sum = 0, sumSq = 0;
  for (let i = 0; i < tasks; i++) {
    const p0 = mix[rng.pick(w)]!.p;
    const p1 = clip(p0 + x);
    const d = (rng.binomial(runs, p1) - rng.binomial(runs, p0)) / runs;
    sum += d; sumSq += d * d;
  }
  const mean = sum / tasks;
  if (tasks < 2) return mean > 0 ? 1 : mean < 0 ? -1 : 0;
  const variance = Math.max(0, (sumSq - tasks * mean * mean) / (tasks - 1));
  const half = q * Math.sqrt(variance / tasks);
  if (mean - half > 0) return 1;
  if (mean + half < 0) return -1;
  return 0;
}

export type DetectionPoint = { x: number; realized: number; detect: McProportion; wrongDirection: McProportion };

/** Detection probability in the direction of x (and in the wrong direction), over `reps` ablations. */
export function detection(rng: Rng, design: AblationDesign, x: number, reps: number): DetectionPoint {
  const q = quantile(design);
  const want = x >= 0 ? 1 : -1;
  let hit = 0, wrong = 0;
  for (let k = 0; k < reps; k++) {
    const r = ablationOnce(rng, design, x, q);
    if (r === want) hit++; else if (r === -want) wrong++;
  }
  return { x, realized: realizedEffect(design.mix, x), detect: mcProportion(hit, reps), wrongDirection: mcProportion(wrong, reps) };
}

export type MdeResult = {
  /** Smallest |x| on the grid whose detection reaches the power; null if none does (UNKNOWN). */
  mde: number | null;
  realized: number | null;
  /** True when the Monte Carlo interval at the reported point, or at the grid point before it, contains the power. */
  uncertain: boolean;
  curve: DetectionPoint[];
};

/** MDE on a grid of |x| values in one direction (`sign` +1 benefit, -1 harm). */
export function mdeComponent(rng: Rng, design: AblationDesign, grid: readonly number[], sign: 1 | -1, power: number, reps: number): MdeResult {
  const curve = grid.map((g) => detection(rng, design, sign * g, reps));
  const idx = curve.findIndex((c) => c.detect.p >= power);
  if (idx < 0) return { mde: null, realized: null, uncertain: curve.some((c) => c.detect.hi >= power), curve };
  const at = curve[idx]!;
  const before = idx > 0 ? curve[idx - 1]! : null;
  const uncertain = at.detect.lo < power || (before !== null && before.detect.hi >= power);
  return { mde: Math.abs(at.x), realized: Math.abs(at.realized), uncertain, curve };
}

/**
 * HELPER, verification only. The exact probability that the ablation rule
 * above detects a benefit (`plus`) or a harm (`minus`), by enumerating every
 * multiset of task differences instead of sampling. It applies the same
 * decision (including the zero-width case) to exact probabilities, so it
 * checks the Monte Carlo and shows what the discreteness of d_i does to the
 * error rate. Feasible for small tasks x runs only.
 */
export function exactDetectionProbability(mix: Mixture, tasks: number, runs: number, x: number, q: number): { plus: number; minus: number } {
  const total = mix.reduce((a, c) => a + c.w, 0);
  const pmf = (n: number, p: number) => {
    const out: number[] = [];
    let c = 1;
    for (let k = 0; k <= n; k++) { if (k > 0) c = (c * (n - k + 1)) / k; out.push(c * p ** k * (1 - p) ** (n - k)); }
    return out;
  };
  // Distribution of S_with - S_without over k = -runs..runs, averaged over the mixture.
  const dist = new Array<number>(2 * runs + 1).fill(0);
  for (const c of mix) {
    const a = pmf(runs, clip(c.p + x)), b = pmf(runs, c.p);
    for (let s1 = 0; s1 <= runs; s1++) for (let s0 = 0; s0 <= runs; s0++) dist[s1 - s0 + runs]! += (c.w / total) * a[s1]! * b[s0]!;
  }
  const logFact = [0];
  for (let i = 1; i <= tasks; i++) logFact.push(logFact[i - 1]! + Math.log(i));
  let plus = 0, minus = 0;
  const counts = new Array<number>(dist.length).fill(0);
  const visit = (idx: number, left: number) => {
    if (idx === dist.length - 1) {
      counts[idx] = left;
      let logP = logFact[tasks]!, sum = 0, sumSq = 0, possible = true;
      for (let v = 0; v < dist.length; v++) {
        const n = counts[v]!;
        if (n === 0) continue;
        if (dist[v] === 0) { possible = false; break; }
        logP += n * Math.log(dist[v]!) - logFact[n]!;
        const d = (v - runs) / runs;
        sum += n * d; sumSq += n * d * d;
      }
      if (!possible) return;
      const prob = Math.exp(logP);
      const mean = sum / tasks;
      let verdict: -1 | 0 | 1;
      if (tasks < 2) verdict = mean > 0 ? 1 : mean < 0 ? -1 : 0;
      else {
        const half = q * Math.sqrt(Math.max(0, (sumSq - tasks * mean * mean) / (tasks - 1)) / tasks);
        verdict = mean - half > 0 ? 1 : mean + half < 0 ? -1 : 0;
      }
      if (verdict === 1) plus += prob; else if (verdict === -1) minus += prob;
      return;
    }
    for (let n = 0; n <= left; n++) { counts[idx] = n; visit(idx + 1, left - n); }
  };
  visit(0, tasks);
  return { plus, minus };
}
