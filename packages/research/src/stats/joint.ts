import { binomialCdf, clopperPearsonUpper } from "./binomial.ts";
import { normalCdf, normalQuantile } from "./normal.ts";
import type { Rng } from "./rng.ts";
import { nonCentralTUpperTail, studentTQuantile } from "./special.ts";
import type { Mixture } from "./tripwire.ts";

/**
 * Joint power (section 8.6): the probability that a process which is truly
 * not inferior passes all NR and G gates together, which is lower than the
 * power of each gate alone. The protocol sets 0.8 as the joint target and
 * asks for it by simulation, at a true difference of zero and of -delta/4
 * (8.5, 8.6).
 *
 * PROTOCOL: the gates are the process-level NR gates (success, cost and
 * context, against A and against B) and the G gates (C1, C2), each judged by
 * its own rule: NR by the one-sided interval against the margin (8.3.2), G by
 * the Clopper-Pearson bound against fc_max (8.2, 8.5).
 *
 * ASSUMPTIONS OF THIS CODE:
 *  - the NR analysis is a test on repository-level means of d_i with Student's
 *    t on N - 1 degrees of freedom. The protocol leaves the method to U21;
 *    this is one valid candidate for clustered data, used only to exercise
 *    the rules;
 *  - arm C's effect on a task is additive, p_C = clip(p_A + delta_true + u_j + e_ij)
 *    with a repository effect u_j ~ N(0, tauB^2) and a task effect
 *    e_ij ~ N(0, tauW^2); arm B's is p_B = clip(p_A + deltaB);
 *  - G gates and NR gates fail independently, so their joint pass
 *    probability is the product;
 *  - cost gates are left out, because their formula is open point 3 of
 *    step 2; the context gate is a deterministic count with no sampling
 *    error, so it adds no loss of power and is left out as well.
 */

/**
 * PROTOCOL (8.2, 8.5), exact. The probability that a G gate passes when the
 * true failure rate is `trueRate`: the gate passes with x failures in n
 * units when the Clopper-Pearson upper bound of x/n is at most fc_max.
 */
export function gatePassProbability(n: number, fcMax: number, trueRate: number, conf: number): { pass: number; maxFailures: number } {
  if (!(fcMax > 0 && fcMax < 1)) throw new RangeError(`fc_max must be in (0, 1), got ${fcMax}`);
  if (!(trueRate >= 0 && trueRate <= 1)) throw new RangeError(`the true rate must be in [0, 1], got ${trueRate}`);
  let maxFailures = -1;
  for (let x = 0; x <= n; x++) {
    if (clopperPearsonUpper(x, n, conf) <= fcMax) maxFailures = x; else break;
  }
  return { pass: maxFailures < 0 ? 0 : binomialCdf(maxFailures, n, trueRate), maxFailures };
}

export type NrDesign = {
  repos: number;
  tasks: number;
  runs: number;
  mix: Mixture;
  /** Nominal true additive effect of C against A. */
  deltaTrue: number;
  tauB: number;
  tauW: number;
  /** True additive effect of B against A; 0 means B behaves as A. */
  deltaB: number;
  margin: number;
  alphaOneSided: number;
};

export type NrVerdict = "PASS" | "FAIL" | "INCONCLUSIVE";

const clip = (p: number) => Math.min(1, Math.max(0, p));

/** PROTOCOL (8.3.2): PASS when the lower one-sided bound is above -margin, FAIL when the upper one is below it. */
export function nrVerdict(repoMeans: readonly number[], margin: number, alphaOneSided: number): NrVerdict {
  const n = repoMeans.length;
  if (n < 2) return "INCONCLUSIVE";
  const mean = repoMeans.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(repoMeans.reduce((a, y) => a + (y - mean) ** 2, 0) / (n - 1));
  const half = studentTQuantile(1 - alphaOneSided, n - 1) * (sd / Math.sqrt(n));
  if (mean - half > -margin) return "PASS";
  if (mean + half < -margin) return "FAIL";
  return "INCONCLUSIVE";
}

export type NrSimulation = {
  reps: number;
  vsA: Record<NrVerdict, number>;
  vsB: Record<NrVerdict, number>;
  bothPass: number;
  /** Mean over repetitions of the population-average true p_C - p_A of the sampled tasks. */
  realizedDelta: number;
  /** Share of task probabilities that the clip changed. */
  clipRate: number;
};

export function simulateNr(rng: Rng, d: NrDesign, reps: number): NrSimulation {
  const w = d.mix.map((c) => c.w);
  const vsA: Record<NrVerdict, number> = { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 };
  const vsB: Record<NrVerdict, number> = { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 };
  let bothPass = 0, realizedSum = 0, clipped = 0, draws = 0;
  for (let k = 0; k < reps; k++) {
    const meansA: number[] = [], meansB: number[] = [];
    let trueSum = 0;
    for (let j = 0; j < d.repos; j++) {
      const u = d.tauB * rng.normal();
      let sA = 0, sB = 0;
      for (let i = 0; i < d.tasks; i++) {
        const pA = d.mix[rng.pick(w)]!.p;
        const rawC = pA + d.deltaTrue + u + d.tauW * rng.normal();
        const pC = clip(rawC);
        const rawB = pA + d.deltaB;
        const pB = clip(rawB);
        if (pC !== rawC) clipped++;
        if (pB !== rawB) clipped++;
        draws += 2;
        trueSum += pC - pA;
        const cS = rng.binomial(d.runs, pC);
        sA += (cS - rng.binomial(d.runs, pA)) / d.runs;
        sB += (cS - rng.binomial(d.runs, pB)) / d.runs;
      }
      meansA.push(sA / d.tasks);
      meansB.push(sB / d.tasks);
    }
    realizedSum += trueSum / (d.repos * d.tasks);
    const a = nrVerdict(meansA, d.margin, d.alphaOneSided);
    const b = nrVerdict(meansB, d.margin, d.alphaOneSided);
    vsA[a]++; vsB[b]++;
    if (a === "PASS" && b === "PASS") bothPass++;
  }
  return { reps, vsA, vsB, bothPass, realizedDelta: realizedSum / reps, clipRate: clipped / draws };
}

/**
 * HELPER. Power predicted by the normal approximation behind the 8.5 formula,
 * P(PASS) = Phi((delta_true + margin) / SE - z_{1-alpha}) with
 * SE = sqrt(sigma_d^2 * DEFF / (N * m)). The simulation is compared with it.
 */
export function predictedPower(sigmaD2: number, deff: number, repos: number, tasks: number, deltaTrue: number, margin: number, alphaOneSided: number): number {
  const se = Math.sqrt((sigmaD2 * deff) / (repos * tasks));
  return normalCdf((deltaTrue + margin) / se - normalQuantile(1 - alphaOneSided));
}

/**
 * HELPER. The exact power of the repository-level t test under normality:
 * the non-central t upper tail at the t critical value on N - 1 degrees of
 * freedom, with non-centrality (delta_true + margin) / SE. It differs from
 * the simulation only through the binary, discrete data and through the
 * sigma_d^2 and rho it is given.
 */
export function predictedPowerT(sigmaD2: number, deff: number, repos: number, tasks: number, deltaTrue: number, margin: number, alphaOneSided: number): number {
  if (repos < 2) return 0;
  const se = Math.sqrt((sigmaD2 * deff) / (repos * tasks));
  return nonCentralTUpperTail(studentTQuantile(1 - alphaOneSided, repos - 1), repos - 1, (deltaTrue + margin) / se);
}
