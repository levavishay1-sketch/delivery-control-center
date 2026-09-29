/**
 * HELPER — not a protocol formula. The standard normal distribution, needed
 * for the z quantiles of section 8.5.
 *
 * Phi uses Marsaglia's series, Phi(x) = 1/2 + phi(x) * (x + x^3/3 + x^5/15 + ...),
 * whose terms are all of one sign, so it has no cancellation; its accuracy is
 * absolute (about 1e-15), which is ample for probabilities used in sample
 * sizes and poor only far in the tails (|x| > 8), where this package has no
 * use for it. The quantile inverts Phi by Newton's method.
 *
 * Marsaglia, G. (2004). Evaluating the normal distribution. Journal of
 * Statistical Software 11(4).
 */

const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

export const normalPdf = (x: number): number => INV_SQRT_2PI * Math.exp(-0.5 * x * x);

export function normalCdf(x: number): number {
  if (!Number.isFinite(x)) {
    if (Number.isNaN(x)) throw new RangeError("normalCdf: x is NaN");
    return x > 0 ? 1 : 0;
  }
  if (x < -37) return 0;
  if (x > 37) return 1;
  let sum = x;
  let term = x;
  const x2 = x * x;
  for (let i = 3; i < 2000; i += 2) {
    term *= x2 / i;
    const next = sum + term;
    if (next === sum) break;
    sum = next;
  }
  return Math.min(1, Math.max(0, 0.5 + normalPdf(x) * sum));
}

/** Phi^{-1}(p) for 0 < p < 1. */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`normalQuantile: p must be in (0, 1), got ${p}`);
  if (p === 0.5) return 0;
  // Starting point: Tukey's lambda approximation, then Newton.
  let x = 4.91 * (p ** 0.14 - (1 - p) ** 0.14);
  for (let i = 0; i < 100; i++) {
    const step = (normalCdf(x) - p) / normalPdf(x);
    x -= step;
    if (Math.abs(step) < 1e-15 * Math.max(1, Math.abs(x))) break;
  }
  return x;
}
