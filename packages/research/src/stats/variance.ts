/**
 * The task-level difference of section 8.5 and helpers that estimate the
 * variance components it needs.
 *
 * Only `taskDifference` implements a protocol formula. The estimators below
 * are HELPERS: the protocol defines sigma_d^2 = Var(d_i) and rho = the ICC of
 * d_i within a repository (8.5), and says the pilot estimates them with a
 * confidence interval and plans on the conservative bound (U9), but it does
 * not name the estimator or the interval method. The one-way ANOVA estimator
 * here is the standard one and is kept separate so that the choice stays
 * visible until it is made; nothing in the package feeds it into a plan yet.
 */

/** The outcome of one run (10.1 for success; 3.2 for INCOMPLETE; 17.3 for INVALID). */
export type RunOutcome = "PASS" | "FAIL" | "INCOMPLETE" | "INVALID";

/**
 * PROTOCOL (8.5 with 3.2 and 17.3). d_i = (S_C,i - S_A,i) / r, the difference
 * of success rates over the r runs of each arm.
 *
 * Primary analysis only: INCOMPLETE counts as a failed run (3.2). INVALID
 * runs are re-run with the same seed (17.3), so an INVALID outcome here means
 * the record is not ready and d_i is not defined; so does a different number
 * of runs in the two arms, because the formula has one r. The sensitivity
 * analysis of 3.2, INCOMPLETE as missing, leaves the arms with different
 * denominators, for which the protocol gives no d_i; it is not implemented.
 */
export function taskDifference(armC: readonly RunOutcome[], armA: readonly RunOutcome[]): number {
  if (armC.length === 0 || armA.length === 0) throw new RangeError("taskDifference: an arm has no runs");
  if (armC.length !== armA.length) throw new RangeError(`taskDifference: the arms have ${armC.length} and ${armA.length} runs; the formula needs one r`);
  for (const o of [...armC, ...armA]) {
    if (o === "INVALID") throw new RangeError("taskDifference: an INVALID run was not replaced (17.3); d_i is not defined");
    if (o !== "PASS" && o !== "FAIL" && o !== "INCOMPLETE") throw new RangeError(`taskDifference: unknown outcome ${String(o)}`);
  }
  const r = armC.length;
  const s = (arm: readonly RunOutcome[]) => arm.filter((o) => o === "PASS").length;
  return (s(armC) - s(armA)) / r;
}

export type VarianceComponents = {
  clusters: number;
  units: number;
  /** n0 of the unequal-cluster ANOVA; equals the common size when clusters are equal. */
  n0: number | null;
  msBetween: number | null;
  msWithin: number | null;
  /** Between-repository component; may be negative (sampling), and is not truncated. */
  sigmaB2: number | null;
  /** Within-repository component. */
  sigmaW2: number | null;
  /** The marginal variance of d_i, sigmaB2 + sigmaW2. */
  sigmaD2: number | null;
  /** The ICC, sigmaB2 / (sigmaB2 + sigmaW2). */
  rho: number | null;
  /** Why a field is null, or a warning about a value. */
  notes: string[];
};

/**
 * HELPER. One-way random-effects ANOVA estimators of the variance components
 * of d_i, with repositories as clusters (8.1). Unequal cluster sizes use
 *   n0 = (N - sum n_j^2 / N) / (k - 1),
 *   sigmaB2 = (MSB - MSW) / n0,  sigmaW2 = MSW.
 * Assumptions: clusters independent; a random repository effect plus an
 * independent task effect; within-cluster variance equal across clusters.
 * The estimator is unbiased for the components; rho is a ratio of them and
 * is not. Missing values are refused, never skipped.
 */
export function varianceComponents(clusters: readonly (readonly number[])[]): VarianceComponents {
  const notes: string[] = [];
  if (clusters.length === 0) throw new RangeError("varianceComponents: no clusters");
  clusters.forEach((c, j) => {
    if (c.length === 0) throw new RangeError(`varianceComponents: cluster ${j} has no values`);
    c.forEach((y, i) => { if (!Number.isFinite(y)) throw new RangeError(`varianceComponents: cluster ${j} value ${i} is missing or not finite (${y})`); });
  });
  const k = clusters.length;
  const sizes = clusters.map((c) => c.length);
  const N = sizes.reduce((a, b) => a + b, 0);
  // Values are shifted by the first one before summing. Variances do not
  // change under a shift, and identical inputs become exact zeros, so a
  // rounding residue cannot pose as a positive variance (and a rho).
  const pivot = clusters[0]![0]!;
  const shifted = clusters.map((c) => c.map((y) => y - pivot));
  const means = shifted.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
  const grand = shifted.flat().reduce((a, b) => a + b, 0) / N;
  const ssb = shifted.reduce((s, c, j) => s + c.length * (means[j]! - grand) ** 2, 0);
  const ssw = shifted.reduce((s, c, j) => s + c.reduce((t, y) => t + (y - means[j]!) ** 2, 0), 0);

  const msBetween = k >= 2 ? ssb / (k - 1) : null;
  const msWithin = N > k ? ssw / (N - k) : null;
  const n0 = k >= 2 ? (N - sizes.reduce((a, s) => a + s * s, 0) / N) / (k - 1) : null;
  if (k < 2) notes.push("one cluster: the between-repository component cannot be estimated");
  if (N === k) notes.push("every cluster has one value: the within-repository component cannot be estimated");

  const sigmaW2 = msWithin;
  const sigmaB2 = msBetween !== null && msWithin !== null && n0 !== null && n0 > 0 ? (msBetween - msWithin) / n0 : null;
  if (sigmaB2 !== null && sigmaB2 < 0) notes.push("negative between-repository estimate (sampling); reported as is, not truncated");
  const sigmaD2 = sigmaB2 !== null && sigmaW2 !== null ? sigmaB2 + sigmaW2 : null;
  let rho: number | null = null;
  if (sigmaD2 !== null && sigmaB2 !== null) {
    if (sigmaD2 > 0) rho = sigmaB2 / sigmaD2;
    else notes.push("zero total variance: rho is undefined (0/0)");
  }
  return { clusters: k, units: N, n0, msBetween, msWithin, sigmaB2, sigmaW2, sigmaD2, rho, notes };
}

/**
 * HELPER. Unbiased estimate of Var(p_hat) = p(1 - p) / r for one task's
 * success rate from `successes` of `runs`: p_hat(1 - p_hat) / (r - 1).
 * The run-to-run noise that F5 measures (3.3). Undefined for one run.
 */
export function rateVarianceEstimate(successes: number, runs: number): number | null {
  if (!Number.isInteger(runs) || runs < 1) throw new RangeError(`runs must be an integer >= 1, got ${runs}`);
  if (!Number.isInteger(successes) || successes < 0 || successes > runs) throw new RangeError(`successes must be an integer in [0, runs], got ${successes}`);
  if (runs === 1) return null;
  const p = successes / runs;
  return (p * (1 - p)) / (runs - 1);
}
