import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyRules, doneCommands, factsOf, genDirs, hotMultiAuthor, loadRules, ruleContext, stackTags } from "./rules.ts";
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
    // 40 sensitive files by name (the research cut the list at 40), 20 of them app/web.config (left editable), plus the 2 files a secret was found in — 22, all of them.
    const deny = r.fired.find((f) => f.rule === "R10")!.components[0]!;
    expect(deny.title_he).toContain("22");
    const entries = deny.params.deny as string[];
    expect(entries).toContain("**/*.snk");
    expect(entries).toContain("Test/ParserTester/Program.cs");
    expect(entries.filter((e) => /(app|web)\.config$/i.test(e))).toEqual([]);
    for (const f of fixtures.altshuler_trade!.secrets.sensitive_files.filter((x) => !/(app|web)\.config$/i.test(x))) {
      expect(entries.includes(f) || entries.some((e) => e.startsWith("**/*.") && f.toLowerCase().endsWith(e.slice(4))), f).toBe(true);
    }
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

/**
 * The diagnosis facts added after the research (tools, tracked test
 * projects, own package commands, layout, a large generated file, packages
 * kept in git) on top of Trade's research diagnosis — each changes what a
 * rule answers, never whether the research's rules fire.
 */
describe("the rules on the facts the research did not have", () => {
  const trade = () => structuredClone(fixtures.altshuler_trade!);
  const card = (d: RepoProfile, rule: string, key: string) => applyRules(d).fired.find((f) => f.rule === rule)?.components.find((c) => c.key === key);

  it("R06: a file only for the packages with a command of their own; none when one command builds them all", () => {
    const none = trade();
    none.monorepo.own_commands = [];
    const no = card(none, "R06", "per_package_instructions")!;
    expect(no.notRecommended).toBe(true);
    expect(no.why_he).toBe("פקודה אחת לכל החבילות — שורה אחת מספיקה.");
    expect(String(card(none, "R06", "monorepo_rule")!.params.text)).toContain("one command builds them all, from the root");
    const some = trade();
    some.monorepo.own_commands = [{ dir: "Pcf/DuplicateDetection", build: "npm run build", test: null }];
    const yes = card(some, "R06", "per_package_instructions")!;
    expect(yes.notRecommended).toBeFalsy();
    expect(yes.params.packages).toEqual(["Pcf/DuplicateDetection"]);
    expect(yes.params.commands).toEqual([{ dir: "Pcf/DuplicateDetection", build: "npm run build", test: null }]);
    expect(String(card(some, "R06", "monorepo_rule")!.params.text)).toContain("Pcf/DuplicateDetection (`npm run build`)");
  });

  it("R06: which-package lists every package or none", () => {
    const d = trade();
    d.monorepo.packages = Array.from({ length: 67 }, (_, i) => `P/p${i}`);
    expect((card(d, "R06", "which_package_skill")!.params.packages as string[]).length).toBe(67);
    d.monorepo.packages_truncated = true;
    expect(card(d, "R06", "which_package_skill")!.params.packages).toEqual([]);
  });

  it("R11: with a build tool on the machine the line says how to build, and no runner is asked for", () => {
    const d = trade();
    d.environment.tools = { msbuild: null, dotnet: "C:/dotnet/dotnet.exe", dotnet_msbuild: "C:/dotnet/dotnet.exe" };
    d.windows_build.web_app_projects = 2;
    const keys = applyRules(d).fired.find((f) => f.rule === "R11")!.components.map((c) => c.key);
    expect(keys).toEqual(["windows_build_rule"]);
    const text = String(card(d, "R11", "windows_build_rule")!.params.text);
    expect(text).toContain("Class libraries build with `dotnet msbuild Altshuler.sln`");
    expect(text).toContain("Web Application projects need Visual Studio's MSBuild");
    expect(text).not.toMatch(/only on Windows|cannot build/i);
    d.environment.tools = { msbuild: "C:/VS/MSBuild.exe", dotnet: null };
    expect(String(card(d, "R11", "windows_build_rule")!.params.text)).toContain("`msbuild Altshuler.sln`");
    // no tool: the research's answer, runner and all
    d.environment.tools = { msbuild: null, dotnet: null };
    expect(applyRules(d).fired.find((f) => f.rule === "R11")!.components.map((c) => c.key)).toEqual(["cannot_build_here_rule", "windows_runner", "build_on_runner_skill"]);
  });

  it("R12: an MCP address with a placeholder is marked not deliverable", () => {
    const mcp = card(trade(), "R12", "dataverse_mcp")!;
    expect(mcp.params).toMatchObject({ placeholder: true, deliverable: false, url: "https://{org}.{region}.dynamics.com/api/mcp" });
  });

  it("R17 and R05: the scaffold and the gate get the tools, the tracked test projects and the layout", () => {
    const d = trade();
    d.environment.tools = { msbuild: null, dotnet: "d" };
    d.tests.projects = [];
    d.tests.commands = [];
    d.layout = { model_dirs: [], node_packages: ["Pcf/A", "Pcf/B"], unit_groups: [{ parent: "CrmEntryPoints/Plugins", members: ["CrmEntryPoints/Plugins/X", "CrmEntryPoints/Plugins/Y", "CrmEntryPoints/Plugins/Z"] }], small_source_files: [] };
    const agents = card(d, "R17", "agents_md_from_profile")!;
    expect(agents.params).toMatchObject({ template: "agents-md", tools: { dotnet: "d" }, sln: "Altshuler.sln", tests_projects: [], test_commands: [] });
    expect((agents.params.layout as { groups: unknown[] }).groups).toHaveLength(1);
    expect(agents.what_he).toContain("אין פרויקט בדיקות ב-git");
    expect(card(d, "R05", "local_gate_script")!.params).toMatchObject({ template: "local-gate", sln: "Altshuler.sln", tools: { dotnet: "d" }, tests: [] });
  });

  it("R20/R21: a linter only the sub-packages have is neither a root formatter nor 'no linter'", () => {
    const d = trade();
    d.lint_format = ["eslint (packages: Pcf/DuplicateDetection, Pcf/JsonParser)"];
    const rules = applyRules(d).fired.map((f) => f.rule);
    expect(rules).not.toContain("R20");
    expect(rules).not.toContain("R21");
  });

  it("R10/R25: every deny comes with a line saying the hidden files exist — a deny otherwise reads as 'missing'", () => {
    const d = trade();
    const dirs = card(d, "R25", "deny_binary_dirs")!;
    expect(dirs.params.deny).toEqual(["Read(**/packages/**)", "Read(**/bin/**)", "Read(**/obj/**)", "Read(**/.vs/**)", "Edit(**/packages/**)", "Edit(**/bin/**)", "Edit(**/obj/**)"]);
    const dirsLine = String(card(d, "R25", "deny_binary_dirs_rule")!.params.text);
    expect(dirsLine).toContain("`packages/`, `bin/`, `obj/` and `.vs/` are hidden from you by a deny rule");
    expect(dirsLine).toContain("a committed NuGet cache");
    expect(dirsLine).toContain("Never conclude they are missing or that packages were not restored");
    const filesLine = String(card(d, "R10", "deny_sensitive_files_rule")!.params.text);
    expect(filesLine).toContain("`**/*.snk`");
    expect(filesLine).toContain("and 2 more by name");
    // the line names patterns only — never a path a reader could go looking for
    expect(filesLine).not.toContain("Program.cs");
  });

  it("R25: a package folder kept in git is not gitignored", () => {
    expect(card(trade(), "R25", "gitignore_hygiene")!.params.entries).toEqual(["bin/", "obj/", ".vs/", "*.user", "*.suo"]);
    const d = trade();
    d.git.packages_committed = false;
    expect(card(d, "R25", "gitignore_hygiene")!.params.entries).toContain("packages/");
  });

  it("R32: one file for the PCF controls, naming the folders that hold their package.json; nothing without them", () => {
    const d = trade();
    expect(card(d, "R32", "per_area_instructions")).toBeUndefined();
    d.layout = { model_dirs: [], node_packages: ["Pcf/DuplicateDetection", "Pcf/JsonParser"], unit_groups: [], small_source_files: [] };
    expect(card(d, "R32", "per_area_instructions")!.params.areas).toEqual([{ dir: "Pcf", toolchain: "node", command: "npm run build", cwds: ["Pcf/DuplicateDetection", "Pcf/JsonParser"] }]);
    expect(String(card(d, "R32", "pcf_toolchain_rule")!.params.text)).toContain("`Pcf/DuplicateDetection/`");
  });

  it("R01: one large generated file is guarded by its path", () => {
    const d = trade();
    d.generated_code.header_files = [{ path: "Shared/DataModel/Crm/Alt.DataModel.Crm/Entities/Entities.cs", lines: 98000 }];
    expect(genDirs(d)).toContain("Shared/DataModel/Crm/Alt.DataModel.Crm/Entities/Entities.cs");
    expect(card(d, "R01", "generated_paths_guard")!.params.paths).toContain("Shared/DataModel/Crm/Alt.DataModel.Crm/Entities/Entities.cs");
  });

  it("no hot spot from a history too short to have one", () => {
    const d = trade();
    d.git.hot_dirs = [{ dir: "Shared/Framework", changes: 1680, authors: 12 }];
    expect(hotMultiAuthor(d)).toBeNull();
    d.git.commits_analyzed = 200;
    expect(hotMultiAuthor(d)?.dir).toBe("Shared/Framework");
  });
});

describe("the CI commands 'done' is measured by", () => {
  it("prefers the test, build and lint runs, at most three, and never a line that depends on a workflow variable", () => {
    expect(doneCommands(["cargo hack test --each-feature", "cargo fuzz check --all-features", "cargo build --bin x", "cargo nextest run --features full", "cargo test --workspace --features $TOKIO_STABLE_FEATURES"])).toEqual(["cargo hack test --each-feature", "cargo fuzz check --all-features", "cargo build --bin x"]);
    expect(doneCommands(["docker login", "helm upgrade"])).toEqual(["docker login", "helm upgrade"]);
  });
});
