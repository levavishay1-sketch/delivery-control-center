import { describe, expect, it } from "vitest";
import { stageStatusTone, stageStatusLabel, STAGE_STATUS_TONES } from "@/lib/colors/stageStatus";

describe("stageStatusTone", () => {
  it("maps every known pipeline/stage/Constitution status to a defined tone", () => {
    for (const status of Object.keys(STAGE_STATUS_TONES)) {
      expect(stageStatusTone(status)).toBe(STAGE_STATUS_TONES[status]);
    }
  });

  it("falls back to inactive for an unrecognized status", () => {
    expect(stageStatusTone("SOME_FUTURE_STATUS")).toBe("inactive");
  });
});

describe("stageStatusLabel", () => {
  it("replaces underscores with spaces", () => {
    expect(stageStatusLabel("PENDING_APPROVAL")).toBe("PENDING APPROVAL");
    expect(stageStatusLabel("AWAITING_CLARIFICATION")).toBe("AWAITING CLARIFICATION");
  });

  it("leaves a status with no underscores unchanged", () => {
    expect(stageStatusLabel("DONE")).toBe("DONE");
  });
});
