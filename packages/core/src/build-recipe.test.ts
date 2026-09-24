import { describe, expect, it } from "vitest";
import { classifyCsproj } from "./build-recipe.ts";

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
