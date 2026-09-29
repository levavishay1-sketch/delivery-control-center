import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { detection, exactDetectionProbability, mdeComponent, type AblationDesign, type IntervalMethod } from "../stats/component.ts";
import { gatePassProbability, predictedPower, predictedPowerT, simulateNr, type NrDesign } from "../stats/joint.ts";
import { normalQuantile } from "../stats/normal.ts";
import { studentTQuantile } from "../stats/special.ts";
import { mcProportion, zAgainst } from "../stats/mc.ts";
import { Rng } from "../stats/rng.ts";
import { designEffectEqual, PROTOCOL_CONVENTIONS, reposFromTasks, roundUp, tasksForSuccessNI } from "../stats/sample-size.ts";
import { drawTasks, fireProbabilityForMixture, fireProbabilityForSet, meanAbsoluteDrop, mdrRepo, simulateFires, type DropModel, type MdrResult, type Mixture } from "../stats/tripwire.ts";
import { varianceComponents } from "../stats/variance.ts";
import { REPO_ROOT } from "../protocol.ts";

/**
 * Step 3 of the pilot infrastructure: behaviour checks of the simulations
 * behind MDR-Repo, the tripwire's false-fire rate, MDE-Component and joint
 * power. Every grid value below is a SCENARIO for exercising the rules, not
 * a candidate for any parameter; no result here selects a value.
 *
 * `npm run -w @dcc/research sim:step3` writes
 * docs/research/pilot/infrastructure/step-3-simulation-checks.{md,json}.
 */

const SEED = 20260929;
const POWER = PROTOCOL_CONVENTIONS.power;
const ALPHA = PROTOCOL_CONVENTIONS.alphaOneSided;
const CONF = PROTOCOL_CONVENTIONS.absoluteGateConfidence;

const SCENARIOS: Record<string, Mixture> = {
  "p=0.3": [{ p: 0.3, w: 1 }],
  "p=0.5": [{ p: 0.5, w: 1 }],
  "p=0.7": [{ p: 0.7, w: 1 }],
  "p=0.9": [{ p: 0.9, w: 1 }],
  "mid (0.3/0.5/0.7)": [{ p: 0.3, w: 1 }, { p: 0.5, w: 1 }, { p: 0.7, w: 1 }],
  "saturated (0.97:50%, 0.5:30%, 0.05:20%)": [{ p: 0.97, w: 0.5 }, { p: 0.5, w: 0.3 }, { p: 0.05, w: 0.2 }],
};

const f3 = (x: number | null) => (x === null ? "UNKNOWN" : x.toFixed(3));
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const ci = (lo: number, hi: number) => `[${pct(lo)}, ${pct(hi)}]`;
const md: string[] = [];
const json: Record<string, unknown> = { seed: SEED, power: POWER, alpha: ALPHA, conf: CONF };
let seedOffset = 0;
const nextRng = () => new Rng(SEED + ++seedOffset);
const t0 = Date.now();
const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);

// ---------------------------------------------------------------- A. tripwire false fire
log("A. tripwire false-fire rate");
md.push("## א. שיעור הירי השגוי של ה-tripwire, ללא הבדל בין הזרועות", "",
  "מחושב בנוסחה הסגורה: הסתברות שמשימה אחת לפחות נכשלת בכל r ההרצות ב-C ועוברת בכל r ההרצות ב-A, כשהזרועות זהות. תרחישים לפי התפלגות ההסתברות הבסיסית של המשימות.", "",
  "| תרחיש | m | r=1 | r=2 | r=3 | r=5 | r=8 |", "|---|---|---|---|---|---|---|");
const falseFire: Record<string, unknown>[] = [];
for (const [name, mix] of Object.entries(SCENARIOS)) {
  for (const m of [5, 10, 20, 40]) {
    const row = [1, 2, 3, 5, 8].map((r) => fireProbabilityForMixture(mix, m, 0, r, "additive"));
    falseFire.push({ scenario: name, m, byR: row });
    md.push(`| ${name} | ${m} | ${row.map(pct).join(" | ")} |`);
  }
}
json.falseFire = falseFire;

