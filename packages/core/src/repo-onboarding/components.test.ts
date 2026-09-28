import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyRules } from "./rules.ts";
import { ALWAYS_LOADED_MAX, buildOrder, cardFromSeed, deliverable, groupFor, mergeSeeds, pruneByBaseline, pruneDocumentedProcessSteps, pullRequestReport, readiness, seedsFromProcesses, seedsFromTrials } from "./components.ts";
import type { Component, ComponentSeed, RepoProfile, TrialOutcome } from "./types.ts";

const DIR = fileURLToPath(new URL("../../../../docs/research/sources/onboarding-v2/repos/diagnosis/", import.meta.url));
const load = (n: string) => JSON.parse(readFileSync(`${DIR}${n}.json`, "utf8")) as RepoProfile;
const seeds = (n: string) => applyRules(load(n)).fired.flatMap((f) => f.components);

describe("cards from seeds", () => {
  it("groups by problem and risk, then by the automation level", () => {
    expect(groupFor({ kind: "permission", risk: "reversible" }, "reversible_auto")).toBe("auto");
    expect(groupFor({ kind: "permission", risk: "reversible" }, "all_approval")).toBe("approval");
    expect(groupFor({ kind: "mcp", risk: "external" }, "reversible_auto")).toBe("approval");
    expect(groupFor({ kind: "report", risk: "reversible" }, "locked")).toBe("auto");
    expect(groupFor({ kind: "agent", risk: "significant", notRecommended: true }, "reversible_auto")).toBe("not_recommended");
  });
  it("gives Trade its three groups with the numbers of the research", () => {
    const cards = seeds("altshuler_trade").map((s) => cardFromSeed(s, "reversible_auto"));
    // 13 rules → 31 cards (the research counted 27; the port adds .gitattributes, .gitignore and the "no format hook" card, and a
    // "they exist, you just cannot read them" line beside each of the two denies; the per-area card needs the diagnosis's layout, which the research's lacks)
    expect(cards.length).toBe(31);
    const by = (g: string) => cards.filter((c) => c.group === g).length;
    // no format hook, and no per-package files (the research's diagnosis names no package with a command of its own)
    expect(by("not_recommended")).toBe(2);
    expect(by("auto")).toBeGreaterThan(5);
    expect(by("approval")).toBeGreaterThanOrEqual(5);
    expect(cards.find((c) => c.key === "windows_runner")!.group).toBe("approval");
    expect(cards.find((c) => c.key === "no_format_hook")!.status).toBe("declined");
    expect(cards.find((c) => c.key === "secrets_report")!.status).toBe("reported");
  });
  it("estimates the context an always-loaded component costs", () => {
    const cards = seeds("altshuler_trade").map((s) => cardFromSeed(s, "reversible_auto"));
    expect(cards.find((c) => c.key === "dataverse_mcp")!.contextTokens).toBe(2100);
    expect(cards.find((c) => c.key === "cannot_build_here_rule")!.contextTokens).toBeGreaterThan(20);
  });
});

