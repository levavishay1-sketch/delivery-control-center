import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyRules } from "./rules.ts";
import { buildOrder, cardFromSeed, groupFor, mergeSeeds, pullRequestReport, readiness, seedsFromProcesses, seedsFromTrials } from "./components.ts";
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
    // 13 rules → 30 cards (the research counted 27; the port adds .gitattributes, .gitignore and the "no format hook" card)
    expect(cards.length).toBe(30);
    const by = (g: string) => cards.filter((c) => c.group === g).length;
    expect(by("not_recommended")).toBe(1);
    expect(by("auto")).toBeGreaterThan(5);
    expect(by("approval")).toBeGreaterThan(5);
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
    expect(r.items.map((x) => x.ok)).toEqual([true, false, false, false]);
    expect(r.honesty[0]).toContain("Windows");
  });
  it("is ready once everything is decided, measured and improved", () => {
    const decided: Component[] = cards.map((c) => (c.status === "proposed" ? { ...c, status: "verified" } : c));
    const r = readiness({ cards: decided, processes: [], trials: [], delta: { before: { passed: 2, total: 5, costUsd: 1 }, after: { passed: 4, total: 5, costUsd: 0.9 }, costPerTaskChange: -0.1 }, reviewerOpen: 0, suppressed: [], firings: [], windowsOnly: false, hasRunner: false });
    expect(r.ready).toBe(true);
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
