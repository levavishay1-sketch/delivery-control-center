import { normalCdf } from "./normal.ts";

/**
 * HELPER. Special functions for Student's t, needed because a repository-level
 * test with a small number of repositories must not use the normal quantile
 * (it would inflate the error rate). Log-gamma by the Lanczos approximation
 * (g = 7, 9 terms); the regularized incomplete beta by Lentz's continued
 * fraction (Numerical Recipes, section 6.4).
 */

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function logGamma(x: number): number {
  if (!(x > 0)) throw new RangeError(`logGamma: x must be > 0, got ${x}`);
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = LANCZOS[0]!;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i]! / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const TINY = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 1000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) return h;
  }
  throw new Error("betaContinuedFraction did not converge");
}

/** The regularized incomplete beta I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (!(a > 0 && b > 0)) throw new RangeError("incompleteBeta: a and b must be > 0");
  if (!(x >= 0 && x <= 1)) throw new RangeError(`incompleteBeta: x must be in [0, 1], got ${x}`);
  if (x === 0 || x === 1) return x;
  const lbt = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x);
  const bt = Math.exp(lbt);
  return x < (a + 1) / (a + b + 2) ? (bt * betaContinuedFraction(a, b, x)) / a : 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** P(T <= t) for Student's t with `df` degrees of freedom. */
export function studentTCdf(t: number, df: number): number {
  if (!(df > 0)) throw new RangeError(`studentTCdf: df must be > 0, got ${df}`);
  if (Number.isNaN(t)) throw new RangeError("studentTCdf: t is NaN");
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const tail = 0.5 * incompleteBeta(df / (df + t * t), df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/**
 * P(T > c) for a non-central t with `df` degrees of freedom and
 * non-centrality `ncp`: the exact power of a one-sided t test under
 * normality, as the integral over V ~ chi-square(df) of
 * P(Z > c sqrt(V / df) - ncp). V = w^2 keeps the integrand smooth; Simpson's
 * rule on `intervals` panels.
 */
export function nonCentralTUpperTail(c: number, df: number, ncp: number, intervals = 4000): number {
  if (!(df >= 1)) throw new RangeError(`df must be >= 1, got ${df}`);
  const wMax = Math.sqrt(df + 40 * Math.sqrt(2 * df) + 40);
  const logNorm = -((df / 2) * Math.log(2) + logGamma(df / 2));
  const f = (w: number): number => {
    if (w === 0) return df === 1 ? 2 * Math.exp(logNorm) * (1 - normalCdf(-ncp)) : 0;
    const v = w * w;
    return 2 * Math.exp(logNorm + (df - 1) * Math.log(w) - v / 2) * (1 - normalCdf(c * Math.sqrt(v / df) - ncp));
  };
  const n = intervals % 2 === 0 ? intervals : intervals + 1;
  const h = wMax / n;
  let sum = f(0) + f(wMax);
  for (let i = 1; i < n; i++) sum += (i % 2 === 1 ? 4 : 2) * f(i * h);
  return Math.min(1, Math.max(0, (sum * h) / 3));
}

/** The p-quantile of Student's t, by bisection on the CDF. */
export function studentTQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`studentTQuantile: p must be in (0, 1), got ${p}`);
  if (p === 0.5) return 0;
  if (p < 0.5) return -studentTQuantile(1 - p, df);
  let lo = 0, hi = 1;
  while (studentTCdf(hi, df) < p) hi *= 2;
  for (let i = 0; i < 200 && hi - lo > 1e-13 * hi; i++) {
    const mid = (lo + hi) / 2;
    if (studentTCdf(mid, df) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