describe("seeds from the other sources", () => {
  const trial = (key: string, kind: TrialOutcome["failureKind"]): TrialOutcome => ({ taskKey: key, title_he: key, phase: "baseline", passed: kind === null, failureKind: kind, detail: "d", costUsd: 0.1, callId: null, judgedBy: "code" });
  it("a failed trial adds the kind of component its failure points at — unless the rules already did", () => {
    const rules = seeds("altshuler_trade");
    const add = seedsFromTrials([trial("t1", "needs_external"), trial("t2", "bad_judgment"), trial("t3", null)], rules);
    // Trade's rules already put an mcp in (needs_external → mcp) but no agent/skill from bad_judgment? skills exist → skipped
    expect(add.map((s) => s.key)).toEqual([]);
    const none = seedsFromTrials([trial("t2", "bad_judgment")], []);
    expect(none[0]).toMatchObject({ kind: "agent", source: "trial", sourceRef: "t2" });
  });
  it("a process step decided agent becomes an agent named after it; skill becomes a skill", () => {
    const s = seedsFromProcesses([{ key: "add_field", title: "Add a field", source: "git", evidence: ["x"], trialTaskKey: null, impossible: null, steps: [
      { key: "schema", title: "Look up the schema", what: "", agentTest: { judgment: false, externalInfo: true, readsALot: false, parallel: false, failsToday: false, why: "lives in Dataverse" }, decision: "agent", reason: "סוכן" },
      { key: "regen", title: "Regenerate", what: "run DLaB", agentTest: { judgment: false, externalInfo: false, readsALot: false, parallel: false, failsToday: false, why: "" }, decision: "skill", reason: "skill" },
      { key: "commit", title: "Commit", what: "", agentTest: { judgment: false, externalInfo: false, readsALot: false, parallel: false, failsToday: false, why: "" }, decision: "none", reason: "" },
    ] }]);
    expect(s.map((x) => [x.kind, x.key])).toEqual([["agent", "agent_add_field_schema"], ["skill", "skill_add_field_regen"]]);
    expect(s[0]!.why_he).toContain("Dataverse");
  });
  it("merges the same key from two sources without losing evidence", () => {
    const a: ComponentSeed = { key: "k", kind: "rule", family: "knowledge", risk: "reversible", source: "rule", sourceRef: "R01", title_he: "t", why_he: "one", what_he: "w", verifyHow_he: "", params: {} };
    const b: ComponentSeed = { ...a, source: "trial", sourceRef: "t1", why_he: "two" };
    const m = mergeSeeds([a], [b]);
    expect(m).toHaveLength(1);
    expect(m[0]!.why_he).toBe("one וגם: two");
    expect(m[0]!.sourceRef).toBe("R01,t1");
  });
  it("never merges two different seeds whose keys met at the 60-character cut, nor two kinds under one key — the later gets -2, -3", () => {
    const long = (step: string): ComponentSeed => ({ key: `skill_${"a_very_long_process_key_that_goes_on".repeat(2)}_${step}`.slice(0, 60), kind: "skill", family: "skills", risk: "reversible", source: "process", sourceRef: `proc.${step}`, title_he: step, why_he: step, what_he: "w", verifyHow_he: "", params: { step } });
    const [a, b, c] = [long("build"), long("publish"), long("review")];
    expect(a.key).toBe(b.key);
    const m = mergeSeeds([a, b, c], [{ ...b, why_he: "again" }]);
    expect(m.map((s) => s.params.step)).toEqual(["build", "publish", "review"]);
    expect(m.map((s) => s.key)).toEqual([a.key, `${a.key.slice(0, 58)}-2`, `${a.key.slice(0, 58)}-3`]);
    expect(m.every((s) => s.key.length <= 60)).toBe(true);
    expect(m[1]!.why_he).toBe("publish וגם: again");
    const rule: ComponentSeed = { key: "k", kind: "rule", family: "knowledge", risk: "reversible", source: "rule", sourceRef: "R01", title_he: "t", why_he: "one", what_he: "w", verifyHow_he: "", params: {} };
    expect(mergeSeeds([rule], [{ ...rule, kind: "doc" }]).map((s) => [s.key, s.kind])).toEqual([["k", "rule"], ["k-2", "doc"]]);
  });
});

