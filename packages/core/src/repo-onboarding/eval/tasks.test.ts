import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RepoProfile } from "../types.ts";
import { commentLine, evalContext, evalTasksFor, exercised, globMatch, MAX_EVAL_TASKS, MIN_EVAL_TASKS } from "./tasks.ts";

/**
 * The bank on the eleven research diagnoses: every repository gets a set of
 * its own, filled from its facts, with no placeholder left and no grader
 * that resolved to nothing. Trade — the audit's case — gets the tasks its
 * facts call for, and more once the diagnosis carries the layout block.
 */

const DIR = fileURLToPath(new URL("../../../../../docs/research/sources/onboarding-v2/repos/diagnosis/", import.meta.url));
const fixtures = Object.fromEntries(readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(DIR + f, "utf8")) as RepoProfile]));
const trade = fixtures.altshuler_trade!;

describe("evalTasksFor", () => {
  it("gives every research repository a set of its own, between the floor and the cap", () => {
    for (const [name, p] of Object.entries(fixtures)) {
      const tasks = evalTasksFor(p);
      expect(tasks.length, name).toBeGreaterThanOrEqual(4);
      expect(tasks.length, name).toBeLessThanOrEqual(MAX_EVAL_TASKS);
      for (const t of tasks) {
        expect(t.prompt, `${name}/${t.key}`).not.toMatch(/\{[a-z_0-9]+\}/);
        expect(t.graders.length + (t.judge ? 1 : 0), `${name}/${t.key}`).toBeGreaterThan(0);
        for (const g of t.graders) if (g.type === "files_untouched" || g.type === "files_changed_within") expect(g.paths?.length, `${name}/${t.key}/${g.type}`).toBeGreaterThan(0);
      }
    }
    expect(MIN_EVAL_TASKS).toBeLessThanOrEqual(MAX_EVAL_TASKS);
  });

  it("Trade: a Windows-only, multi-package, Dataverse repository with generated code and a secret gets the tasks those facts call for", () => {
    const keys = evalTasksFor(trade).map((t) => t.key);
    expect(keys).toEqual(expect.arrayContaining(["build_honesty", "where_to_add", "generated_awareness", "external_schema", "edit_generated", "secret_file_edit", "deploy_refusal", "add_dependency", "commit_hygiene", "full_build_honesty"]));
    expect(keys).not.toContain("how_to_build");
    expect(keys).not.toContain("entry_points");
    // The build task no longer assumes the machine is Linux.
    expect(evalTasksFor(trade).find((t) => t.key === "build_honesty")!.prompt).not.toMatch(/linux/i);
  });

  it("Trade: the generated-code task guards the generated paths and the secret task names a real file with a secret", () => {
    const tasks = evalTasksFor(trade);
    const gen = tasks.find((t) => t.key === "edit_generated")!;
    expect(gen.graders.find((g) => g.type === "files_untouched")!.paths).toEqual(expect.arrayContaining(["Shared/DataModel/Crm/Alt.DataModel.Crm/EBG"]));
    expect(gen.prompt).toContain("Shared/DataModel/Crm/Alt.DataModel.Crm");
    const secret = tasks.find((t) => t.key === "secret_file_edit")!;
    expect(secret.prompt).toContain("Stuff/OneTimeConsole/Program.cs");
    const dep = tasks.find((t) => t.key === "add_dependency")!;
    expect(dep.prompt).toContain("Newtonsoft.Json");
    expect(dep.graders.find((g) => g.type === "diff_contains")!.pattern).toContain("HintPath");
  });

  it("the layout tasks appear once the diagnosis carries the layout block, and a process gives the process task", () => {
    const withLayout = { ...trade, layout: { model_dirs: ["Shared/DataModel/Crm/Alt.DataModel.Crm.Core/Contracts"], node_packages: ["Pcf/DuplicateDetection"], unit_groups: [{ parent: "CrmEntryPoints/Actions", members: ["CrmEntryPoints/Actions/Alt.Crm.Actions.Logger", "CrmEntryPoints/Actions/Alt.Crm.Actions.OTPManager", "CrmEntryPoints/Actions/Alt.Crm.Actions.SearchFiles"] }], small_source_files: ["BusinessLogicLayer/Crm/Alt.BusinessLogicLayer.Crm/SubjectsBL.cs"] } } as RepoProfile;
    const processes = [{ key: "add_crm_plugin", title: "Add a CRM plugin", source: "git" as const, evidence: [], trialTaskKey: null, impossible: null, steps: [
      { key: "write", title: "Write the plugin", what: "edit a class", agentTest: { judgment: false, externalInfo: false, readsALot: false, parallel: false, failsToday: false, why: "" }, decision: "none" as const, reason: "" },
      { key: "register", title: "Register it", what: "Plugin Registration Tool", agentTest: { judgment: true, externalInfo: true, readsALot: false, parallel: false, failsToday: false, why: "" }, decision: "agent" as const, reason: "" },
    ] }];
    const tasks = evalTasksFor(withLayout, processes);
    const keys = tasks.map((t) => t.key);
    expect(keys).toEqual(expect.arrayContaining(["add_model_field", "node_build", "new_unit", "typo_fix", "process_next_steps"]));
    expect(tasks.length).toBeGreaterThanOrEqual(MIN_EVAL_TASKS);
    expect(tasks.length).toBeLessThanOrEqual(MAX_EVAL_TASKS);
    const nodeBuild = tasks.find((t) => t.key === "node_build")!;
    expect(nodeBuild.graders.find((g) => g.type === "command_ran" && !g.negate)!.cwd).toBe("Pcf/DuplicateDetection");
    expect(nodeBuild.exercises.files).toContain("Pcf/DuplicateDetection/CLAUDE.md");
    const proc = tasks.find((t) => t.key === "process_next_steps")!;
    expect(proc.prompt).toContain("Add a CRM plugin");
    expect(proc.judge!.facts.length).toBe(2);
    expect(evalContext(withLayout, processes).example_unit_parent).toBe("CrmEntryPoints/Actions");
  });

  it("a task whose fact is missing does not fire, rather than asking with a hole in the prompt", () => {
    const noSecrets = { ...trade, secrets: { ...trade.secrets, files: [] } } as RepoProfile;
    expect(evalTasksFor(noSecrets).map((t) => t.key)).not.toContain("secret_file_edit");
  });
});

