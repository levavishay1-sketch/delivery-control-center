import { describe, expect, it } from "vitest";
import { binomialCdf, clopperPearsonUpper, zeroFailureUnits, zeroFailureUpperBound } from "./binomial.ts";
import { normalCdf, normalQuantile } from "./normal.ts";
import {
  clusterSizeCv, designEffectEqual, designEffectUnequal, pairsForLogCostNI, PROTOCOL_CONVENTIONS,
  reposFromTasks, roundUp, tasksForSuccessNI, zFactor,
} from "./sample-size.ts";
import { rateVarianceEstimate, taskDifference, varianceComponents, type RunOutcome } from "./variance.ts";

/**
 * Reference values come from outside the code under test: published normal
 * quantiles, hand algebra, and an exact rational (BigInt) binomial bisection
 * run separately. Each is quoted with where it came from.
 */

const { alphaOneSided: ALPHA, power: POWER, absoluteGateConfidence: CONF } = PROTOCOL_CONVENTIONS;

describe("normal distribution (helper)", () => {
  it("matches published quantiles to 1e-9", () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963984540054, 9);
    expect(normalQuantile(0.8)).toBeCloseTo(0.8416212335729143, 9);
    expect(normalQuantile(0.95)).toBeCloseTo(1.6448536269514722, 9);
    expect(normalQuantile(0.9)).toBeCloseTo(1.2815515655446004, 9);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021048517795, 12);
  });
  it("is symmetric, exact at the centre, and refuses p outside (0, 1)", () => {
    expect(normalQuantile(0.5)).toBe(0);
    expect(normalQuantile(0.025)).toBeCloseTo(-normalQuantile(0.975), 12);
    expect(normalCdf(0)).toBe(0.5);
    for (const p of [0, 1, -0.1, 1.1, Number.NaN]) expect(() => normalQuantile(p)).toThrow(RangeError);
    expect(normalCdf(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalCdf(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("failure-rate bounds (protocol 8.2, 8.5)", () => {
  it("reproduces the protocol's zero-failure table, rounded up to one decimal", () => {
    const table: [number, number][] = [[5, 45.1], [10, 25.9], [14, 19.3], [29, 9.9], [59, 5.0]];
    for (const [n, pct] of table) expect(Math.ceil(zeroFailureUpperBound(n, CONF) * 1000) / 10).toBe(pct);
  });

  it("matches an exact rational bisection (BigInt, 1e-12 grid), computed independently", () => {
    const ref: [number, number, number][] = [
      [0, 5, 0.4507197283], [0, 10, 0.2588655509], [1, 10, 0.3941633024], [2, 20, 0.2826185249], [3, 59, 0.1262065567],
    ];
    for (const [x, n, ub] of ref) expect(clopperPearsonUpper(x, n, CONF)).toBeCloseTo(ub, 9);
  });

  it("hand cases: one unit, and one failure in two units (1 - p^2 = 0.05)", () => {
    expect(clopperPearsonUpper(0, 1, CONF)).toBeCloseTo(0.95, 12);
    expect(clopperPearsonUpper(1, 2, CONF)).toBeCloseTo(Math.sqrt(0.95), 12);
  });

  it("edges: no units gives 1, all failed gives 1, and a failure only raises the bound", () => {
    expect(clopperPearsonUpper(0, 0, CONF)).toBe(1);
    expect(zeroFailureUpperBound(0, CONF)).toBe(1);
    expect(clopperPearsonUpper(7, 7, CONF)).toBe(1);
    for (const n of [5, 20, 60]) expect(clopperPearsonUpper(1, n, CONF)).toBeGreaterThan(clopperPearsonUpper(0, n, CONF));
  });

  it("the bound is the p at which P(X <= x) equals 1 - conf", () => {
    for (const [x, n] of [[1, 10], [4, 30], [10, 200]] as const) expect(binomialCdf(x, n, clopperPearsonUpper(x, n, CONF))).toBeCloseTo(1 - CONF, 9);
  });

  it("the binomial CDF survives large n near p = 1 without underflow", () => {
    expect(binomialCdf(999, 1000, 0.999)).toBeCloseTo(1 - 0.999 ** 1000, 12);
    expect(binomialCdf(0, 3, 0.5)).toBeCloseTo(0.125, 15);
    expect(binomialCdf(3, 3, 0.2)).toBe(1);
  });

  it("N for fc_max: the smallest n whose zero-failure bound does not exceed it, also at an exact boundary", () => {
    expect(zeroFailureUnits(0.05, CONF)).toBe(59);
    expect(zeroFailureUnits(0.1, CONF)).toBe(29);
    const atBoundary = zeroFailureUpperBound(59, CONF);
    expect(zeroFailureUnits(atBoundary, CONF)).toBe(59);
    for (const fc of [0.01, 0.05, 0.2, 0.5]) {
      const n = zeroFailureUnits(fc, CONF);
      expect(zeroFailureUpperBound(n, CONF)).toBeLessThanOrEqual(fc);
      if (n > 1) expect(zeroFailureUpperBound(n - 1, CONF)).toBeGreaterThan(fc);
    }
  });

  it("refuses counts and rates outside their range", () => {
    expect(() => clopperPearsonUpper(3, 2, CONF)).toThrow(RangeError);
    expect(() => clopperPearsonUpper(-1, 2, CONF)).toThrow(RangeError);
    expect(() => clopperPearsonUpper(1, 2.5, CONF)).toThrow(RangeError);
    expect(() => clopperPearsonUpper(0, 2, 1)).toThrow(RangeError);
    expect(() => zeroFailureUnits(0, CONF)).toThrow(RangeError);
    expect(() => zeroFailureUnits(1, CONF)).toThrow(RangeError);
  });
});

describe("sample size for task success and cost (protocol 8.5)", () => {
  // Hand: z = 1.959964 + 0.841621 = 2.801585; squared 7.848880.
  it("(z_alpha + z_beta)^2 at the 8.2 conventions", () => {
    expect(zFactor(ALPHA, POWER)).toBeCloseTo(7.848879734, 8);
  });

  it("n_tasks = K sigma_d^2 / delta^2, by hand", () => {
    expect(tasksForSuccessNI(0.3, 0.05, ALPHA, POWER)).toBeCloseTo(282.5596704, 6); // 7.848880 * 0.09 / 0.0025
    expect(tasksForSuccessNI(0.5, 0.1, ALPHA, POWER)).toBeCloseTo(196.2219934, 6); // 7.848880 * 25
  });

  it("zero variance gives zero tasks (degenerate), and delta must be positive", () => {
    expect(tasksForSuccessNI(0, 0.05, ALPHA, POWER)).toBe(0);
    expect(() => tasksForSuccessNI(0.3, 0, ALPHA, POWER)).toThrow(RangeError);
    expect(() => tasksForSuccessNI(Number.NaN, 0.05, ALPHA, POWER)).toThrow(RangeError);
    expect(() => tasksForSuccessNI(-0.1, 0.05, ALPHA, POWER)).toThrow(RangeError);
  });

  it("the cost algebra is the same form, scale-free", () => {
    expect(pairsForLogCostNI(0.4, 0.1, ALPHA, POWER)).toBeCloseTo(7.848879734 * 16, 6);
    expect(pairsForLogCostNI(0.4, 0.1, ALPHA, POWER)).toBeCloseTo(pairsForLogCostNI(4, 1, ALPHA, POWER), 9);
  });

  it("DEFF for equal clusters: rho 0 gives 1, rho 1 gives m, one task per cluster gives 1", () => {
    expect(designEffectEqual(10, 0.1)).toBeCloseTo(1.9, 12);
    expect(designEffectEqual(10, 0)).toBe(1);
    expect(designEffectEqual(10, 1)).toBe(10);
    expect(designEffectEqual(1, 0.7)).toBe(1);
    expect(() => designEffectEqual(10, -0.05)).toThrow(RangeError);
    expect(() => designEffectEqual(0.5, 0.1)).toThrow(RangeError);
  });

  it("DEFF for unequal clusters equals the exact sum n^2 / sum n form with the population cv", () => {
    const sizes = [5, 10, 15];
    const cv = clusterSizeCv(sizes); // population variance 50/3, cv^2 = 1/6
    expect(cv * cv).toBeCloseTo(1 / 6, 12);
    const exact = 1 + ((25 + 100 + 225) / 30 - 1) * 0.1; // 2.0666...
    expect(designEffectUnequal(10, cv, 0.1)).toBeCloseTo(exact, 12);
    expect(designEffectUnequal(10, 0, 0.1)).toBeCloseTo(designEffectEqual(10, 0.1), 12);
    expect(clusterSizeCv([4, 4, 4])).toBe(0);
    expect(clusterSizeCv([7])).toBe(0);
    expect(() => clusterSizeCv([])).toThrow(RangeError);
    expect(() => clusterSizeCv([3, 0])).toThrow(RangeError);
  });

  it("N = n_tasks * DEFF / m, by hand", () => {
    expect(reposFromTasks(282.5596704, 1.9, 10)).toBeCloseTo(53.68633738, 6);
    expect(reposFromTasks(0, 1, 5)).toBe(0);
    expect(() => reposFromTasks(10, 0.9, 5)).toThrow(RangeError);
  });

  it("roundUp is a separate helper and tolerates a float a hair above an integer", () => {
    expect(roundUp(53.686)).toBe(54);
    expect(roundUp(54.0000000001)).toBe(54);
    expect(roundUp(0)).toBe(0);
  });
});

describe("the task difference d_i (protocol 8.5, primary analysis of 3.2)", () => {
  const P: RunOutcome = "PASS", F: RunOutcome = "FAIL", I: RunOutcome = "INCOMPLETE";
  it("is the difference of success rates over r runs; INCOMPLETE counts as failure", () => {
    expect(taskDifference([P, P, F], [P, F, F])).toBeCloseTo(1 / 3, 15);
    expect(taskDifference([P, I, I], [P, P, P])).toBeCloseTo(-2 / 3, 15);
    expect(taskDifference([F], [P])).toBe(-1);
    expect(taskDifference([P, P], [P, P])).toBe(0);
  });
  it("is undefined for an unreplaced INVALID run, unequal r, or an empty arm", () => {
    expect(() => taskDifference([P, "INVALID"], [P, P])).toThrow(/INVALID/);
    expect(() => taskDifference([P, P, P], [P, P])).toThrow(/one r/);
    expect(() => taskDifference([], [])).toThrow(RangeError);
  });
});

describe("variance components (helper, one-way ANOVA)", () => {
  it("unequal clusters, by hand", () => {
    // clusters [.1,.3] [.5,.7,.9] [.2]: grand .45, SSB .375, SSW .1, MSB .1875, MSW 1/30, n0 11/6
    const v = varianceComponents([[0.1, 0.3], [0.5, 0.7, 0.9], [0.2]]);
    expect(v.msBetween).toBeCloseTo(0.1875, 12);
    expect(v.msWithin).toBeCloseTo(1 / 30, 12);
    expect(v.n0).toBeCloseTo(11 / 6, 12);
    expect(v.sigmaB2).toBeCloseTo((0.1875 - 1 / 30) / (11 / 6), 12);
    expect(v.rho).toBeCloseTo(0.7161290323, 9);
    expect(v.sigmaD2).toBeCloseTo(v.sigmaB2! + v.sigmaW2!, 15);
  });

  it("equal clusters: n0 is the common size", () => {
    const v = varianceComponents([[0, 1], [1, 1], [0, 0]]);
    expect(v.n0).toBe(2);
    // grand .5, cluster means .5 1 0: SSB 2*(0 + .25 + .25) = 1, MSB .5; SSW .5, MSW .5/3
    expect(v.sigmaB2).toBeCloseTo((0.5 - 0.5 / 3) / 2, 12);
  });

  it("does not change when every value is shifted by a constant", () => {
    const data = [[0.1, 0.3], [0.5, 0.7, 0.9], [0.2]];
    const a = varianceComponents(data);
    const b = varianceComponents(data.map((c) => c.map((y) => y - 0.37)));
    expect(b.sigmaB2).toBeCloseTo(a.sigmaB2!, 12);
    expect(b.sigmaW2).toBeCloseTo(a.sigmaW2!, 12);
    expect(b.rho).toBeCloseTo(a.rho!, 12);
  });

  it("zero variance: components 0, rho undefined", () => {
    const v = varianceComponents([[0.2, 0.2], [0.2, 0.2, 0.2]]);
    expect(v.sigmaD2).toBe(0);
    expect(v.rho).toBeNull();
    expect(v.notes.join()).toMatch(/zero total variance/);
  });

  it("no within variance, only between: rho is 1", () => {
    const v = varianceComponents([[0, 0], [1, 1]]);
    expect(v.sigmaW2).toBe(0);
    expect(v.rho).toBe(1);
  });

  it("a single cluster: within is estimable, between and rho are not", () => {
    const v = varianceComponents([[0.1, 0.3, 0.5]]);
    expect(v.sigmaW2).toBeCloseTo(0.04, 12);
    expect(v.sigmaB2).toBeNull();
    expect(v.rho).toBeNull();
    expect(v.notes.join()).toMatch(/one cluster/);
  });

  it("every cluster of size one: within is not estimable", () => {
    const v = varianceComponents([[0.1], [0.4], [0.9]]);
    expect(v.sigmaW2).toBeNull();
    expect(v.rho).toBeNull();
    expect(v.notes.join()).toMatch(/one value/);
  });

  it("a negative between estimate is reported, not truncated", () => {
    // Clusters with identical means and within spread: MSB 0 < MSW.
    const v = varianceComponents([[0, 1], [0, 1], [0, 1]]);
    expect(v.sigmaB2!).toBeLessThan(0);
    expect(v.notes.join()).toMatch(/negative/);
  });

  it("refuses missing values and empty clusters instead of skipping them", () => {
    expect(() => varianceComponents([[0.1, Number.NaN]])).toThrow(/missing/);
    expect(() => varianceComponents([[0.1], []])).toThrow(/no values/);
    expect(() => varianceComponents([])).toThrow(RangeError);
  });
});

describe("run-to-run noise of one task (helper)", () => {
  it("unbiased estimate p(1-p)/(r-1); undefined with one run", () => {
    expect(rateVarianceEstimate(1, 2)).toBeCloseTo(0.25, 15);
    expect(rateVarianceEstimate(3, 3)).toBe(0);
    expect(rateVarianceEstimate(1, 4)).toBeCloseTo((0.25 * 0.75) / 3, 15);
    expect(rateVarianceEstimate(0, 1)).toBeNull();
    expect(() => rateVarianceEstimate(5, 4)).toThrow(RangeError);
  });
});
