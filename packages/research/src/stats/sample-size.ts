import { normalQuantile } from "./normal.ts";

/**
 * Sample-size formulas of section 8.5. Every input the protocol marks UNKNOWN
 * (delta, sigma_d, rho, m, cv, the cost effect) is a required argument: none
 * has a default. The functions return exact real numbers; rounding to whole
 * tasks or repositories is not done here, because the protocol does not say
 * at which step to round (see `roundUp`).
 *
 * The protocol itself calls these a first approximation: the final size is
 * set by simulation on the pilot's variance components, at joint power, and
 * with a true difference of -delta/4 as well as zero (8.5, U21). That
 * simulation is not here.
 */

/**
 * Section 8.2 conventions, quoted, not derived: one-sided alpha 0.025, power
 * 0.8, and 95% for the Clopper-Pearson bound of absolute gates. They may be
 * changed only before Freeze 2, which would be an amendment.
 */
export const PROTOCOL_CONVENTIONS = { alphaOneSided: 0.025, power: 0.8, absoluteGateConfidence: 0.95 } as const;

/**
 * HELPER. (z_alpha + z_beta)^2 with z_alpha = Phi^{-1}(1 - alpha) and
 * z_beta = Phi^{-1}(power), the usual reading of the protocol's notation.
 */
export function zFactor(alphaOneSided: number, power: number): number {
  if (!(alphaOneSided > 0 && alphaOneSided < 0.5)) throw new RangeError(`alpha must be in (0, 0.5), got ${alphaOneSided}`);
  if (!(power > 0.5 && power < 1)) throw new RangeError(`power must be in (0.5, 1), got ${power}`);
  return (normalQuantile(1 - alphaOneSided) + normalQuantile(power)) ** 2;
}

/**
 * PROTOCOL (8.5, success). n_tasks = (z_alpha + z_beta)^2 * sigma_d^2 / delta^2.
 *
 * Assumptions: d_i are independent with variance sigma_d^2 (clustering is
 * added afterwards by DEFF); their mean is approximately normal; the true
 * difference is 0, so the distance to the margin -delta is delta. With
 * sigma_d = 0 the formula gives 0: no uncertainty, which is degenerate
 * rather than a plan.
 */
export function tasksForSuccessNI(sigmaD: number, delta: number, alphaOneSided: number, power: number): number {
  if (!(sigmaD >= 0 && Number.isFinite(sigmaD))) throw new RangeError(`sigma_d must be a finite number >= 0, got ${sigmaD}`);
  if (!(delta > 0 && Number.isFinite(delta))) throw new RangeError(`delta must be > 0, got ${delta}`);
  return (zFactor(alphaOneSided, power) * sigmaD * sigmaD) / (delta * delta);
}

/**
 * PROTOCOL (8.5, cost), algebra only. n_pairs = ((z_alpha + z_beta) * sigma / effect)^2
 * with sigma the standard deviation of log-cost differences. `sigma` and
 * `effect` must be on the same scale. The protocol leaves open which scale
 * the effect is stated on, what a "pair" is, and how this relates to the
 * ratio-of-means estimator it names; those are reported as open points and
 * are not resolved here.
 */
export function pairsForLogCostNI(sigmaLogDiff: number, effectOnSameScale: number, alphaOneSided: number, power: number): number {
  if (!(sigmaLogDiff >= 0 && Number.isFinite(sigmaLogDiff))) throw new RangeError(`sigma must be a finite number >= 0, got ${sigmaLogDiff}`);
  if (!(effectOnSameScale > 0 && Number.isFinite(effectOnSameScale))) throw new RangeError(`effect must be > 0, got ${effectOnSameScale}`);
  return zFactor(alphaOneSided, power) * (sigmaLogDiff / effectOnSameScale) ** 2;
}

/**
 * PROTOCOL (8.5). DEFF = 1 + (m - 1) * rho, equal clusters of m tasks.
 * rho is the ICC of d_i within a repository. A negative rho would shrink the
 * sample below the unclustered size, which a planning figure must not do, so
 * it is refused: the protocol plans on the conservative bound (U9).
 */
export function designEffectEqual(m: number, rho: number): number {
  assertM(m);
  assertRho(rho);
  return 1 + (m - 1) * rho;
}

/**
 * PROTOCOL (8.5). DEFF = 1 + ((1 + cv^2) * m - 1) * rho, unequal clusters,
 * m the mean tasks per repository and cv the coefficient of variation of
 * cluster size. With cv taken over the population of clusters (see
 * `clusterSizeCv`) this equals 1 + (sum n_j^2 / sum n_j - 1) * rho exactly.
 */
export function designEffectUnequal(m: number, cv: number, rho: number): number {
  assertM(m);
  assertRho(rho);
  if (!(cv >= 0 && Number.isFinite(cv))) throw new RangeError(`cv must be a finite number >= 0, got ${cv}`);
  return 1 + ((1 + cv * cv) * m - 1) * rho;
}

/** PROTOCOL (8.5). N = n_tasks * DEFF / m. */
export function reposFromTasks(nTasks: number, deff: number, m: number): number {
  if (!(nTasks >= 0 && Number.isFinite(nTasks))) throw new RangeError(`n_tasks must be >= 0, got ${nTasks}`);
  if (!(deff >= 1 && Number.isFinite(deff))) throw new RangeError(`DEFF must be >= 1 here, got ${deff}`);
  assertM(m);
  return (nTasks * deff) / m;
}

/**
 * HELPER. The coefficient of variation of cluster sizes, with the standard
 * deviation over the clusters themselves (divide by k, not k - 1). This is
 * the reading under which the protocol's unequal-cluster DEFF equals the
 * exact sum n_j^2 / sum n_j form; with the k - 1 reading it does not.
 */
export function clusterSizeCv(sizes: readonly number[]): number {
  if (sizes.length === 0) throw new RangeError("clusterSizeCv: no clusters");
  for (const s of sizes) if (!(Number.isInteger(s) && s >= 1)) throw new RangeError(`cluster sizes must be integers >= 1, got ${s}`);
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  const variance = sizes.reduce((a, s) => a + (s - mean) ** 2, 0) / sizes.length;
  return Math.sqrt(variance) / mean;
}

/**
 * HELPER. The smallest integer not below x, with a guard against a
 * floating-point value a hair above an integer. Offered for the caller; the
 * protocol does not say whether to round n_tasks before converting to N.
 */
export function roundUp(x: number): number {
  if (!Number.isFinite(x) || x < 0) throw new RangeError(`roundUp: ${x}`);
  const r = Math.round(x);
  return Math.abs(x - r) < 1e-9 ? r : Math.ceil(x);
}

function assertM(m: number): void {
  if (!(m >= 1 && Number.isFinite(m))) throw new RangeError(`m (tasks per repository) must be >= 1, got ${m}`);
}

function assertRho(rho: number): void {
  if (!(rho >= 0 && rho <= 1)) throw new RangeError(`rho must be in [0, 1] for planning, got ${rho}`);
}