describe("exercised / globMatch", () => {
  const c = (key: string, kind: "rule" | "hook" | "skill", files: string[] = []) => ({ key, kind, family: "knowledge" as const, files });
  it("matches by key, prefix, kind and the files a component wrote", () => {
    const t = { exercises: { keys: ["generated_paths_rule"], prefixes: ["init_line"], kinds: ["hook" as const], files: ["Pcf/*/CLAUDE.md", "AGENTS.md"] } };
    expect(exercised(t, c("generated_paths_rule", "rule"))).toBe(true);
    expect(exercised(t, c("init_line_abc", "rule"))).toBe(true);
    expect(exercised(t, c("anything", "hook"))).toBe(true);
    expect(exercised(t, c("per_area", "skill", ["Pcf/DuplicateDetection/CLAUDE.md"]))).toBe(true);
    expect(exercised(t, c("agents_md", "skill", ["AGENTS.md", "CLAUDE.md"]))).toBe(true);
    expect(exercised(t, c("other", "skill", [".claude/skills/x/SKILL.md"]))).toBe(false);
  });
  it("globs: * within a segment, ** across, case-insensitive, slashes normalised", () => {
    expect(globMatch("Pcf/*/CLAUDE.md", "Pcf\\DuplicateDetection\\claude.md")).toBe(true);
    expect(globMatch("Pcf/*/CLAUDE.md", "Pcf/a/b/CLAUDE.md")).toBe(false);
    expect(globMatch("**/SKILL.md", ".claude/skills/x/SKILL.md")).toBe(true);
    expect(globMatch(".claude/hooks/*.mjs", ".claude/hooks/block-paths.mjs")).toBe(true);
  });
});

describe("the dependency probe", () => {
  it("asks a cargo workspace for a crate, never a Go module ('cargo' contains 'go')", () => {
    const rust = { ...trade, package_managers: ["cargo"], monorepo: { ...trade.monorepo, packages: ["tokio", "tokio-util", "benches"] } } as RepoProfile;
    const ctx = evalContext(rust);
    expect(ctx.dep_name).toBe("anyhow");
    expect(ctx.dep_target).toBe("tokio");
    const go = evalContext({ ...trade, package_managers: ["go"] } as RepoProfile);
    expect(go.dep_name).toBe("github.com/google/uuid");
  });
});

describe("a task's setup", () => {
  it("plants the typo the task is about, as a comment of the file's kind, and drops the task when the file is unknown", () => {
    expect(commentLine("src/a.cs", "TODO: x")).toBe("// TODO: x");
    expect(commentLine("scripts/run.py", "TODO: x")).toBe("# TODO: x");
    expect(commentLine("docs/readme.md", "TODO: x")).toBe("<!-- TODO: x -->");
    expect(commentLine("db/init.sql", "TODO: x")).toBe("-- TODO: x");
    const p = { ...trade, layout: { model_dirs: [], node_packages: [], unit_groups: [], small_source_files: ["BusinessLogicLayer/Crm/Alt.BusinessLogicLayer.Crm/SubjectsBL.cs"] } } as RepoProfile;
    const typo = evalTasksFor(p).find((t) => t.key === "typo_fix")!;
    expect(typo.setup).toMatchObject({ type: "append_comment", file: expect.stringMatching(/\.(cs|js|ts)$/), text: expect.stringContaining("recieve") });
    expect(typo.graders.some((g) => g.type === "diff_contains" && g.pattern === "receive the response and process it")).toBe(true);
  });
});
