import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import {
  approveStage,
  completeStageDraft,
  draftStage,
  getStageForDrafting,
  rejectStage,
  revertStageDraftFailure,
  startPipeline,
} from "./commands";
import { createWorkItem } from "@/domain/work-item/commands";
import type { AuthContext } from "@/domain/shared/context";
import { ConflictError, ForbiddenError, ValidationError } from "@/domain/shared/errors";

/**
 * Integration tests against a real local Postgres — same rationale as the
 * other domain test suites in this project.
 */

let clientId: string;
let projectId: string;
let managerUserId: string;
let managerCtx: AuthContext;
let projectManagerCtx: AuthContext;
let techLeadCtx: AuthContext;
let executorCtx: AuthContext;

async function createProjectWithApprovedConstitution(name: string) {
  const project = await db.project.create({
    data: { clientId, name, key: `${name.replace(/[^A-Z]/gi, "").slice(0, 6).toUpperCase()}${Date.now().toString(36).toUpperCase()}` },
  });
  await db.constitution.create({
    data: { projectId: project.id, version: 1, status: "APPROVED", content: "# Constitution", approvedAt: new Date() },
  });
  return project;
}

const orgIds: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Pipeline Test Org", slug: `pipeline-test-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Pipeline Test Client", slug: "pipeline-test" } });
  clientId = client.id;

  const project = await db.project.create({
    data: { clientId, name: "Pipeline Test Project", key: `PIP${Date.now().toString(36).toUpperCase()}` },
  });
  projectId = project.id;

  const manager = await db.user.create({ data: { email: `pipeline-manager-${Date.now()}@test.local`, name: "Pipeline Manager" } });
  managerUserId = manager.id;
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });

  managerCtx = { userId: managerUserId, displayName: "Pipeline Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };

  const projectManager = await db.user.create({ data: { email: `pipeline-pm-${Date.now()}@test.local`, name: "Pipeline PM" } });
  await db.clientMembership.create({ data: { userId: projectManager.id, clientId, role: "PROJECT_MANAGER" } });
  projectManagerCtx = { userId: projectManager.id, displayName: "Pipeline PM", isOrgAdmin: false, memberships: [{ clientId, role: "PROJECT_MANAGER" }] };

  const techLead = await db.user.create({ data: { email: `pipeline-tl-${Date.now()}@test.local`, name: "Pipeline Tech Lead" } });
  await db.clientMembership.create({ data: { userId: techLead.id, clientId, role: "TECH_LEAD" } });
  techLeadCtx = { userId: techLead.id, displayName: "Pipeline Tech Lead", isOrgAdmin: false, memberships: [{ clientId, role: "TECH_LEAD" }] };

  const executor = await db.user.create({ data: { email: `pipeline-exec-${Date.now()}@test.local`, name: "Pipeline Executor" } });
  await db.clientMembership.create({ data: { userId: executor.id, clientId, role: "EXECUTOR" } });
  executorCtx = { userId: executor.id, displayName: "Pipeline Executor", isOrgAdmin: false, memberships: [{ clientId, role: "EXECUTOR" }] };
});

const draftedStageIds: string[] = [];

