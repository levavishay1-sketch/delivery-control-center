import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyRules, factsOf, loadRules, ruleContext, stackTags } from "./rules.ts";
import type { RepoProfile } from "./types.ts";

/**
 * The acceptance test of the design (docs/research/repo-onboarding-recommendation.md §7):
 * the same rules on eleven deliberately different repositories give eleven
 * different component sets, and every component points at the fact that
 * justified it. The fixtures are the diagnoses the research produced.
 */
const DIR = fileURLToPath(new URL("../../../../docs/research/sources/onboarding-v2/repos/diagnosis/", import.meta.url));
const fixtures = Object.fromEntries(readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(DIR + f, "utf8")) as RepoProfile]));

describe("the rules over the eleven research diagnoses", () => {
  it("loads the same eleven repositories the research used", () => {
    expect(Object.keys(fixtures).sort()).toEqual(["altshuler_trade", "cline", "codex", "eshop", "fastapi-template", "gh-cli", "nowinandroid", "phpmyadmin", "pydatasci-handbook", "spring-petclinic", "terraform-aws-eks"]);
  });

  it("fires on Trade exactly the thirteen rules the research recorded", () => {
    const r = applyRules(fixtures.altshuler_trade!);
    expect(r.fired.map((f) => f.rule)).toEqual(["R01", "R05", "R06", "R09a", "R10", "R11", "R12", "R14", "R17", "R21", "R22b", "R25", "R32"]);
  });

  it("gives eleven distinct sets — the process is fixed, the result is not", () => {
    const sets = new Set(Object.values(fixtures).map((d) => applyRules(d).fired.map((f) => f.rule).join(",")));
    expect(sets.size).toBe(11);
  });

  it("matches the research's rule matrix for every repository", () => {
    const expected: Record<string, string[]> = {
      cline: ["R01", "R03", "R04", "R06", "R07", "R08", "R09a", "R10", "R14", "R15", "R16", "R20", "R22a", "R29"],
      codex: ["R01", "R03", "R04", "R06", "R07", "R09a", "R10", "R16", "R20", "R22a", "R23", "R28", "R29"],
      eshop: ["R01", "R03", "R04", "R06", "R07", "R08", "R10", "R13", "R17", "R20", "R29", "R30", "R31"],
      "fastapi-template": ["R01", "R03", "R04", "R06", "R08", "R10", "R13", "R20", "R23", "R30"],
      "gh-cli": ["R01", "R03", "R04", "R07", "R08", "R09b", "R16", "R20", "R22a", "R23", "R28", "R30"],
      nowinandroid: ["R03", "R04", "R06", "R07", "R08", "R16", "R20", "R22a", "R26", "R28", "R30"],
      phpmyadmin: ["R01", "R03", "R04", "R07", "R08", "R09b", "R13", "R17", "R20", "R22a", "R24", "R28", "R30"],
      "pydatasci-handbook": ["R02", "R05", "R07", "R17", "R18", "R21"],
      "spring-petclinic": ["R03", "R04", "R07", "R13", "R17", "R20", "R22a", "R23", "R27", "R28"],
      "terraform-aws-eks": ["R03", "R04", "R08", "R14", "R17", "R19", "R20", "R22a", "R28"],
    };
    for (const [name, rules] of Object.entries(expected)) expect(applyRules(fixtures[name]!).fired.map((f) => f.rule), name).toEqual(rules);
  });

  it("fills every reason and every card from the profile — no placeholder left", () => {
    for (const [name, d] of Object.entries(fixtures)) {
      for (const f of applyRules(d).fired) {
        expect(f.reason_he, `${name} ${f.rule}`).not.toMatch(/\{[a-z_0-9]+\}/);
        for (const c of f.components) {
          expect(c.title_he + c.what_he + c.why_he + c.verifyHow_he, `${name} ${c.key}`).not.toMatch(/\{[a-z_0-9]+\}/);
          expect(c.sourceRef).toBe(f.rule);
        }
      }
    }
  });

  it("holds a rule back when the person marked the fact it reads as wrong, and says which", () => {
    const d = fixtures.altshuler_trade!;
    const r = applyRules(d, [{ path: "windows_build.windows_only_build", note: "יש לנו מריץ", by: "u", at: "now" }]);
    expect(r.fired.map((f) => f.rule)).not.toContain("R11");
    expect(r.suppressed).toEqual([{ rule: "R11", fact: "windows_build.windows_only_build", note: "יש לנו מריץ" }]);
    // a correction on the parent holds back every rule under it
    const r2 = applyRules(d, [{ path: "secrets", note: null, by: "u", at: "now" }]);
    expect(r2.suppressed.map((s) => s.rule)).toEqual(["R09a", "R09b", "R10"]);
  });

  it("names Trade's evidence in words a manager reads", () => {
    const r = applyRules(fixtures.altshuler_trade!);
    const r11 = r.fired.find((f) => f.rule === "R11")!;
    expect(r11.reason_he).toContain("1 .sln");
    expect(r11.reason_he).toContain("58 .snk");
    const r06 = r.fired.find((f) => f.rule === "R06")!;
    expect(r06.reason_he).toContain("67");
    const deny = r.fired.find((f) => f.rule === "R10")!.components[0]!;
    expect(deny.title_he).toContain("40");
    expect((deny.params.deny as string[]).length).toBe(40);
  });

  it("every rule reads facts a correction can name", () => {
    for (const r of loadRules()) expect(factsOf(r.when).length, r.id).toBeGreaterThan(0);
  });

  it("derives stack tags from the profile, not from a list", () => {
    expect(stackTags(fixtures.altshuler_trade!)).toEqual(expect.arrayContaining(["c#", "dataverse-dynamics-365", "powerapps-pcf-control", "nuget"]));
    expect(stackTags(fixtures["terraform-aws-eks"]!)).toEqual(expect.arrayContaining(["terraform", "aws-sdk"]));
    expect(ruleContext(fixtures.cline!).mono_n).toBe(24);
  });
});
