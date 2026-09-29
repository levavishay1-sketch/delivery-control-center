/**
 * HELPER. A seeded pseudo-random source, so that every simulation in this
 * package is reproducible from its seed on any machine: xoshiro128** seeded
 * through splitmix32, in 32-bit integer arithmetic (Math.imul, >>> 0), which
 * JavaScript defines identically everywhere. Not for cryptography.
 *
 * Blackman, D. and Vigna, S. (2018). Scrambled linear pseudorandom number
 * generators. https://prng.di.unimi.it/
 */

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  private spare: number | null = null;

  constructor(seed: number) {
    if (!Number.isInteger(seed)) throw new RangeError(`Rng: the seed must be an integer, got ${seed}`);
    const sm = splitmix32(seed);
    this.s0 = sm(); this.s1 = sm(); this.s2 = sm(); this.s3 = sm();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** The next 32-bit unsigned integer. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform on [0, 1) with 53 bits. */
  uniform(): number {
    return (this.nextU32() * 2 ** 21 + (this.nextU32() >>> 11)) / 2 ** 53;
  }

  bernoulli(p: number): boolean {
    return this.uniform() < p;
  }

  /** Number of successes in n independent trials with probability p. */
  binomial(n: number, p: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) if (this.uniform() < p) s++;
    return s;
  }

  /** Standard normal, Box-Muller (polar form). */
  normal(): number {
    if (this.spare !== null) { const v = this.spare; this.spare = null; return v; }
    let u: number, v: number, q: number;
    do { u = 2 * this.uniform() - 1; v = 2 * this.uniform() - 1; q = u * u + v * v; } while (q >= 1 || q === 0);
    const f = Math.sqrt((-2 * Math.log(q)) / q);
    this.spare = v * f;
    return u * f;
  }

  /** An index drawn from non-negative weights. */
  pick(weights: readonly number[]): number {
    const total = weights.reduce((a, b) => a + b, 0);
    let u = this.uniform() * total;
    for (let i = 0; i < weights.length; i++) { u -= weights[i]!; if (u < 0) return i; }
    return weights.length - 1;
  }
}
