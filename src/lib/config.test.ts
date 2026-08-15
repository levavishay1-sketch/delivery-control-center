import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getStageConfig, loadAgents, loadWorkflow } from "./config";

const CONFIG_PATH = path.join(process.cwd(), "config", "workflow.yaml");

describe("loadWorkflow", () => {
  it("every requiresApproval: true stage in the real config has a non-empty approverRoles list", () => {
    for (const stage of loadWorkflow()) {
      if (stage.requiresApproval) {
        expect(stage.approverRoles, `${stage.type} requires approval but has no approverRoles`).toBeTruthy();
        expect(stage.approverRoles!.length).toBeGreaterThan(0);
      }
    }
  });

  it("MANAGER is included in every approval-gated stage's approverRoles, by convention", () => {
    for (const stage of loadWorkflow()) {
      if (stage.requiresApproval) {
        expect(stage.approverRoles).toContain("MANAGER");
      }
    }
  });

  it("rejects a config where a requiresApproval: true stage has no approverRoles", () => {
    const original = fs.readFileSync(CONFIG_PATH, "utf-8");
    try {
      fs.writeFileSync(
        CONFIG_PATH,
        "stages:\n  - type: SPEC\n    label: Spec\n    description: test\n    promptTemplate: spec.md\n    requiresApproval: true\n"
      );
      expect(() => loadWorkflow()).toThrow(/approverRoles/);
    } finally {
      fs.writeFileSync(CONFIG_PATH, original);
    }
  });

  it("getStageConfig(SPEC).approverRoles matches the configured list", () => {
    expect(getStageConfig("SPEC").approverRoles).toEqual(["PROJECT_MANAGER", "MANAGER"]);
  });
});

describe("loadAgents", () => {
  it("the real config has exactly one default agent", () => {
    const agents = loadAgents();
    expect(agents.filter((a) => a.isDefault)).toHaveLength(1);
  });

  it("rejects a config with zero default agents", () => {
    const original = fs.readFileSync(CONFIG_PATH, "utf-8");
    try {
      fs.writeFileSync(
        CONFIG_PATH,
        "stages:\n  - type: SPEC\n    label: Spec\n    description: test\n    promptTemplate: spec.md\n    requiresApproval: false\nagents:\n  - name: a\n    provider: mock\n    model: a\n"
      );
      expect(() => loadAgents()).toThrow(/exactly one agent/);
    } finally {
      fs.writeFileSync(CONFIG_PATH, original);
    }
  });

  it("rejects a config with multiple default agents", () => {
    const original = fs.readFileSync(CONFIG_PATH, "utf-8");
    try {
      fs.writeFileSync(
        CONFIG_PATH,
        "stages:\n  - type: SPEC\n    label: Spec\n    description: test\n    promptTemplate: spec.md\n    requiresApproval: false\nagents:\n  - name: a\n    provider: mock\n    model: a\n    default: true\n  - name: b\n    provider: mock\n    model: b\n    default: true\n"
      );
      expect(() => loadAgents()).toThrow(/exactly one agent/);
    } finally {
      fs.writeFileSync(CONFIG_PATH, original);
    }
  });

  it("rejects a config with no agents registry at all", () => {
    const original = fs.readFileSync(CONFIG_PATH, "utf-8");
    try {
      fs.writeFileSync(
        CONFIG_PATH,
        "stages:\n  - type: SPEC\n    label: Spec\n    description: test\n    promptTemplate: spec.md\n    requiresApproval: false\n"
      );
      expect(() => loadAgents()).toThrow(/at least one agent/);
    } finally {
      fs.writeFileSync(CONFIG_PATH, original);
    }
  });
});
