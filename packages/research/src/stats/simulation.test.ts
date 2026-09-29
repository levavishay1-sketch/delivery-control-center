import { describe, expect, it } from "vitest";
import { ablationOnce, detection, exactDetectionProbability, mdeComponent, realizedEffect, type AblationDesign } from "./component.ts";
import { gatePassProbability, nrVerdict, predictedPower, predictedPowerT, simulateNr } from "./joint.ts";
import { mcProportion, zAgainst } from "./mc.ts";
import { Rng } from "./rng.ts";
import { incompleteBeta, logGamma, nonCentralTUpperTail, studentTCdf, studentTQuantile } from "./special.ts";
import { dropped, fireProbabilityForMixture, fireProbabilityForSet, meanAbsoluteDrop, mdrRepo, simulateFires, taskTripProbability } from "./tripwire.ts";

describe("seeded random source (helper)", () => {
  it("is reproducible from the seed and differs between seeds", () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const sa = Array.from({ length: 5 }, () => a.nextU32());
    expect(Array.from({ length: 5 }, () => b.nextU32())).toEqual(sa);
    expect(Array.from({ length: 5 }, () => c.nextU32())).not.toEqual(sa);
  });
  it("uniform mean and a Bernoulli rate lie within 4 standard errors of their values", () => {
    const r = new Rng(7);
    const n = 200_000;
    let s = 0, hits = 0, z = 0, z2 = 0;
    for (let i = 0; i < n; i++) { const u = r.uniform(); s += u; if (r.bernoulli(0.3)) hits++; const g = r.normal(); z += g; z2 += g * g; }
    expect(Math.abs(s / n - 0.5) / Math.sqrt(1 / 12 / n)).toBeLessThan(4);
    expect(Math.abs(zAgainst(0.3, hits, n))).toBeLessThan(4);
    expect(Math.abs(z / n) / Math.sqrt(1 / n)).toBeLessThan(4);
    expect(Math.abs(z2 / n - 1) / Math.sqrt(2 / n)).toBeLessThan(4);
  });
});

describe("Student's t (helper)", () => {
  it("log-gamma and the incomplete beta match exact values", () => {
    expect(logGamma(0.5)).toBeCloseTo(0.5723649429247001, 12);
    expect(logGamma(10)).toBeCloseTo(12.801827480081469, 11);
    expect(logGamma(1)).toBeCloseTo(0, 13);
    expect(incompleteBeta(0.5, 2, 3)).toBeCloseTo(11 / 16, 13); // P(Bin(4, .5) >= 2)
  });
  it("matches published t quantiles", () => {
    expect(studentTQuantile(0.975, 1)).toBeCloseTo(12.706204736174707, 7);
    expect(studentTQuantile(0.975, 5)).toBeCloseTo(2.570581835636314, 9);
    expect(studentTQuantile(0.975, 10)).toBeCloseTo(2.2281388519649385, 9);
    expect(studentTQuantile(0.975, 30)).toBeCloseTo(2.0422724563012373, 9);
    expect(studentTQuantile(0.95, 10)).toBeCloseTo(1.8124611228107335, 9);
    expect(studentTQuantile(0.025, 10)).toBeCloseTo(-2.2281388519649385, 9);
    expect(studentTCdf(0, 7)).toBeCloseTo(0.5, 15);
  });
  it("the non-central t tail is alpha at ncp 0 and matches direct draws (2e6, independent script) elsewhere", () => {
    const c12 = studentTQuantile(0.975, 12);
    expect(nonCentralTUpperTail(c12, 12, 0)).toBeCloseTo(0.025, 7);
    expect(nonCentralTUpperTail(studentTQuantile(0.975, 1), 1, 0)).toBeCloseTo(0.025, 6);
    expect(nonCentralTUpperTail(c12, 12, 2.955)).toBeCloseTo(0.7744, 2);
    expect(nonCentralTUpperTail(c12, 12, 2.216)).toBeCloseTo(0.5311, 2);
  });
});

describe("Monte Carlo precision (helper)", () => {
  it("Wilson interval and z-score, including 0 and all hits", () => {
    const m = mcProportion(50, 100);
    expect(m.p).toBe(0.5);
    expect(m.se).toBeCloseTo(0.05, 12);
    expect(m.lo).toBeLessThan(0.5);
    expect(m.hi).toBeGreaterThan(0.5);
    expect(mcProportion(0, 100).lo).toBe(0);
    expect(mcProportion(100, 100).hi).toBe(1);
    expect(zAgainst(0.5, 60, 100)).toBeCloseTo(2, 12);
  });
});

