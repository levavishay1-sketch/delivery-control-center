/**
 * Bounds on a failure rate from a count of failures (sections 7.3, 7.8, 8.2, 8.5).
 *
 * PROTOCOL (8.2): an absolute gate is judged by the one-sided Clopper-Pearson
 * upper bound at the confidence the protocol fixes as a convention (95%).
 * PROTOCOL (8.5): with zero failures that bound is 1 - (1 - conf)^(1/n), and
 * the number of repositories that brings it to fc_max is
 * N = ceil( ln(1 - conf) / ln(1 - fc_max) ).
 *
 * Mathematical assumptions, stated by the protocol itself (8.5): the n units
 * are a random, independent sample, and the audit that counts failures does
 * not miss any. The bound says nothing about units outside the sampled
 * population.
 */

/**
 * HELPER. P(X <= x) for X ~ Binomial(n, p), summed in log space so that no
 * term underflows before it is combined (large n, p near 0 or 1).
 */
export function binomialCdf(x: number, n: number, p: number): number {
  assertCount(x, n);
  if (!(p >= 0 && p <= 1)) throw new RangeError(`binomialCdf: p must be in [0, 1], got ${p}`);
  if (x >= n) return 1;
  if (p === 0) return 1;
  if (p === 1) return 0;
  const lp = Math.log(p);
  const lq = Math.log1p(-p);
  let logC = 0; // log C(n, 0)
  const logs: number[] = [];
  for (let i = 0; i <= x; i++) {
    if (i > 0) logC += Math.log(n - i + 1) - Math.log(i);
    logs.push(logC + i * lp + (n - i) * lq);
  }
  const max = Math.max(...logs);
  const sum = logs.reduce((s, l) => s + Math.exp(l - max), 0);
  return Math.min(1, Math.exp(max) * sum);
}

/**
 * PROTOCOL (8.2). One-sided Clopper-Pearson upper bound on the failure rate
 * after `failures` failures in `n` units: the p at which P(X <= failures) = 1 - conf.
 * With n = 0 there is no evidence and the bound is 1.
 */
export function clopperPearsonUpper(failures: number, n: number, conf: number): number {
  assertCount(failures, n);
  assertConf(conf);
  if (n === 0 || failures === n) return 1;
  if (failures === 0) return zeroFailureUpperBound(n, conf);
  const target = 1 - conf;
  let lo = failures / n;
  let hi = 1;
  for (let i = 0; i < 200 && hi - lo > 1e-15; i++) {
    const mid = (lo + hi) / 2;
    if (binomialCdf(failures, n, mid) > target) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** PROTOCOL (8.5). The zero-failure bound 1 - (1 - conf)^(1/n). */
export function zeroFailureUpperBound(n: number, conf: number): number {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`zeroFailureUpperBound: n must be a non-negative integer, got ${n}`);
  assertConf(conf);
  if (n === 0) return 1;
  return -Math.expm1(Math.log1p(-conf) / n);
}

/**
 * PROTOCOL (8.5). N = ceil( ln(1 - conf) / ln(1 - fc_max) ): the smallest
 * number of units with zero failures whose bound does not exceed fc_max.
 * The quotient is computed, then confirmed against the bound itself so that
 * a floating-point quotient sitting just above an integer cannot add a unit.
 */
export function zeroFailureUnits(fcMax: number, conf: number): number {
  if (!(fcMax > 0 && fcMax < 1)) throw new RangeError(`zeroFailureUnits: fc_max must be in (0, 1), got ${fcMax}`);
  assertConf(conf);
  let n = Math.ceil(Math.log1p(-conf) / Math.log1p(-fcMax));
  while (n > 1 && zeroFailureUpperBound(n - 1, conf) <= fcMax) n--;
  while (zeroFailureUpperBound(n, conf) > fcMax) n++;
  return n;
}

function assertCount(x: number, n: number): void {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`n must be a non-negative integer, got ${n}`);
  if (!Number.isInteger(x) || x < 0 || x > n) throw new RangeError(`the count must be an integer in [0, n], got ${x} of ${n}`);
}

function assertConf(conf: number): void {
  if (!(conf > 0 && conf < 1)) throw new RangeError(`confidence must be in (0, 1), got ${conf}`);
}