// Monte Carlo check of the closed form on the rule itself.
md.push("", "**בדיקת אימות:** הרצה ישירה של הכלל על תוצאות מוגרלות, מול הנוסחה הסגורה.", "",
  "| תרחיש | m | r | x | צפוי | נצפה | רווח 95% של הנצפה | z |", "|---|---|---|---|---|---|---|---|");
const mcChecksA: Record<string, unknown>[] = [];
{
  const rng = nextRng();
  const reps = 40_000;
  for (const [name, m, r, x] of [["p=0.5", 10, 3, 0], ["p=0.5", 5, 1, 0], ["p=0.9", 20, 3, 0], ["saturated (0.97:50%, 0.5:30%, 0.05:20%)", 10, 3, 0], ["saturated (0.97:50%, 0.5:30%, 0.05:20%)", 10, 3, 0.4], ["mid (0.3/0.5/0.7)", 10, 2, 0.3]] as const) {
    const mix = SCENARIOS[name]!;
    const expected = fireProbabilityForMixture(mix, m, x, r, "additive");
    let hits = 0;
    for (let k = 0; k < reps; k++) hits += simulateFires(rng, drawTasks(rng, mix, m), x, r, "additive", 1);
    const obs = mcProportion(hits, reps);
    const z = zAgainst(expected, hits, reps);
    mcChecksA.push({ scenario: name, m, r, x, expected, observed: obs.p, lo: obs.lo, hi: obs.hi, z });
    md.push(`| ${name} | ${m} | ${r} | ${x} | ${pct(expected)} | ${pct(obs.p)} | ${ci(obs.lo, obs.hi)} | ${z.toFixed(2)} |`);
  }
}
json.mcChecksA = mcChecksA;

// ---------------------------------------------------------------- B. MDR-Repo
log("B. MDR-Repo");
md.push("", "## ב. MDR-Repo: הירידה האחידה הקטנה ביותר שה-tripwire מזהה בעוצמה 0.8", "",
  "מחושב בחיפוש בינארי על הנוסחה הסגורה, לפי ההתפלגות של התרחיש. **UNKNOWN**: אף ירידה עד 1 אינה מגיעה לעוצמה, כפי שסעיף 8.3.1 קובע. **ירי ללא ירידה**: הכלל יורה בשיעור 0.8 או יותר כשאין שום ירידה, ולכן \"הירידה הקטנה ביותר\" היא ירי שגוי ולא זיהוי, ואין לה ערך. שני מודלי הירידה מוצגים כי הפרוטוקול אינו מגדיר ביניהם, וגם בסקאלה משותפת: הירידה המוחלטת הממוצעת בהסתברות ההצלחה.", "",
  "| תרחיש | m | r | ירי ללא ירידה | חיבורי: x | חיבורי: ירידה ממוצעת | יחסי: x | יחסי: ירידה ממוצעת |", "|---|---|---|---|---|---|---|---|");
const mdr: Record<string, unknown>[] = [];
const mdrCell = (res: MdrResult) => (res.status === "reached" ? res.x.toFixed(3) : res.status === "unreachable" ? "UNKNOWN" : "ירי ללא ירידה");
for (const [name, mix] of Object.entries(SCENARIOS)) {
  for (const m of [5, 10, 20, 40]) for (const r of [1, 3, 5]) {
    const byModel = (model: DropModel) => mdrRepo((x) => fireProbabilityForMixture(mix, m, x, r, model), POWER);
    const add = byModel("additive"), rel = byModel("relative");
    const addDrop = add.status === "reached" ? meanAbsoluteDrop(mix, add.x, "additive") : null;
    const relDrop = rel.status === "reached" ? meanAbsoluteDrop(mix, rel.x, "relative") : null;
    mdr.push({ scenario: name, m, r, falseFire: add.fireAtZero, additive: add, additiveMeanDrop: addDrop, relative: rel, relativeMeanDrop: relDrop });
    md.push(`| ${name} | ${m} | ${r} | ${pct(add.fireAtZero)} | ${mdrCell(add)} | ${addDrop === null ? "—" : addDrop.toFixed(3)} | ${mdrCell(rel)} | ${relDrop === null ? "—" : relDrop.toFixed(3)} |`);
  }
}
json.mdrRepo = mdr;