afterAll(async () => {
  // draftStage enqueues a real Job row that isn't reachable via any FK cascade from
  // Organization/Project, so it has to be cleaned up explicitly.
  if (draftedStageIds.length > 0) {
    await db.job.deleteMany({
      where: { OR: draftedStageIds.map((id) => ({ idempotencyKey: { startsWith: `draft-stage-${id}-` } })) },
    });
  }
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe("startPipeline", () => {
  it("refuses to start when the project has no approved Constitution", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "No Constitution" });
    await expect(startPipeline(managerCtx, workItem.id)).rejects.toThrow(ValidationError);
  });

  it("creates a pipeline with a snapshotted stageSequence and the approved constitutionVersion", async () => {
    const project = await createProjectWithApprovedConstitution("Start Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Ready to start" });

    const pipeline = await startPipeline(managerCtx, workItem.id);
    expect(pipeline.constitutionVersion).toBe(1);
    expect(pipeline.stageSequence.length).toBeGreaterThan(0);
    expect(pipeline.currentStage).toBe(pipeline.stageSequence[0]);

    const stages = await db.stage.findMany({ where: { pipelineId: pipeline.id } });
    expect(stages).toHaveLength(1);
    expect(stages[0].type).toBe(pipeline.stageSequence[0]);
  });

  it("refuses to start a second pipeline for a work item that already has one", async () => {
    const project = await createProjectWithApprovedConstitution("Double Start Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Only one pipeline" });

    await startPipeline(managerCtx, workItem.id);
    await expect(startPipeline(managerCtx, workItem.id)).rejects.toThrow(ConflictError);
  });

  it("does not change an existing pipeline's stageSequence when workflow.yaml is edited afterward", async () => {
    const project = await createProjectWithApprovedConstitution("Config Edit Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Isolated from config edits" });

    const pipeline = await startPipeline(managerCtx, workItem.id);
    const originalSequence = pipeline.stageSequence;

    const configPath = path.join(process.cwd(), "config", "workflow.yaml");
    const originalConfig = fs.readFileSync(configPath, "utf-8");
    try {
      fs.writeFileSync(
        configPath,
        originalConfig +
          "\n  - type: IMPLEMENT\n    label: Implement (test-added)\n    description: test\n    promptTemplate: deploy.md\n    requiresApproval: false\n"
      );

      const reloaded = await db.pipeline.findUniqueOrThrow({ where: { id: pipeline.id } });
      expect(reloaded.stageSequence).toEqual(originalSequence);
    } finally {
      fs.writeFileSync(configPath, originalConfig);
    }
  });
});

/** Wraps draftStage so its enqueued Job row is tracked for afterAll cleanup. */
async function draft(ctx: AuthContext, stageId: string) {
  const stage = await draftStage(ctx, stageId);
  draftedStageIds.push(stageId);
  return stage;
}

/** Simulates what worker.ts's DRAFT_STAGE handler does, without running the poll loop. */
async function runStageDraftJob(stageId: string, content: string) {
  const stage = await getStageForDrafting(stageId);
  expect(stage.pipeline).not.toBeNull();
  return completeStageDraft(stageId, {
    content,
    aiModel: "mock-agent-v1",
    promptTokens: 10,
    completionTokens: 20,
    costUsd: 0.001,
  });
}

