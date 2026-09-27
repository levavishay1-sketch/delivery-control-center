import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { agentScore, capAgents, decideStep, gatherEvidence, interviewFor, parseProcesses, processesFromEvidence, resolveAnswers } from "./processes.ts";
import type { RepoProfile } from "./types.ts";

const DIR = fileURLToPath(new URL("../../../../docs/research/sources/onboarding-v2/repos/diagnosis/", import.meta.url));
const load = (n: string) => JSON.parse(readFileSync(`${DIR}${n}.json`, "utf8")) as RepoProfile;
const test = (o: Partial<{ judgment: boolean; externalInfo: boolean; readsALot: boolean; parallel: boolean; failsToday: boolean }> = {}) => ({ judgment: false, externalInfo: false, readsALot: false, parallel: false, failsToday: false, why: "", ...o });

describe("the interview", () => {
  it("asks at most four questions, each with a default, and only the ones the profile calls for", () => {
    const trade = interviewFor(load("altshuler_trade"));
    expect(trade.length).toBeLessThanOrEqual(4);
    expect(trade.map((q) => q.key)).toEqual(["tools", "forbidden_areas", "runner", "done_means"]);
    const cline = interviewFor(load("cline"));
    expect(cline.map((q) => q.key)).toContain("tools_existing");
    expect(cline.map((q) => q.key)).not.toContain("runner");
    for (const q of [...trade, ...cline]) expect(q.options.some((o) => o.value === q.default)).toBe(true);
  });

  it("records an unanswered question as an assumption, and refuses a value that is not an option", () => {
    const qs = interviewFor(load("altshuler_trade"));
    const a = resolveAnswers(qs, { runner: "yes", tools: "nonsense" });
    expect(a.find((x) => x.key === "runner")).toEqual({ key: "runner", value: "yes", assumed: false });
    expect(a.find((x) => x.key === "tools")).toEqual({ key: "tools", value: "claude", assumed: true });
  });
});

describe("the agent test", () => {
  it("any yes makes the step an agent, named for the reason", () => {
    expect(decideStep(test({ judgment: true }), false, "review").decision).toBe("agent");
    expect(decideStep(test({ externalInfo: true }), true, "look up the schema").reason).toContain("מידע");
  });
  it("a recurring procedure with no yes is a skill; a single action is nothing", () => {
    expect(decideStep(test(), true, "run DLaB, then update Entities.cs and the BL").decision).toBe("skill");
    expect(decideStep(test(), true, "open the file").decision).toBe("none");
    expect(decideStep(test(), false, "run the migration and regenerate").decision).toBe("none");
  });
});

describe("reading the model's answer", () => {
  it("keeps only well-formed processes, decides every step, and never throws on junk", () => {
    const raw = `Here you go:\n{"processes":[{"key":"add field","title":"Add a field to an entity","source":"git","evidence":["Entities.cs + Form.xml changed together 17 times"],"steps":[{"key":"dataverse","title":"Add the column in Dataverse","what":"Create the column in the Dataverse solution, then run DLaB","agentTest":{"judgment":false,"externalInfo":true,"readsALot":false,"parallel":false,"failsToday":false,"why":"the schema lives in the environment"}},{"title":"Regenerate Entities.cs","what":"Run DLaB and commit Entities.cs","agentTest":{}}]},{"title":"","steps":[]}]}`;
    const ps = parseProcesses(raw);
    expect(ps).toHaveLength(1);
    expect(ps[0]!.key).toBe("add_field");
    expect(ps[0]!.steps.map((s) => s.decision)).toEqual(["agent", "skill"]);
    expect(parseProcesses("not json")).toEqual([]);
    expect(parseProcesses('{"processes": "x"}')).toEqual([]);
  });
  it("marks a step as failing today when a trial task for it failed", () => {
    const raw = `{"processes":[{"key":"release","title":"Release","source":"ci","steps":[{"key":"tag","title":"Tag","what":"tag the commit","agentTest":{}}]}]}`;
    expect(parseProcesses(raw, new Set(["release.tag"]))[0]!.steps[0]!.decision).toBe("agent");
  });
});

describe("a generous model does not make every step an agent", () => {
  const step = (key: string, what: string, t: Partial<{ judgment: boolean; externalInfo: boolean; readsALot: boolean; parallel: boolean; failsToday: boolean }>) => ({ key, title: key, what, agentTest: test(t), decision: "agent" as const, reason: "" });
  const proc = (key: string, steps: ReturnType<typeof step>[]) => ({ key, title: key, source: "git" as const, evidence: ["x"], steps, trialTaskKey: null, impossible: null });
  it("keeps one agent per process — the strongest step — and turns the other candidates into skills or nothing", () => {
    const ps = capAgents([proc("p", [step("a", "run x then update y", { judgment: true }), step("b", "check", { failsToday: true, judgment: true }), step("c", "open", { readsALot: true })])]);
    expect(ps[0]!.steps.map((s) => s.decision)).toEqual(["skill", "agent", "none"]);
    expect(ps[0]!.steps[0]!.reason).toContain("סוכן אחד");
    expect(agentScore(test({ failsToday: true, judgment: true }))).toBe(5);
  });
  it("caps the run at four agents, keeping the strongest", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map((k, i) => proc(k, [step(`${k}1`, "run then update", { judgment: true, failsToday: i < 2, externalInfo: i < 5 })]));
    const ps = capAgents(many);
    expect(ps.flatMap((p) => p.steps).filter((s) => s.decision === "agent")).toHaveLength(4);
    expect(ps[5]!.steps[0]!.decision).toBe("skill");
  });
});

describe("evidence without a model", () => {
  it("names the history's change shapes and the CI as processes, with a skill each", () => {
    const ps = processesFromEvidence(load("cline"));
    expect(ps.length).toBeGreaterThan(1);
    expect(ps.some((p) => p.key === "verify_like_ci" && p.steps[0]!.decision === "skill")).toBe(true);
    expect(gatherEvidence(load("cline"), null).map((e) => e.source)).toEqual(expect.arrayContaining(["git", "ci"]));
    expect(processesFromEvidence(load("altshuler_trade"))).toEqual([]);
  });
});