// Per-set versus mixture, the second open reading.
md.push("", "**קריאה לכל ריפו מול קריאה לפי התפלגות.** 500 סטים מוגרלים מתרחיש saturated, m=10, r=3, חיבורי: ה-MDR-Repo של כל סט מול הערך לפי ההתפלגות.", "");
{
  const rng = nextRng();
  const mix = SCENARIOS["saturated (0.97:50%, 0.5:30%, 0.05:20%)"]!;
  const perSet = Array.from({ length: 500 }, () => {
    const set = drawTasks(rng, mix, 10);
    return mdrRepo((x) => fireProbabilityForSet(set, x, 3, "additive"), POWER).x;
  });
  const known = perSet.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const q = (p: number) => known[Math.min(known.length - 1, Math.floor(p * known.length))]!;
  const mixtureValue = mdrRepo((x) => fireProbabilityForMixture(mix, 10, x, 3, "additive"), POWER).x;
  const summary = { sets: perSet.length, unknown: perSet.length - known.length, min: known[0] ?? null, p10: known.length ? q(0.1) : null, median: known.length ? q(0.5) : null, p90: known.length ? q(0.9) : null, max: known.at(-1) ?? null, mixture: mixtureValue };
  json.mdrPerSet = summary;
  md.push("| סטים | UNKNOWN | מינימום | עשירון 10 | חציון | עשירון 90 | מקסימום | לפי ההתפלגות |", "|---|---|---|---|---|---|---|---|",
    `| ${summary.sets} | ${summary.unknown} | ${f3(summary.min)} | ${f3(summary.p10)} | ${f3(summary.median)} | ${f3(summary.p90)} | ${f3(summary.max)} | ${f3(summary.mixture)} |`);
}

// MC check at the reported MDR crossing: the rule fires at the power there.
md.push("", "**בדיקת אימות בנקודת החצייה:** בירידה שנמצאה, הרצה ישירה של הכלל צריכה לירות בשיעור 0.8.", "",
  "| תרחיש | m | r | MDR | נצפה | רווח 95% | z מול 0.8 |", "|---|---|---|---|---|---|---|");
const mcChecksB: Record<string, unknown>[] = [];
{
  const rng = nextRng();
  const reps = 200_000;
  for (const [name, m, r] of [["p=0.9", 10, 3], ["p=0.7", 20, 3], ["saturated (0.97:50%, 0.5:30%, 0.05:20%)", 40, 3], ["p=0.9", 5, 1]] as const) {
    const mix = SCENARIOS[name]!;
    const x = mdrRepo((d) => fireProbabilityForMixture(mix, m, d, r, "additive"), POWER).x;
    if (x === null) { md.push(`| ${name} | ${m} | ${r} | UNKNOWN | — | — | — |`); continue; }
    let hits = 0;
    for (let k = 0; k < reps; k++) hits += simulateFires(rng, drawTasks(rng, mix, m), x, r, "additive", 1);
    const obs = mcProportion(hits, reps);
    const z = zAgainst(POWER, hits, reps);
    mcChecksB.push({ scenario: name, m, r, x, observed: obs.p, lo: obs.lo, hi: obs.hi, z });
    md.push(`| ${name} | ${m} | ${r} | ${x.toFixed(3)} | ${pct(obs.p)} | ${ci(obs.lo, obs.hi)} | ${z.toFixed(2)} |`);
  }
}
json.mcChecksB = mcChecksB;