describe("draftStage / completeStageDraft / revertStageDraftFailure", () => {
  it("enqueues a DRAFT_STAGE job and returns the stage in AI_DRAFTING without drafting content synchronously", async () => {
    const project = await createProjectWithApprovedConstitution("Draft Job Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Draftable" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const firstStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    const drafting = await draft(managerCtx, firstStage.id);
    expect(drafting.status).toBe("AI_DRAFTING");
    expect(drafting.content).toBeNull();

    const job = await db.job.findFirst({ where: { idempotencyKey: { startsWith: `draft-stage-${firstStage.id}-` } } });
    expect(job).not.toBeNull();
    expect(job!.type).toBe("DRAFT_STAGE");
    expect(job!.status).toBe("QUEUED");
  });

  it("worker completion writes content, creates a StageVersion, and moves an approval-required stage to PENDING_APPROVAL", async () => {
    const project = await createProjectWithApprovedConstitution("Completion Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Completable" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const firstStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    await draft(managerCtx, firstStage.id);
    const completed = await runStageDraftJob(firstStage.id, "# Draft v1");

    expect(completed.status).toBe("PENDING_APPROVAL");
    expect(completed.content).toBe("# Draft v1");

    const versions = await db.stageVersion.findMany({ where: { stageId: firstStage.id }, orderBy: { versionNumber: "asc" } });
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNumber).toBe(1);
    expect(versions[0].content).toBe("# Draft v1");
    expect(versions[0].createdAsResultOf).toBe("DRAFT");
  });

  it("a redraft after rejection creates a second StageVersion (REDRAFT), preserving the first", async () => {
    const project = await createProjectWithApprovedConstitution("Redraft Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Redraftable" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const firstStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    await draft(managerCtx, firstStage.id);
    const firstDraft = await runStageDraftJob(firstStage.id, "# Draft v1");
    await rejectStage(managerCtx, firstDraft.id, "needs more detail");

    await draft(managerCtx, firstStage.id);
    const secondDraft = await runStageDraftJob(firstStage.id, "# Draft v2, addressing feedback");
    expect(secondDraft.content).toBe("# Draft v2, addressing feedback");

    const versions = await db.stageVersion.findMany({ where: { stageId: firstStage.id }, orderBy: { versionNumber: "asc" } });
    expect(versions).toHaveLength(2);
    expect(versions[0].createdAsResultOf).toBe("DRAFT");
    expect(versions[0].content).toBe("# Draft v1");
    expect(versions[1].createdAsResultOf).toBe("REDRAFT");
    expect(versions[1].content).toBe("# Draft v2, addressing feedback");
  });

  it("a redraft's recorded context (getStageForDrafting) includes the prior rejection comment", async () => {
    const project = await createProjectWithApprovedConstitution("Rejection Context Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Feeds rejection feedback forward" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const firstStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    await draft(managerCtx, firstStage.id);
    const firstDraft = await runStageDraftJob(firstStage.id, "# Draft v1");
    await rejectStage(managerCtx, firstDraft.id, "Missing a rollback plan for the migration step.");

    await draft(managerCtx, firstStage.id);
    // Same query the worker's DRAFT_STAGE handler uses to build executor context (Task Group 9) —
    // its most recent Approval row is the rejection that caused this redraft.
    const forDrafting = await getStageForDrafting(firstStage.id);
    expect(forDrafting.approvals).toHaveLength(1);
    expect(forDrafting.approvals[0].decision).toBe("REJECTED");
    expect(forDrafting.approvals[0].comment).toBe("Missing a rollback plan for the migration step.");
  });

  it("exhausted retries leave the stage REJECTED (visibly failed, not stuck) and block the pipeline", async () => {
    const project = await createProjectWithApprovedConstitution("Exhaustion Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Fails to draft" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const firstStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    await draft(managerCtx, firstStage.id);
    await revertStageDraftFailure(firstStage.id, "executor unavailable");

    const reverted = await db.stage.findUniqueOrThrow({ where: { id: firstStage.id } });
    expect(reverted.status).toBe("REJECTED");

    const reloadedPipeline = await db.pipeline.findUniqueOrThrow({ where: { id: pipeline.id } });
    expect(reloadedPipeline.status).toBe("BLOCKED");

    const events = await db.auditEvent.findMany({ where: { stageId: firstStage.id, actor: "SYSTEM" } });
    expect(events.some((e) => e.action.includes("exhausting retries"))).toBe(true);

    // Visibly failed, not stuck: the stage can be drafted again (REJECTED is a valid draftStage entry point).
    const redrafted = await draft(managerCtx, firstStage.id);
    expect(redrafted.status).toBe("AI_DRAFTING");
  });

  it("approveStage advances the pipeline to the next configured stage", async () => {
    const project = await createProjectWithApprovedConstitution("Advance Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Advances" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const firstStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });

    await draft(managerCtx, firstStage.id);
    const completed = await runStageDraftJob(firstStage.id, "# Draft");
    const advanced = await approveStage(managerCtx, completed.id);

    expect(advanced.currentStage).not.toBe(pipeline.stageSequence[0]);
    expect(advanced.stages.some((s) => s.type === advanced.currentStage)).toBe(true);
  });
});

describe("completeStageDraft with clarifyQuestions", () => {
  it("moves the stage to AWAITING_CLARIFICATION and records ClarifyQuestion rows instead of completing", async () => {
    const project = await createProjectWithApprovedConstitution("Clarify Completion Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Needs clarification" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const specStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id, type: "SPEC" } });

    // Advance to a CLARIFY-type stage the realistic way: draft+approve SPEC, which auto-creates
    // the pipeline's next configured stage (CLARIFY, per config/workflow.yaml).
    await draft(managerCtx, specStage.id);
    const completedSpec = await runStageDraftJob(specStage.id, "# Spec");
    await approveStage(managerCtx, completedSpec.id);
    const clarifyStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id, type: "CLARIFY" } });

    await draft(managerCtx, clarifyStage.id);
    const questions = ["Which email provider?", "Is SMS 2FA in scope?"];
    const paused = await completeStageDraft(clarifyStage.id, {
      content: "",
      aiModel: "mock-agent-v1",
      promptTokens: 5,
      completionTokens: 10,
      costUsd: 0.0001,
      clarifyQuestions: questions,
    });

    expect(paused.status).toBe("AWAITING_CLARIFICATION");
    expect(paused.content).toBeNull();

    const stored = await db.clarifyQuestion.findMany({ where: { stageId: clarifyStage.id }, orderBy: { createdAt: "asc" } });
    expect(stored.map((q) => q.question)).toEqual(questions);
    expect(stored.every((q) => q.answer === null)).toBe(true);

    const versions = await db.stageVersion.count({ where: { stageId: clarifyStage.id } });
    expect(versions).toBe(0);
  });

  it("a CLARIFY draft with no questions completes and auto-advances (requiresApproval: false)", async () => {
    const project = await createProjectWithApprovedConstitution("Clarify Auto-Advance Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "No clarification needed" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const specStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id, type: "SPEC" } });

    await draft(managerCtx, specStage.id);
    const completedSpec = await runStageDraftJob(specStage.id, "# Spec");
    await approveStage(managerCtx, completedSpec.id);
    const clarifyStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id, type: "CLARIFY" } });

    await draft(managerCtx, clarifyStage.id);
    const completed = await runStageDraftJob(clarifyStage.id, "# Clarify — nothing outstanding");

    expect(completed.status).toBe("DONE");

    const reloadedPipeline = await db.pipeline.findUniqueOrThrow({ where: { id: pipeline.id } });
    expect(reloadedPipeline.currentStage).toBe("PLAN");
  });
});

