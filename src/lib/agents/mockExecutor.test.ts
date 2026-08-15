import { describe, expect, it } from "vitest";
import { mockExecutor } from "./mockExecutor";

const baseContext = {
  workItemTitle: "Add password reset",
  workItemDescription: "Users need a self-service password reset flow.",
  workItemSource: "MANUAL",
  workItemExternalId: "manual-1",
};

describe("mockExecutor.executeStage(CLARIFY)", () => {
  it("returns normal content when the description has no clarification marker", async () => {
    const result = await mockExecutor.executeStage("CLARIFY", baseContext);
    expect(result.clarifyQuestions).toBeUndefined();
    expect(result.content).toContain("No outstanding questions");
  });

  it("returns structured questions when the description has the mock clarification marker", async () => {
    const result = await mockExecutor.executeStage("CLARIFY", {
      ...baseContext,
      workItemDescription: "Reset flow. [NEEDS_CLARIFICATION: Which email provider? | Is SMS 2FA in scope?]",
    });
    expect(result.clarifyQuestions).toEqual(["Which email provider?", "Is SMS 2FA in scope?"]);
    expect(result.content).toBe("");
  });

  it("folds prior clarify answers into the filled instructions when redrafting", async () => {
    const withAnswers = await mockExecutor.executeStage("CLARIFY", {
      ...baseContext,
      clarifyAnswers: [{ question: "Which email provider?", answer: "SendGrid" }],
    });
    // The mock's cost/token estimate is derived from the filled instructions text, so folding
    // in the answers should measurably increase the estimated prompt tokens versus the base case.
    const withoutAnswers = await mockExecutor.executeStage("CLARIFY", baseContext);
    expect(withAnswers.promptTokens).toBeGreaterThan(withoutAnswers.promptTokens);
  });
});