// ---------------------------------------------------------------- C. MDE-Component
log("C. MDE-Component: type I at zero effect");
md.push("", "## ג. MDE-Component: אבלציה של רכיב בודד", "",
  "הנחות הקוד: אפקט חיבורי על הסתברות ההצלחה, רווח סמך זוגי על פני המשימות, \"זוהה\" פירושו שהרווח החד צדדי אינו כולל אפס בכיוון האפקט. שיטת הרווח אינה מוגדרת בפרוטוקול, ולכן שתי שיטות מוצגות.", "",
  "### שיעור זיהוי שגוי כשאין אפקט, מול הערך הנומינלי", "",
  "כל שורה: 20,000 אבלציות. הערך הנומינלי לכל כיוון הוא 1 פחות רמת הביטחון החד צדדית.", "",
  "| תרחיש | משימות | r | שיטה | רמה | נומינלי | שגוי בכיוון תועלת | רווח 95% | z |", "|---|---|---|---|---|---|---|---|---|");
const typeI: Record<string, unknown>[] = [];
{
  const rng = nextRng();
  for (const scen of ["p=0.5", "saturated (0.97:50%, 0.5:30%, 0.05:20%)"]) for (const tasks of [5, 10, 20, 40]) for (const runs of [1, 3, 5]) for (const method of ["z", "t"] as IntervalMethod[]) for (const level of [0.95, 0.975]) {
    const design: AblationDesign = { mix: SCENARIOS[scen]!, tasks, runs, level, method };
    const d = detection(rng, design, 0, 20_000);
    const nominal = 1 - level;
    const z = zAgainst(nominal, d.detect.hits, d.detect.reps);
    typeI.push({ scenario: scen, tasks, runs, method, level, nominal, observed: d.detect.p, lo: d.detect.lo, hi: d.detect.hi, z, harmSide: d.wrongDirection.p });
    md.push(`| ${scen} | ${tasks} | ${runs} | ${method} | ${level} | ${pct(nominal)} | ${pct(d.detect.p)} | ${ci(d.detect.lo, d.detect.hi)} | ${z.toFixed(1)} |`);
  }
}
json.typeI = typeI;

// Exact enumeration of the same decision, where the number of multisets is small enough.
md.push("", "**בדיקת אימות מדויקת.** לתאים שבהם אפשר למנות את כל הצירופים של הפרשי המשימות, שיעור הזיהוי השגוי חושב בדיוק, בלי דגימה. הוא משמש לבדוק את מונטה קרלו, ומראה שהסטייה מהנומינלי נובעת מהבדידות של d_i ולא מרעש.", "",
  "| תרחיש | משימות | r | שיטה | רמה | נומינלי | מדויק | מונטה קרלו | z של מונטה קרלו מול המדויק |", "|---|---|---|---|---|---|---|---|---|");
const exact: Record<string, unknown>[] = [];
{
  const combos = (m: number, k: number) => { let c = 1; for (let i = 1; i < k; i++) c = (c * (m + i)) / i; return c; };
  for (const row of typeI as { scenario: string; tasks: number; runs: number; method: IntervalMethod; level: number; nominal: number; observed: number }[]) {
    if (combos(row.tasks, 2 * row.runs + 1) > 2e6) continue;
    const q = row.tasks < 2 ? 0 : row.method === "z" ? normalQuantile(row.level) : studentTQuantile(row.level, row.tasks - 1);
    const e = exactDetectionProbability(SCENARIOS[row.scenario]!, row.tasks, row.runs, 0, q);
    const z = zAgainst(e.plus, Math.round(row.observed * 20_000), 20_000);
    exact.push({ ...row, exact: e.plus, exactHarm: e.minus, z });
    md.push(`| ${row.scenario} | ${row.tasks} | ${row.runs} | ${row.method} | ${row.level} | ${pct(row.nominal)} | ${pct(e.plus)} | ${pct(row.observed)} | ${z.toFixed(2)} |`);
  }
}
json.typeIExact = exact;