describe("completeStageDraft with analysisFindings", () => {
  /** Walks a fresh pipeline realistically through SPEC/CLARIFY/PLAN/TASKS up to ANALYZE. */
  async function reachAnalyzeStage(title: string) {
    const project = await createProjectWithApprovedConstitution(title);
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title });
    const pipeline = await startPipeline(managerCtx, workItem.id);

    const specStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id, type: "SPEC" } });
    await draft(managerCtx, specStage.id);
    const completedSpec = await runStageDraftJob(specStage.id, "# Spec");
    await approveStage(managerCtx, completedSpec.id);

    const clarifyStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id, type: "CLARIFY" } });
    await draft(managerCtx, clarifyStage.id);
    await runStageDraftJob(clarifyStage.id, "# Clarify — nothing outstanding");

    const planStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id, type: "PLAN" } });
    await draft(managerCtx, planStage.id);
    const completedPlan = await runStageDraftJob(planStage.id, "# Plan");
    await approveStage(managerCtx, completedPlan.id);

    const tasksStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id, type: "TASKS" } });
    await draft(managerCtx, tasksStage.id);
    const completedTasks = await runStageDraftJob(tasksStage.id, "# Tasks");
    await approveStage(managerCtx, completedTasks.id);

    const analyzeStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id, type: "ANALYZE" } });
    return { pipeline, planStage, tasksStage, analyzeStage };
  }

  it("records findings and auto-advances past ANALYZE when none are Critical", async () => {
    const { pipeline, analyzeStage } = await reachAnalyzeStage("Analyze Clean Project");

    await draft(managerCtx, analyzeStage.id);
    const completed = await completeStageDraft(analyzeStage.id, {
      content: "# Analyze",
      aiModel: "mock-agent-v1",
      promptTokens: 10,
      completionTokens: 20,
      costUsd: 0.001,
      analysisFindings: [{ severity: "INFO", message: "Looks fine", relatedStageType: "PLAN" }],
    });

    expect(completed.status).toBe("DONE");

    const findings = await db.analysisFinding.findMany({ where: { stageId: analyzeStage.id } });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("INFO");

    const reloadedPipeline = await db.pipeline.findUniqueOrThrow({ where: { id: pipeline.id } });
    expect(reloadedPipeline.currentStage).toBe("DEPLOY");
    expect(reloadedPipeline.status).toBe("ACTIVE");
  });

  it("a Critical finding marks ANALYZE REJECTED, blocks the pipeline, and does not advance", async () => {
    const { pipeline, analyzeStage } = await reachAnalyzeStage("Analyze Critical Project");

    await draft(managerCtx, analyzeStage.id);
    const completed = await completeStageDraft(analyzeStage.id, {
      content: "# Analyze",
      aiModel: "mock-agent-v1",
      promptTokens: 10,
      completionTokens: 20,
      costUsd: 0.001,
      analysisFindings: [{ severity: "CRITICAL", message: "Plan omits rollback", relatedStageType: "PLAN" }],
    });

    expect(completed.status).toBe("REJECTED");

    const reloadedPipeline = await db.pipeline.findUniqueOrThrow({ where: { id: pipeline.id } });
    expect(reloadedPipeline.status).toBe("BLOCKED");
    expect(reloadedPipeline.currentStage).toBe("ANALYZE");

    const findings = await db.analysisFinding.findMany({ where: { stageId: analyzeStage.id } });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("CRITICAL");
  });

  it("allows redrafting the DONE stage a Critical finding names, but refuses an unflagged DONE stage", async () => {
    const { planStage, tasksStage, analyzeStage } = await reachAnalyzeStage("Analyze Redraft Project");

    await draft(managerCtx, analyzeStage.id);
    await completeStageDraft(analyzeStage.id, {
      content: "# Analyze",
      aiModel: "mock-agent-v1",
      promptTokens: 10,
      completionTokens: 20,
      costUsd: 0.001,
      analysisFindings: [{ severity: "CRITICAL", message: "Plan omits rollback", relatedStageType: "PLAN" }],
    });

    // PLAN is DONE but named by the Critical finding above — allowed.
    const redraftedPlan = await draft(managerCtx, planStage.id);
    expect(redraftedPlan.status).toBe("AI_DRAFTING");

    // TASKS is DONE and not named by any finding — still refused.
    await expect(draft(managerCtx, tasksStage.id)).rejects.toThrow(/only PENDING or REJECTED/);
  });

  it("redrafting the flagged stage and re-running ANALYZE clean clears the block and advances, without disturbing downstream stages", async () => {
    const { pipeline, planStage, analyzeStage } = await reachAnalyzeStage("Analyze Resolve Project");

    await draft(managerCtx, analyzeStage.id);
    await completeStageDraft(analyzeStage.id, {
      content: "# Analyze",
      aiModel: "mock-agent-v1",
      promptTokens: 10,
      completionTokens: 20,
      costUsd: 0.001,
      analysisFindings: [{ severity: "CRITICAL", message: "Plan omits rollback", relatedStageType: "PLAN" }],
    });

    await draft(managerCtx, planStage.id);
    const redraftedPlan = await runStageDraftJob(planStage.id, "# Plan v2, with rollback steps");
    await approveStage(managerCtx, redraftedPlan.id);

    // Approving the flagged stage's redraft must not create a duplicate TASKS row or move
    // currentStage backward — the pipeline is still sitting at ANALYZE, blocked.
    const midPipeline = await db.pipeline.findUniqueOrThrow({ where: { id: pipeline.id } });
    expect(midPipeline.currentStage).toBe("ANALYZE");
    const tasksStages = await db.stage.findMany({ where: { pipelineId: pipeline.id, type: "TASKS" } });
    expect(tasksStages).toHaveLength(1);

    // ANALYZE itself is REJECTED — redraftable via the ordinary PENDING/REJECTED path.
    await draft(managerCtx, analyzeStage.id);
    const cleaned = await completeStageDraft(analyzeStage.id, {
      content: "# Analyze — clean",
      aiModel: "mock-agent-v1",
      promptTokens: 10,
      completionTokens: 20,
      costUsd: 0.001,
      analysisFindings: [],
    });

    expect(cleaned.status).toBe("DONE");
    const remainingFindings = await db.analysisFinding.findMany({ where: { stageId: analyzeStage.id } });
    expect(remainingFindings).toHaveLength(0);

    const finalPipeline = await db.pipeline.findUniqueOrThrow({ where: { id: pipeline.id } });
    expect(finalPipeline.currentStage).toBe("DEPLOY");
    expect(finalPipeline.status).toBe("ACTIVE");
  });
});