describe("tripwire (protocol 8.3.2) and MDR-Repo (8.3.1)", () => {
  it("one task: (1 - p_C)^r p_A^r, by hand", () => {
    expect(taskTripProbability(0.5, 0.5, 1)).toBe(0.25);
    expect(taskTripProbability(0.5, 0, 3)).toBe(0.125);
    expect(taskTripProbability(1, 1, 3)).toBe(0);
    expect(taskTripProbability(0, 0, 3)).toBe(0);
  });
  it("the two drop models", () => {
    expect(dropped(0.9, 0.3, "additive")).toBeCloseTo(0.6, 15);
    expect(dropped(0.2, 0.3, "additive")).toBe(0);
    expect(dropped(0.9, 0.3, "relative")).toBeCloseTo(0.63, 15);
    expect(() => dropped(0.5, 1.2, "additive")).toThrow(RangeError);
  });
  it("a set and a one-point mixture agree; a mixture is the average over drawn sets", () => {
    const set = Array(10).fill(0.5) as number[];
    expect(fireProbabilityForSet(set, 0, 3, "additive")).toBeCloseTo(1 - (63 / 64) ** 10, 14);
    expect(fireProbabilityForMixture([{ p: 0.5, w: 1 }], 10, 0, 3, "additive")).toBeCloseTo(1 - (63 / 64) ** 10, 14);
    // Two-point mixture, m = 2: average over the four equally likely sets.
    const mix = [{ p: 0.9, w: 1 }, { p: 0.3, w: 1 }];
    const sets = [[0.9, 0.9], [0.9, 0.3], [0.3, 0.9], [0.3, 0.3]];
    const avg = sets.reduce((a, s) => a + fireProbabilityForSet(s, 0.2, 2, "additive"), 0) / 4;
    expect(fireProbabilityForMixture(mix, 2, 0.2, 2, "additive")).toBeCloseTo(avg, 14);
  });
  it("a repository without runnable tasks has no tripwire; tasks at p_A = 0 never trip", () => {
    expect(() => fireProbabilityForSet([], 0.1, 3, "additive")).toThrow(/no runnable task/);
    expect(fireProbabilityForSet([0, 0, 0], 0.5, 3, "additive")).toBe(0);
  });
  it("MDR-Repo: bisection hits the closed-form crossing; UNKNOWN when the power is out of reach", () => {
    // One task, r = 1, p_A = 1: P(fire | x) = x under the additive model, so MDR = power.
    const res = mdrRepo((d) => fireProbabilityForSet([1], d, 1, "additive"), 0.8);
    expect(res.status).toBe("reached");
    expect(res.x).toBeCloseTo(0.8, 5);
    // p_A = 0.5, r = 3, m = 1: at most 0.5^3 = 0.125 < 0.8.
    expect(mdrRepo((d) => fireProbabilityForSet([0.5], d, 3, "additive"), 0.8)).toMatchObject({ status: "unreachable", x: null });
  });
  it("MDR-Repo is not a number when the rule already fires at the power with no drop", () => {
    // m = 10, r = 1, p = 0.5: false fire 1 - 0.75^10 = 0.944.
    const res = mdrRepo((d) => fireProbabilityForSet(Array(10).fill(0.5) as number[], d, 1, "additive"), 0.8);
    expect(res).toMatchObject({ status: "fires-without-drop", x: null });
    expect(res.fireAtZero).toBeCloseTo(1 - 0.75 ** 10, 14);
  });
  it("the two drop models on one scale: same p_C for a single baseline, different for a mixture", () => {
    const one = [{ p: 0.5, w: 1 }];
    expect(meanAbsoluteDrop(one, 0.2, "additive")).toBeCloseTo(meanAbsoluteDrop(one, 0.4, "relative"), 15);
    const mix = [{ p: 0.9, w: 1 }, { p: 0.1, w: 1 }];
    expect(meanAbsoluteDrop(mix, 0.2, "additive")).toBeCloseTo((0.2 + 0.1) / 2, 15);
    expect(meanAbsoluteDrop(mix, 0.2, "relative")).toBeCloseTo(0.2 * 0.5, 15);
  });
  it("the closed form agrees with a Monte Carlo of the rule itself (|z| < 4)", () => {
    const rng = new Rng(11);
    const set = [0.95, 0.9, 0.7, 0.5, 0.3, 0.95, 0.8, 0.6];
    for (const [x, r] of [[0, 3], [0.3, 3], [0.6, 2]] as const) {
      const reps = 20_000;
      const hits = simulateFires(rng, set, x, r, "additive", reps);
      expect(Math.abs(zAgainst(fireProbabilityForSet(set, x, r, "additive"), hits, reps))).toBeLessThan(4);
    }
  });
});