log("C. MDE-Component: detection curves");
md.push("", "### ה-MDE לפי תרחיש, רמה חד צדדית 0.975", "",
  "רשת האפקטים 0.05 עד 0.6 בצעדים של 0.05. בכל נקודה 2,000 אבלציות. \"לא ודאי\": רווח מונטה קרלו בנקודה שנמצאה, או בנקודה שלפניה, כולל את 0.8. \"ממומש\": האפקט הממוצע אחרי חיתוך ל-[0, 1].", "",
  "| תרחיש | משימות | r | שיטה | תועלת: MDE | ממומש | תועלת לא ודאי | נזק: MDE | ממומש | נזק לא ודאי |", "|---|---|---|---|---|---|---|---|---|---|");
const mde: Record<string, unknown>[] = [];
{
  const rng = nextRng();
  const grid = Array.from({ length: 12 }, (_, i) => Math.round((i + 1) * 5) / 100);
  for (const scen of ["p=0.5", "saturated (0.97:50%, 0.5:30%, 0.05:20%)"]) for (const tasks of [5, 10, 20, 40]) for (const runs of [1, 3, 5]) for (const method of ["z", "t"] as IntervalMethod[]) {
    const design: AblationDesign = { mix: SCENARIOS[scen]!, tasks, runs, level: 0.975, method };
    const up = mdeComponent(rng, design, grid, 1, POWER, 2000);
    const down = mdeComponent(rng, design, grid, -1, POWER, 2000);
    mde.push({ scenario: scen, tasks, runs, method, benefit: { mde: up.mde, realized: up.realized, uncertain: up.uncertain }, harm: { mde: down.mde, realized: down.realized, uncertain: down.uncertain } });
    md.push(`| ${scen} | ${tasks} | ${runs} | ${method} | ${f3(up.mde)} | ${f3(up.realized)} | ${up.uncertain ? "כן" : "לא"} | ${f3(down.mde)} | ${f3(down.realized)} | ${down.uncertain ? "כן" : "לא"} |`);
  }
}
json.mde = mde;

// ---------------------------------------------------------------- D. joint power
log("D. G gates");
md.push("", "## ד. עוצמה משותפת", "", "### שער G: הסתברות לעבור כשקצב הכישלון האמיתי נתון, חישוב מדויק", "",
  "בשורה שבה הקצב האמיתי שווה ל-fc_max, ההסתברות חייבת להיות לכל היותר 5%, כי זו שגיאת ההסמכה שהשער אמור לחסום.", "",
  "| n | fc_max | כישלונות מותרים | קצב 0 | 0.5% | 1% | 2% | fc_max/2 | fc_max |", "|---|---|---|---|---|---|---|---|---|");
const gates: Record<string, unknown>[] = [];
for (const n of [29, 59, 100, 200]) for (const fc of [0.05, 0.1]) {
  const rates = [0, 0.005, 0.01, 0.02, fc / 2, fc];
  const res = rates.map((f) => gatePassProbability(n, fc, f, CONF));
  gates.push({ n, fcMax: fc, maxFailures: res[0]!.maxFailures, pass: res.map((x) => x.pass), rates });
  md.push(`| ${n} | ${fc} | ${res[0]!.maxFailures < 0 ? "אין" : res[0]!.maxFailures} | ${res.map((x) => pct(x.pass)).join(" | ")} |`);
}
json.gates = gates;