describe("role-based gate policy (approverRoles)", () => {
  it("a role listed in the stage type's approverRoles can approve it", async () => {
    const project = await createProjectWithApprovedConstitution("Gate PM Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "PM approves SPEC" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const specStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id, type: "SPEC" } });

    await draft(managerCtx, specStage.id);
    const completed = await runStageDraftJob(specStage.id, "# Spec");

    // SPEC's approverRoles ([PROJECT_MANAGER, MANAGER] in config/workflow.yaml) include PROJECT_MANAGER.
    const advanced = await approveStage(projectManagerCtx, completed.id);
    expect(advanced.currentStage).not.toBe("SPEC");
  });

  it("refuses a write-capable role that isn't listed in the stage type's approverRoles", async () => {
    const project = await createProjectWithApprovedConstitution("Gate Executor Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Executor cannot approve SPEC" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const specStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id, type: "SPEC" } });

    await draft(managerCtx, specStage.id);
    const completed = await runStageDraftJob(specStage.id, "# Spec");

    // EXECUTOR has general write access (WRITE_ROLES) but SPEC's approverRoles doesn't list it —
    // this is the exact distinction Task Group 8 introduces over the old uniform WRITE_ROLES check.
    await expect(approveStage(executorCtx, completed.id)).rejects.toThrow(ForbiddenError);
  });

  it("refuses a role permitted on one stage type when acting on a different stage type whose approverRoles doesn't include it", async () => {
    const project = await createProjectWithApprovedConstitution("Gate Cross-Stage Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "PM approves SPEC but not PLAN" });
    const pipeline = await startPipeline(managerCtx, workItem.id);

    const specStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id, type: "SPEC" } });
    await draft(managerCtx, specStage.id);
    const completedSpec = await runStageDraftJob(specStage.id, "# Spec");
    await approveStage(projectManagerCtx, completedSpec.id); // allowed — PROJECT_MANAGER is listed for SPEC

    const clarifyStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id, type: "CLARIFY" } });
    await draft(managerCtx, clarifyStage.id);
    await runStageDraftJob(clarifyStage.id, "# Clarify — nothing outstanding");

    const planStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id, type: "PLAN" } });
    await draft(managerCtx, planStage.id);
    const completedPlan = await runStageDraftJob(planStage.id, "# Plan");

    // PROJECT_MANAGER isn't in PLAN's approverRoles ([TECH_LEAD, MANAGER]) even though it was fine for SPEC.
    await expect(approveStage(projectManagerCtx, completedPlan.id)).rejects.toThrow(ForbiddenError);

    // TECH_LEAD is listed for PLAN and succeeds.
    const advanced = await approveStage(techLeadCtx, completedPlan.id);
    expect(advanced.currentStage).not.toBe("PLAN");
  });

  it("rejectStage is gated by the same approverRoles as approveStage", async () => {
    const project = await createProjectWithApprovedConstitution("Gate Reject Project");
    const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Reject gated by approverRoles" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const specStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id, type: "SPEC" } });

    await draft(managerCtx, specStage.id);
    const completed = await runStageDraftJob(specStage.id, "# Spec");

    await expect(rejectStage(executorCtx, completed.id)).rejects.toThrow(ForbiddenError);
    const rejected = await rejectStage(projectManagerCtx, completed.id, "needs rework");
    expect(rejected.status).toBe("REJECTED");
  });
});