describe("MDE-Component (6.2, 8.3.1), code assumptions", () => {
  const design: AblationDesign = { mix: [{ p: 0.5, w: 1 }], tasks: 20, runs: 3, level: 0.975, method: "t" };
  it("the realized effect is the clipped mean shift", () => {
    expect(realizedEffect([{ p: 0.9, w: 1 }], 0.2)).toBeCloseTo(0.1, 15);
    expect(realizedEffect([{ p: 0.9, w: 1 }, { p: 0.5, w: 1 }], 0.2)).toBeCloseTo(0.15, 15);
    expect(realizedEffect([{ p: 0.1, w: 1 }], -0.3)).toBeCloseTo(-0.1, 15);
  });
  it("detects a large effect in its direction and one task decides by its sign", () => {
    const rng = new Rng(3);
    const big: AblationDesign = { ...design, mix: [{ p: 0.05, w: 1 }] };
    expect(ablationOnce(rng, big, 0.9, 2.1)).toBe(1);
    const one: AblationDesign = { ...design, tasks: 1 };
    expect([-1, 0, 1]).toContain(ablationOnce(rng, one, 0, 0));
  });
  it("exact enumeration, by hand: two tasks, one run, p = 0.5, only (+1, +1) is detected", () => {
    const e = exactDetectionProbability([{ p: 0.5, w: 1 }], 2, 1, 0, 1.96);
    expect(e.plus).toBeCloseTo(0.0625, 15);
    expect(e.minus).toBeCloseTo(0.0625, 15);
  });
  it("the Monte Carlo rate agrees with the exact enumeration (|z| < 4)", () => {
    const rng = new Rng(21);
    const d: AblationDesign = { mix: [{ p: 0.5, w: 1 }], tasks: 5, runs: 3, level: 0.975, method: "z" };
    const reps = 20_000;
    const mc = detection(rng, d, 0, reps);
    const e = exactDetectionProbability(d.mix, 5, 3, 0, 1.959963984540054);
    expect(Math.abs(zAgainst(e.plus, mc.detect.hits, reps))).toBeLessThan(4);
  });
  it("the MDE is the first grid point that reaches the power, reported with its Monte Carlo interval", () => {
    const rng = new Rng(5);
    const res = mdeComponent(rng, design, [0.1, 0.2, 0.3, 0.4, 0.5], 1, 0.8, 2000);
    expect(res.curve.length).toBe(5);
    expect(res.mde).not.toBeNull();
    const idx = res.curve.findIndex((c) => c.x === res.mde);
    expect(res.curve[idx]!.detect.p).toBeGreaterThanOrEqual(0.8);
    if (idx > 0) expect(res.curve[idx - 1]!.detect.p).toBeLessThan(0.8);
    expect(detection(rng, design, 0, 500).x).toBe(0);
  });
});

describe("joint power (8.6), code assumptions", () => {
  it("G gate, exact: passes surely at rate 0 and at most 1 - conf at rate fc_max", () => {
    const g0 = gatePassProbability(59, 0.05, 0, 0.95);
    expect(g0).toEqual({ pass: 1, maxFailures: 0 });
    const g1 = gatePassProbability(59, 0.05, 0.05, 0.95);
    expect(g1.pass).toBeCloseTo(0.95 ** 59, 14);
    expect(g1.pass).toBeLessThanOrEqual(0.05);
    expect(gatePassProbability(10, 0.05, 0, 0.95).pass).toBe(0); // no failure count can pass with 10 units
  });
  it("the NR verdict by hand: PASS, FAIL and too few repositories", () => {
    expect(nrVerdict([0, 0, 0, 0], 0.05, 0.025)).toBe("PASS");
    expect(nrVerdict([-0.2, -0.3, -0.25], 0.05, 0.025)).toBe("FAIL");
    expect(nrVerdict([0.1], 0.05, 0.025)).toBe("INCONCLUSIVE");
  });
  it("a small simulation runs, counts add up, and with no clipping the realized difference is the nominal one", () => {
    const rng = new Rng(9);
    const s = simulateNr(rng, { repos: 8, tasks: 5, runs: 2, mix: [{ p: 0.5, w: 1 }], deltaTrue: -0.02, tauB: 0, tauW: 0, deltaB: 0, margin: 0.1, alphaOneSided: 0.025 }, 200);
    expect(s.vsA.PASS + s.vsA.FAIL + s.vsA.INCONCLUSIVE).toBe(200);
    expect(s.bothPass).toBeLessThanOrEqual(Math.min(s.vsA.PASS, s.vsB.PASS));
    expect(s.clipRate).toBe(0);
    expect(s.realizedDelta).toBeCloseTo(-0.02, 12);
    expect(predictedPower(0.1, 1, 1e6, 1, 0, 0.1, 0.025)).toBeCloseTo(1, 6);
    // At the margin both predictions give alpha only in the limit; with t the prediction is lower at small N.
    expect(predictedPower(0.15, 1, 13, 10, -0.1, 0.1, 0.025)).toBeCloseTo(0.025, 12);
    expect(predictedPowerT(0.15, 1, 13, 10, 0, 0.1, 0.025)).toBeLessThan(predictedPower(0.15, 1, 13, 10, 0, 0.1, 0.025));
    expect(predictedPowerT(0.15, 1, 1, 10, 0, 0.1, 0.025)).toBe(0);
  });
});
