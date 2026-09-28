import { describe, expect, it } from "vitest";
import { classifyCsproj, describeBuildPlan, planBuild } from "./build-recipe.ts";

const SDK = `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>`;
const LEGACY = `<Project ToolsVersion="15.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003"><PropertyGroup><TargetFrameworkVersion>v4.6.2</TargetFrameworkVersion></PropertyGroup></Project>`;
const AMBIGUOUS = `<Project><PropertyGroup><TargetFramework>net472</TargetFramework></PropertyGroup></Project>`;

describe("classifyCsproj", () => {
  it("reads an SDK-style project from its Sdk attribute", () => {
    expect(classifyCsproj(SDK, false)).toBe("sdk");
  });

  it("reads a legacy project from its ToolsVersion attribute", () => {
    expect(classifyCsproj(LEGACY, false)).toBe("legacy");
  });

  it("reads a legacy project from a sibling packages.config, even without ToolsVersion", () => {
    expect(classifyCsproj(AMBIGUOUS, true)).toBe("legacy");
  });

  it("defaults to sdk-style — the modern, common case — when neither marker is there", () => {
    expect(classifyCsproj(AMBIGUOUS, false)).toBe("sdk");
  });
});

// The shape of the real repository the build check first ran on.
const CORE = "Shared/DataModel/Crm/Alt.DataModel.Crm.Core/Alt.DataModel.Crm.Core.csproj";
const PLUGIN = "CrmEntryPoints/Plugins/Alt.Crm.Plugins.AuthorizationManagement/Alt.Crm.Plugins.AuthorizationManagement.csproj";
const WEB = "Client/Webresources/Alt.Client.Webresources/Alt.Client.Webresources.csproj";
const repo: Record<string, string> = {
  [CORE]: SDK,
  [PLUGIN]: LEGACY,
  "CrmEntryPoints/Plugins/Alt.Crm.Plugins.AuthorizationManagement/packages.config": "<packages />",
  [WEB]: LEGACY,
  "tools/site/package.json": JSON.stringify({ name: "site", scripts: { build: "vite build" } }),
  "tools/lint/package.json": JSON.stringify({ name: "lint-rules" }),
  "docs/guide.md": "",
};
const plan = (changed: string[], declared: string[] = [], msbuild: string | null = "/opt/msbuild/MSBuild.exe") =>
  planBuild({ dir: "/repo", files:Object.keys(repo), changed, declared, read: async (p) => repo[p] ?? null, msbuild });

describe("planBuild", () => {
  it("builds the project of each changed file, and the components named for the task", async () => {
    const p = await plan(["Shared/DataModel/Crm/Alt.DataModel.Crm.Core/Enums/ControlStageStatusCode.cs"], ["Alt.Crm.Plugins.AuthorizationManagement"]);
    expect(p.kind).toBe("build");
    if (p.kind !== "build") return;
    expect(p.recipes.map((r) => [r.tool, r.project])).toEqual([["dotnet", CORE], ["msbuild", PLUGIN]]);
  });

  it("builds a changed script inside a compiled web-resources project — no model involved", async () => {
    const p = await plan(["Client/Webresources/Alt.Client.Webresources/alt_/js/forms/AuthorizationManagementMain.js"]);
    expect(p.kind === "build" && p.recipes.map((r) => r.project)).toEqual([WEB]);
  });

  it("has nothing to build when the task changed no file — and says so", async () => {
    const p = await plan([], ["Alt.Crm.Plugins.AuthorizationManagement"]);
    expect(p).toEqual({ kind: "nothing", reason: expect.stringContaining("לא שינתה אף קובץ") });
    expect(describeBuildPlan(p)).toContain("אין מה לבנות");
  });

  it("has nothing to build when only files outside any compiled project changed", async () => {
    expect((await plan(["docs/guide.md"])).kind).toBe("nothing");
    expect((await plan(["tools/lint/rules.ts"])).kind).toBe("nothing");
  });

  it("builds a package with a build script with npm", async () => {
    const p = await plan(["tools/site/src/main.ts"]);
    expect(p.kind === "build" && p.recipes.map((r) => [r.tool, r.project])).toEqual([["npm", "tools/site/package.json"]]);
  });

  it("says it cannot, rather than guessing, when a changed source file is in no project it knows", async () => {
    const p = await plan(["services/api/main.go"]);
    expect(p).toEqual({ kind: "cannot", reason: expect.stringContaining("services/api/main.go") });
  });

  it("says it cannot when a legacy project needs a classic MSBuild this machine does not have", async () => {
    expect((await plan(["CrmEntryPoints/Plugins/Alt.Crm.Plugins.AuthorizationManagement/X.cs"], [], null)).kind).toBe("cannot");
  });

  it("notes a named component that is not in the repository, and builds the rest", async () => {
    const p = await plan(["Shared/DataModel/Crm/Alt.DataModel.Crm.Core/A.cs"], ["Alt.NoSuchThing"]);
    expect(p.kind === "build" && p.notes[0]).toContain("Alt.NoSuchThing");
  });
});