describe("the build order, the readiness gate and the report", () => {
  const cards = seeds("altshuler_trade").map((s) => cardFromSeed(s, "reversible_auto"));
  it("builds safety first, agents late", () => {
    const order = buildOrder(cards).map((c) => c.family);
    expect(order.indexOf("safety")).toBe(0);
    expect(order.lastIndexOf("safety")).toBeLessThan(order.indexOf("knowledge"));
    const cline = buildOrder(seeds("cline").map((s) => cardFromSeed(s, "reversible_auto"))).map((c) => c.family);
    expect(cline.indexOf("agents")).toBeGreaterThan(cline.lastIndexOf("connections"));
    expect(cline.indexOf("enforcement")).toBeGreaterThan(cline.lastIndexOf("agents"));
  });
  it("is not ready while cards wait and nothing was measured; says what is missing and what cannot be verified here", () => {
    const r = readiness({ cards, processes: [], trials: [], delta: null, reviewerOpen: 1, suppressed: [], firings: [], windowsOnly: true, hasRunner: false });
    expect(r.ready).toBe(false);
    expect(r.items.map((x) => x.ok)).toEqual([true, false, false, false, false]);
    expect(r.honesty[0]).toContain("Windows");
  });
  it("is ready once everything is decided, measured and improved", () => {
    const decided: Component[] = cards.map((c) => (c.status === "proposed" ? { ...c, status: "verified" } : c));
    const r = readiness({ cards: decided, processes: [], trials: [], delta: { before: { passed: 2, total: 5, costUsd: 1 }, after: { passed: 4, total: 5, costUsd: 0.9 }, costPerTaskChange: -0.1 }, reviewerOpen: 0, suppressed: [], firings: [], windowsOnly: false, hasRunner: false, alwaysLoadedTokens: 1800 });
    expect(r.ready).toBe(true);
  });
  it("'the same' is not an improvement; every measured component must have earned its place; the always-loaded context is capped", () => {
    const decided: Component[] = cards.map((c) => (c.status === "proposed" ? { ...c, status: "verified" } : c));
    const base = { processes: [], trials: [], reviewerOpen: 0, suppressed: [], firings: [], windowsOnly: false, hasRunner: false, alwaysLoadedTokens: 1800 };
    const item = (r: ReturnType<typeof readiness>, key: string) => r.items.find((x) => x.key === key)!;
    const same = readiness({ ...base, cards: decided, delta: { before: { passed: 3, total: 5, costUsd: 1 }, after: { passed: 3, total: 5, costUsd: 0.7 }, costPerTaskChange: -0.3 } });
    expect(item(same, "delta")).toMatchObject({ ok: false });
    expect(item(same, "delta").detail_he).toContain("אותו דבר");
    const improved = { before: { passed: 2, total: 5, costUsd: 1 }, after: { passed: 4, total: 5, costUsd: 1 }, costPerTaskChange: 0 };
    const knowledge = decided.find((c) => c.kind === "rule")!;
    const hook = decided.find((c) => c.kind === "hook")!;
    // The measurement calls a safety component "improved" when it was seen blocking; "same" is what did not earn its place.
    const withDelta = (c: Component, verdict: "improved" | "same" | "unmeasured"): Component => ({ ...c, status: "verified", delta: { before: 1, after: verdict === "improved" ? 2 : 1, total: 2, costPerTaskChange: null, verdict } });
    const unproven = readiness({ ...base, cards: decided.map((c) => (c.key === knowledge.key ? withDelta(c, "same") : c)), delta: improved });
    expect(item(unproven, "delta").ok).toBe(false);
    expect(item(unproven, "delta").detail_he).toContain(knowledge.title_he);
    expect(item(readiness({ ...base, cards: decided.map((c) => (c.key === hook.key ? withDelta(c, "improved") : c.key === knowledge.key ? withDelta(c, "unmeasured") : c)), delta: improved }), "delta").ok).toBe(true);
    expect(item(readiness({ ...base, cards: decided.map((c) => (c.key === hook.key ? withDelta(c, "same") : c)), delta: improved }), "delta").ok).toBe(false);
    expect(item(readiness({ ...base, cards: decided, delta: improved, alwaysLoadedTokens: ALWAYS_LOADED_MAX + 1 }), "context").ok).toBe(false);
    expect(item(readiness({ ...base, cards: decided, delta: improved, alwaysLoadedTokens: undefined }), "context").ok).toBe(false);
    expect(item(readiness({ ...base, cards: decided, delta: improved }), "context").ok).toBe(true);
  });
  it("delivers what was verified or configured, nothing else", () => {
    expect((["verified", "configured", "installed", "failed", "approved", "deferred"] as const).map((status) => deliverable({ status }))).toEqual([true, true, false, false, false, false]);
  });
  it("reports what was measured, what waits for the client's environment, and what failed — without naming files that are not in the pull request", () => {
    const at = "2026-09-29T00:00:00.000Z";
    const arm = (runs: number, passed: number) => ({ runs, passed, passK: passed === runs, passRate: passed / runs, meanCostUsd: 0.5, meanTurns: 10, blocked: false });
    const set: Component[] = [
      { ...cards[0]!, key: "ok_rule", kind: "rule", title_he: "שורה שאומתה", status: "verified", files: ["AGENTS.md"], validation: { how: "בדיקה", passed: true, detail: "", at } },
      { ...cards[0]!, key: "crm_mcp", kind: "mcp", title_he: "חיבור CRM", status: "configured", files: [], params: { server: "crm", url: "https://{org}.crm4.dynamics.com/api/mcp" }, validation: { how: "הגדרה", passed: true, detail: "דורש את הסביבה של הלקוח", at } },
      { ...cards[0]!, key: "bad_skill", kind: "skill", title_he: "skill שנכשל", status: "failed", files: [".claude/skills/bad/SKILL.md"], validation: { how: "frontmatter", passed: false, detail: "לא קיים כאן: x/y.cs", at } },
    ];
    const report = pullRequestReport({
      repoName: "Trade", cards: set, delta: null, branch: "ai/onboarding/abc", baselineSha: null,
      readiness: readiness({ cards: set, processes: [], trials: [], delta: null, reviewerOpen: 0, suppressed: [], firings: [], windowsOnly: false, hasRunner: false }),
      evalSummary: {
        tasks: [
          { key: "t1", title_he: "הוספת שדה", kind: "action", without: arm(2, 0), with: arm(2, 2), verdict: "improved", failureKinds: {} },
          { key: "t2", title_he: "הרצת בדיקות", kind: "action", without: arm(2, 1), with: arm(2, 1), verdict: "same", failureKinds: {} },
        ],
        components: [],
        totals: { tasks: 2, measured: 2, improved: 1, same: 1, worse: 0, unmeasured: 0, with: { passK: 1, meanCostUsd: 0.6, meanTurns: 9 }, without: { passK: 0, meanCostUsd: 0.5, meanTurns: 11 }, costChange: 0.2, spentUsd: 4.4 },
      },
    });
    expect(report).toContain("## מה נמדד");
    expect(report).toContain("| הוספת שדה | 0/2 | 2/2 | השתפר |");
    expect(report).toContain("1 השתפרו, 0 נפגעו, 1 ללא שינוי");
    expect(report).toContain("+20%");
    expect(report).toContain("## הוגדר, יחובר אצל הלקוח");
    expect(report).toContain('"url": "https://{org}.crm4.dynamics.com/api/mcp"');
    expect(report).toContain("## נבנה ונכשל באימות — לא נכלל");
    expect(report).toContain("skill שנכשל");
    expect(report).not.toContain(".claude/skills/bad/SKILL.md");
  });
  it("writes the pull request's report from the cards", () => {
    const decided: Component[] = cards.map((c, i) => (c.status === "proposed" ? { ...c, status: i % 2 ? "verified" : "declined", declineReason: i % 2 ? null : "לא עכשיו", validation: i % 2 ? { how: "בדיקה", passed: true, detail: "", at: "" } : null } : c));
    const report = pullRequestReport({ repoName: "Trade", cards: decided, delta: { before: { passed: 2, total: 5, costUsd: 1 }, after: { passed: 4, total: 5, costUsd: 0.8 }, costPerTaskChange: -0.2 }, readiness: readiness({ cards: decided, processes: [], trials: [], delta: null, reviewerOpen: 0, suppressed: [], firings: [], windowsOnly: true, hasRunner: false }), branch: "ai/onboarding/abc", baselineSha: "0123456789" });
    expect(report).toContain("## התקנתי");
    expect(report).toContain("## לא מומלץ כאן — ולמה");
    expect(report).toContain("2/5 → 4/5");
    expect(report).toContain("-20%");
    expect(report).toContain("Windows");
    expect(report).not.toMatch(/\{[a-z_]+\}/);
  });
});

