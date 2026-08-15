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

  it("does not re-ask the same questions once clarifyAnswers is present, even if the marker is still in the description", async () => {
    // Regression test: the work item's description isn't cleared by answering — a redraft that
    // ignored clarifyAnswers and re-checked the marker would ask forever, never completing.
    const result = await mockExecutor.executeStage("CLARIFY", {
      ...baseContext,
      workItemDescription: "Reset flow. [NEEDS_CLARIFICATION: Which email provider? | Is SMS 2FA in scope?]",
      clarifyAnswers: [
        { question: "Which email provider?", answer: "SendGrid" },
        { question: "Is SMS 2FA in scope?", answer: "No" },
      ],
    });
    expect(result.clarifyQuestions).toBeUndefined();
    expect(result.content).toContain("No outstanding questions");
  });
});

describe("mockExecutor.executeStage(ANALYZE)", () => {
  it("returns an empty findings array and a clean-bill-of-health summary when the description has no marker", async () => {
    const result = await mockExecutor.executeStage("ANALYZE", baseContext);
    expect(result.analysisFindings).toEqual([]);
    expect(result.content).toContain("No consistency issues found");
  });

  it("returns structured findings when the description has the mock analysis marker", async () => {
    const result = await mockExecutor.executeStage("ANALYZE", {
      ...baseContext,
      workItemDescription:
        "Reset flow. [NEEDS_ANALYSIS_FINDING: CRITICAL:PLAN:Plan omits rollback steps | HIGH:TASKS:Task 3 duplicates Task 1]",
    });
    expect(result.analysisFindings).toEqual([
      { severity: "CRITICAL", relatedStageType: "PLAN", message: "Plan omits rollback steps" },
      { severity: "HIGH", relatedStageType: "TASKS", message: "Task 3 duplicates Task 1" },
    ]);
    expect(result.content).toContain("Plan omits rollback steps");
  });

  it("folds prior-stage content into the filled instructions when present", async () => {
    const withPriorStages = await mockExecutor.executeStage("ANALYZE", {
      ...baseContext,
      priorStagesContent: [
        { type: "SPEC", content: "# Spec\nUsers can reset their password." },
        { type: "PLAN", content: "# Plan\nAdd a reset endpoint." },
      ],
    });
    const withoutPriorStages = await mockExecutor.executeStage("ANALYZE", baseContext);
    expect(withPriorStages.promptTokens).toBeGreaterThan(withoutPriorStages.promptTokens);
  });
});

describe("mockExecutor.executeStage — redraft feedback (Task Group 9)", () => {
  it("folds a rejection comment into the filled instructions the mock drafts from", async () => {
    const withRejection = await mockExecutor.executeStage("PLAN", {
      ...baseContext,
      rejectionComment: "Missing a rollback plan for the migration step.",
    });
    const withoutRejection = await mockExecutor.executeStage("PLAN", baseContext);
    // The mock's cost/token estimate is derived from the filled instructions text, so folding
    // in the rejection comment should measurably increase the estimated prompt tokens.
    expect(withRejection.promptTokens).toBeGreaterThan(withoutRejection.promptTokens);
  });
});