log("D. NR gates: variance components of the scenario");
md.push("", "### שערי NR להצלחה, מול A ומול B", "",
  "הנחות הקוד: מבחן t על ממוצעי הריפוזיטורים, ו-B מתנהג כמו A. ה-N נגזר מנוסחת סעיף 8.5 עם σ_d ו-ρ של התרחיש עצמו, שנאמדו מ-3,000 ריפוזיטורים מדומים בלי הבדל. בכל שורה 4,000 חזרות.", "",
  "| δ | τ_b, τ_w | σ_d² | ρ | N מהנוסחה | הפרש אמיתי | PASS מול A | רווח 95% | חיזוי נורמלי | t לא מרכזי, קלט נאמד | t לא מרכזי, קלט אמיתי | PASS מול B | PASS בשניהם | מכפלת השוליים | חיתוך |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
const nr: Record<string, unknown>[] = [];
{
  const mix = SCENARIOS["mid (0.3/0.5/0.7)"]!;
  for (const margin of [0.05, 0.1]) for (const [tauB, tauW] of [[0, 0], [0.05, 0.05]] as const) {
    const rng = nextRng();
    // Variance components of d_i (C vs A) under no difference, from one large simulated pilot.
    const clusters: number[][] = [];
    for (let j = 0; j < 3000; j++) {
      const u = tauB * rng.normal();
      const c: number[] = [];
      for (let i = 0; i < 10; i++) {
        const pA = mix[rng.pick(mix.map((x) => x.w))]!.p;
        const pC = Math.min(1, Math.max(0, pA + u + tauW * rng.normal()));
        c.push((rng.binomial(3, pC) - rng.binomial(3, pA)) / 3);
      }
      clusters.push(c);
    }
    const vc = varianceComponents(clusters);
    const rho = Math.max(0, vc.rho ?? 0);
    const nTasks = tasksForSuccessNI(Math.sqrt(vc.sigmaD2!), margin, ALPHA, POWER);
    const deff = designEffectEqual(10, rho);
    const N = roundUp(reposFromTasks(nTasks, deff, 10));
    for (const truth of [0, -margin / 4, -margin]) {
      const design: NrDesign = { repos: N, tasks: 10, runs: 3, mix, deltaTrue: truth, tauB, tauW, deltaB: 0, margin, alphaOneSided: ALPHA };
      const sim = simulateNr(rng, design, 4000);
      const a = mcProportion(sim.vsA.PASS, sim.reps), b = mcProportion(sim.vsB.PASS, sim.reps), both = mcProportion(sim.bothPass, sim.reps);
      const predicted = predictedPower(vc.sigmaD2!, deff, N, 10, sim.realizedDelta, margin, ALPHA);
      const predictedT = predictedPowerT(vc.sigmaD2!, deff, N, 10, sim.realizedDelta, margin, ALPHA);
      // Known only without heterogeneity: sigma_d^2 = 2 E[p(1 - p)] / r and rho = 0.
      const trueSigma = tauB === 0 && tauW === 0 ? (2 * mix.reduce((acc, c) => acc + c.w * c.p * (1 - c.p), 0) / mix.reduce((acc, c) => acc + c.w, 0)) / 3 : null;
      const predictedTrue = trueSigma === null ? null : predictedPowerT(trueSigma, 1, N, 10, sim.realizedDelta, margin, ALPHA);
      nr.push({ margin, tauB, tauW, sigmaD2: vc.sigmaD2, rho: vc.rho, nRepos: N, truth, realized: sim.realizedDelta, passA: a, passB: b, both, predicted, predictedT, predictedTrue, product: a.p * b.p, clipRate: sim.clipRate, verdictsA: sim.vsA });
      md.push(`| ${margin} | ${tauB}, ${tauW} | ${vc.sigmaD2!.toFixed(4)} | ${(vc.rho ?? 0).toFixed(4)} | ${N} | ${sim.realizedDelta.toFixed(4)} | ${pct(a.p)} | ${ci(a.lo, a.hi)} | ${pct(predicted)} | ${pct(predictedT)} | ${predictedTrue === null ? "—" : pct(predictedTrue)} | ${pct(b.p)} | ${pct(both.p)} | ${pct(a.p * b.p)} | ${pct(sim.clipRate)} |`);
    }
    log(`D. NR margin ${margin} tau ${tauB},${tauW} done (N=${N})`);
  }
}
json.nr = nr;

// Combined illustration under the independence assumption.
md.push("", "### שילוב שערי NR ושערי G, בהנחת אי-תלות ביניהם", "",
  "המכפלה של \"PASS בשניהם\" מהטבלה הקודמת בהסתברות ששני שערי G עוברים, C1 ו-C2, כל אחד עם 59 יחידות ו-fc_max 0.05. המטרה היא להראות את כיוון ההשפעה, לא לבחור ערך.", "",
  "| δ | τ_b, τ_w | הפרש אמיתי | NR בשניהם | G בקצב 0 | משותף בקצב 0 | G בקצב 0.5% | משותף בקצב 0.5% |", "|---|---|---|---|---|---|---|---|");
{
  const g0 = gatePassProbability(59, 0.05, 0, CONF).pass;
  const g05 = gatePassProbability(59, 0.05, 0.005, CONF).pass;
  for (const row of nr as { margin: number; tauB: number; tauW: number; truth: number; both: { p: number } }[]) {
    if (row.truth === -row.margin) continue;
    md.push(`| ${row.margin} | ${row.tauB}, ${row.tauW} | ${row.truth === 0 ? "0" : "−δ/4"} | ${pct(row.both.p)} | ${pct(g0 * g0)} | ${pct(row.both.p * g0 * g0)} | ${pct(g05 * g05)} | ${pct(row.both.p * g05 * g05)} |`);
  }
}

// ---------------------------------------------------------------- write
const commit = (() => { try { return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
const header = [
  "# שלב 3 של תשתית הפיילוט: בדיקות התנהגות של הסימולציות",
  "",
  `נוצר על ידי \`npm run -w @dcc/research sim:step3\`. זרע ${SEED}, קוד בקומיט \`${commit}\` ועוד השינויים של שלב 3. עוצמה ${POWER} ואלפא חד צדדי ${ALPHA} הם מוסכמות סעיף 8.2.`,
  "",
  "**מה זה ומה זה לא.** אלה בדיקות של התנהגות החישובים והכללים תחת תרחישים מוגדרים. כל ערך ברשת הוא תרחיש, לא מועמד לפרמטר, ואין כאן בחירה של ערך. זו אינה ראיה שהפיילוט או התהליך עומדים בדרישה כלשהי.",
  "",
  "## שלוש רמות",
  "",
  "**מה שהפרוטוקול מגדיר במפורש.**",
  "- כלל ה-tripwire למשימה: נכשלת בכל r ההרצות ב-C ועוברת בכל r ההרצות ב-A, סעיף 8.3.2. tripwire שנורה מונע Verified.",
  "- MDR-Repo: הירידה האחידה הקטנה ביותר שכלל ההחלטה בפועל מזהה בעוצמה שנקבעה, עם עקומת הזיהוי, שיעור הירי כשאין הבדל, ו-UNKNOWN כשאין ירידה שמגיעה לעוצמה, סעיף 8.3.1.",
  "- MDE-Component לאבלציה של רכיב בודד, ו-ε אינו קטן ממנו, סעיפים 6.2 ו-8.3.1.",
  "- שער NR לפי הרווח החד צדדי מול השוליים, סעיף 8.3.2. שער G לפי חסם Clopper-Pearson, סעיף 8.2. עוצמה משותפת בסימולציה, גם בהפרש אמיתי של −δ/4, סעיפים 8.5 ו-8.6.",
  "- המוסכמות: עוצמה 0.8, אלפא חד צדדי 0.025, ביטחון 95%, סעיף 8.2.",
  "",
  "**הנחות עזר של הקוד, לצורך הסימולציה בלבד.**",
  "- ריפו יורה כשמשימה אחת לפחות יורה.",
  "- ריצות הן ניסויי ברנולי בלתי תלויים, כולן הושלמו, ו-r זהה בשתי הזרועות.",
  "- באבלציה: אפקט חיבורי על הסתברות ההצלחה, \"זוהה\" פירושו שהרווח החד צדדי אינו כולל אפס, ורווח זוגי על פני המשימות בשיטת z או t.",
  "- ב-NR: מבחן t על ממוצעי הריפוזיטורים, כי U21 פתוח. הטרוגניות נורמלית ברמת ריפו ומשימה. B מתנהג כמו A.",
  "- שערי G ו-NR נכשלים באופן בלתי תלוי.",
  "- התפלגויות ההסתברות הבסיסית של המשימות הן תרחישים.",
  "",
  "**מה שדורש הכרעה או תיקון ממוספר בפרוטוקול.**",
  "1. מודל הירידה ב-MDR-Repo: ירידה חיבורית או יחסית. בהסתברות בסיס אחת שני המודלים זהים ונבדלים רק ביחידות. בתמהיל משימות הם נבדלים בפועל, ראו סעיף ב.",
  "2. האם MDR-Repo מחושב על סט המשימות של הריפו או על התפלגות המשימות מהפיילוט. הערך לפי ההתפלגות קרוב לחציון של הסטים, אבל ערכי הסטים מתפזרים סביבו, ראו סעיף ב.",
  "3. שיטת רווח הסמך באבלציה של רכיב. U38 מכסה את הרמה, תיקון הריבוי ומבחן השקילות, אבל לא את השיטה. שיטה z חורגת מהנומינלי בעד פי 2.6 במשימות מעטות, ראו סעיף ג.",
  "4. הערה, לא תיקון: כשה-tripwire יורה בשיעור העוצמה בלי שום ירידה, ל-MDR-Repo אין ערך משמעותי. זה מכוסה ברגע ש-U35 נקבע מתחת לעוצמה.",
  "5. שלוש הבעיות הפתוחות משלב 2 נשארות פתוחות: ניתוח הרגישות עם INCOMPLETE כחסר, האומד של σ_d ו-ρ, ונוסחת העלות.",
  "",
  "## תלות בבעיות הפתוחות משלב 2",
  "",
  "- **INCOMPLETE כחסר.** כל הסימולציות מניחות שכל ההרצות הושלמו. ה-tripwire בניתוח הרגישות אינו מוגדר, כמו d_i. התוצאות תקפות לניתוח הראשי בלבד.",
  "- **האומד של σ_d ו-ρ.** רק \"N מהנוסחה\" ו\"t לא מרכזי, קלט נאמד\" בסעיף ד תלויים בו. גם מ-30,000 משימות מדומות ρ נאמד 0.003 במקום 0, וזה הוריד את החיזוי בכנקודה וחצי. ה-tripwire, MDR-Repo, שיעור הירי השגוי, MDE-Component ושערי G אינם תלויים בו.",
  "- **נוסחת העלות.** שערי העלות הושמטו מהעוצמה המשותפת, וצד κ הושמט מ-MDE-Component. לכן העוצמה המשותפת כאן היא חסם עליון: כל שער נוסף רק מוריד אותה.",
  "",
  "## מגבלות",
  "",
  "- אין נתוני ניסוי. כל תוצאה תקפה רק תחת הנחות המודל והתרחיש שלה.",
  "- אי-הוודאות ממספר החזרות מדווחת לכל שיעור כרווח Wilson של 95%. רזולוציית רשת ה-MDE היא 0.05, ותא שבו הרווח חוצה את 0.8 מסומן \"לא ודאי\".",
  "- σ_d ו-ρ לתכנון נאמדו מאותו מודל שממנו נבדקה העוצמה. בפיילוט האמיתי האומדנים יהיו רועשים הרבה יותר.",
  "- אין מתאם בין ריצות של אותה משימה מעבר להסתברות שלה, אין בדיקות לא יציבות, ואין הרצות שנעצרו בתקרה.",
  "- זה אינו מדד לשום דבר על DCC או על הפיילוט.",
  "",
];
const outDir = path.join(REPO_ROOT, "docs/research/pilot/infrastructure");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "step-3-simulation-checks.md"), [...header, ...md, ""].join("\n"));
writeFileSync(path.join(outDir, "step-3-simulation-checks.json"), JSON.stringify(json, null, 1) + "\n");
log("written");