describe("what the plan leaves out on evidence", () => {
  const seed = (key: string, kind: ComponentSeed["kind"], extra: Partial<ComponentSeed> = {}): ComponentSeed => ({ key, kind, family: "knowledge", risk: "reversible", source: "rule", sourceRef: "R", title_he: key, why_he: "כי", what_he: "מה", verifyHow_he: "איך", params: {}, ...extra });
  const tasks = [
    { key: "how_to_test", title_he: "איך מריצים בדיקות", exercises: { keys: ["tests_rule", "run_affected_tests_skill"] } },
    { key: "run_tests_report", title_he: "להריץ בדיקות", exercises: { keys: ["tests_rule", "local_gate_script"] } },
    { key: "where_to_add", title_he: "איפה מוסיפים", exercises: { keys: ["which_package_skill"] } },
  ];
  it("does not propose a knowledge card whose every measured task passed without it — and says which", () => {
    const baseline = [{ taskKey: "how_to_test", passed: true }, { taskKey: "run_tests_report", passed: true }, { taskKey: "where_to_add", passed: false }];
    const r = pruneByBaseline([seed("tests_rule", "rule"), seed("run_affected_tests_skill", "skill"), seed("which_package_skill", "skill"), seed("local_gate_script", "script"), seed("agents_md_from_profile", "scaffold")], tasks, baseline);
    expect(r.pruned.map((p) => p.key).sort()).toEqual(["run_affected_tests_skill", "tests_rule"]);
    expect(r.seeds.find((s) => s.key === "tests_rule")?.notRecommended).toBe(true);
    expect(r.seeds.find((s) => s.key === "tests_rule")?.why_he).toMatch(/נמדד בלי הרכיב/);
    // a task that failed keeps its card; a script (verification) is never pruned by knowledge; a card no task names is left alone
    expect(r.seeds.find((s) => s.key === "which_package_skill")?.notRecommended).toBeFalsy();
    expect(r.seeds.find((s) => s.key === "local_gate_script")?.notRecommended).toBeFalsy();
    expect(r.seeds.find((s) => s.key === "agents_md_from_profile")?.notRecommended).toBeFalsy();
  });
  it("keeps a card when one of its tasks failed in any run, and when nothing was measured", () => {
    const r = pruneByBaseline([seed("tests_rule", "rule")], tasks, [{ taskKey: "how_to_test", passed: true }, { taskKey: "how_to_test", passed: false }]);
    expect(r.pruned).toEqual([]);
    expect(pruneByBaseline([seed("tests_rule", "rule")], tasks, []).pruned).toEqual([]);
  });
  it("does not propose a process step's skill or agent where the repository documents its processes — unless the step fails today", () => {
    const docs = { docs: { readme: "README.md", readme_bytes: 12_000, docs_dir: true, docs_files: 20, adrs: [], contributing: ["CONTRIBUTING.md"], architecture_docs: [], license: [], changelog: [], license_kind: "MIT" } } as unknown as RepoProfile;
    const seeds = [
      seed("skill_release_bump", "skill", { source: "process", params: { reasons: [] } }),
      seed("agent_review_loom", "agent", { source: "process", params: { reasons: ["judgment"] } }),
      seed("skill_release_publish", "skill", { source: "process", params: { reasons: ["failsToday"] } }),
      seed("tests_rule", "rule"),
    ];
    const r = pruneDocumentedProcessSteps(seeds, docs);
    expect(r.pruned.sort()).toEqual(["agent_review_loom", "skill_release_bump"]);
    expect(r.seeds.find((s) => s.key === "skill_release_bump")?.why_he).toMatch(/CONTRIBUTING\.md/);
    expect(r.seeds.find((s) => s.key === "skill_release_publish")?.notRecommended).toBeFalsy();
    expect(r.seeds.find((s) => s.key === "tests_rule")?.notRecommended).toBeFalsy();
    const thin = { docs: { readme: "README.md", readme_bytes: 900, docs_dir: false, docs_files: 0, adrs: [], contributing: [], architecture_docs: [], license: [], changelog: [], license_kind: "" } } as unknown as RepoProfile;
    expect(pruneDocumentedProcessSteps(seeds, thin).pruned).toEqual([]);
  });
});
