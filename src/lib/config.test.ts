import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getStageConfig, loadWorkflow } from "./config";

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
