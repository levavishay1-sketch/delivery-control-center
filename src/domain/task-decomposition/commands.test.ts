import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { materializeTaskDrafts } from "./commands";
import { listTaskDraftsForStage } from "./queries";
import { draftStage, completeStageDraft, approveStage, rejectStage, getStageForDrafting, startPipeline } from "@/domain/pipeline/commands";
import { createWorkItem } from "@/domain/work-item/commands";
import type { AuthContext } from "@/domain/shared/context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/domain/shared/errors";

let clientId: string;
let projectId: string;
let managerCtx: AuthContext;
let viewerCtx: AuthContext;
const orgIds: string[] = [];
const draftedStageIds: string[] = [];

async function draft(ctx: AuthContext, stageId: string) {
  const stage = await draftStage(ctx, stageId);
  draftedStageIds.push(stageId);
  return stage;
}

/** Simulates what worker.ts's DRAFT_STAGE handler does, without running the poll loop. */
async function runStageDraftJob(stageId: string, content: string, taskDrafts?: { title: string; description?: string }[]) {
  const stage = await getStageForDrafting(stageId);
  expect(stage.pipeline).not.toBeNull();
  return completeStageDraft(stageId, {
    content,
    aiModel: "mock-agent-v1",
    promptTokens: 10,
    completionTokens: 20,
    costUsd: 0.001,
    taskDrafts,
  });
}

/** Drives a fresh WorkItem's pipeline through SPEC -> CLARIFY -> PLAN -> TASKS, leaving TASKS DONE (approved) with the given task drafts. */
async function driveToApprovedTasksStage(title: string, taskDrafts: { title: string; description?: string }[]) {
  const { workItem } = await createWorkItem(managerCtx, { projectId, title });
  const pipeline = await startPipeline(managerCtx, workItem.id);

  const specStage = await db.stage.findUniqueOrThrow({ where: { pipelineId_type: { pipelineId: pipeline.id, type: "SPEC" } } });
  await draft(managerCtx, specStage.id);
  await runStageDraftJob(specStage.id, "# Spec");
  await approveStage(managerCtx, specStage.id);

  const clarifyStage = await db.stage.findUniqueOrThrow({ where: { pipelineId_type: { pipelineId: pipeline.id, type: "CLARIFY" } } });
  await draft(managerCtx, clarifyStage.id);
  await runStageDraftJob(clarifyStage.id, "# Clarify — no questions");

  const planStage = await db.stage.findUniqueOrThrow({ where: { pipelineId_type: { pipelineId: pipeline.id, type: "PLAN" } } });
  await draft(managerCtx, planStage.id);
  await runStageDraftJob(planStage.id, "# Plan");
  await approveStage(managerCtx, planStage.id);

  const tasksStage = await db.stage.findUniqueOrThrow({ where: { pipelineId_type: { pipelineId: pipeline.id, type: "TASKS" } } });
  await draft(managerCtx, tasksStage.id);
  await runStageDraftJob(tasksStage.id, "# Tasks", taskDrafts);
  await approveStage(managerCtx, tasksStage.id);

  return { workItem, pipeline, tasksStage };
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Task Decomposition Test Org", slug: `task-decomp-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Task Decomposition Test Client", slug: "task-decomp" } });
  clientId = client.id;

  const project = await db.project.create({
    data: { clientId, name: "Task Decomposition Test Project", key: `TDP${Date.now().toString(36).toUpperCase()}` },
  });
  projectId = project.id;
  await db.constitution.create({
    data: { projectId, version: 1, status: "APPROVED", content: "# Constitution", approvedAt: new Date() },
  });

  const manager = await db.user.create({ data: { email: `task-decomp-manager-${Date.now()}@test.local`, name: "Task Decomp Manager" } });
  managerCtx = { userId: manager.id, displayName: "Task Decomp Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });

  const viewer = await db.user.create({ data: { email: `task-decomp-viewer-${Date.now()}@test.local`, name: "Task Decomp Viewer" } });
  viewerCtx = { userId: viewer.id, displayName: "Task Decomp Viewer", isOrgAdmin: false, memberships: [{ clientId, role: "VIEWER" }] };
  await db.clientMembership.create({ data: { userId: viewer.id, clientId, role: "VIEWER" } });
});

afterAll(async () => {
  if (draftedStageIds.length > 0) {
    await db.job.deleteMany({
      where: { OR: draftedStageIds.map((id) => ({ idempotencyKey: { startsWith: `draft-stage-${id}-` } })) },
    });
  }
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

describe("completeStageDraft persisting TaskDraft rows", () => {
  it("persists structured task drafts on a successful TASKS draft", async () => {
    const { tasksStage } = await driveToApprovedTasksStage("Persist drafts", [
      { title: "Write the migration" },
      { title: "Wire the route", description: "Add the API endpoint" },
    ]);

    const drafts = await listTaskDraftsForStage(managerCtx, tasksStage.id);
    expect(drafts.map((d) => d.title)).toEqual(["Write the migration", "Wire the route"]);
    expect(drafts[1].description).toBe("Add the API endpoint");
  });

  it("replaces prior task drafts on redraft", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Redraft replaces" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const specStage = await db.stage.findUniqueOrThrow({ where: { pipelineId_type: { pipelineId: pipeline.id, type: "SPEC" } } });
    await draft(managerCtx, specStage.id);
    await runStageDraftJob(specStage.id, "# Spec");
    await approveStage(managerCtx, specStage.id);
    const clarifyStage = await db.stage.findUniqueOrThrow({ where: { pipelineId_type: { pipelineId: pipeline.id, type: "CLARIFY" } } });
    await draft(managerCtx, clarifyStage.id);
    await runStageDraftJob(clarifyStage.id, "# Clarify");
    const planStage = await db.stage.findUniqueOrThrow({ where: { pipelineId_type: { pipelineId: pipeline.id, type: "PLAN" } } });
    await draft(managerCtx, planStage.id);
    await runStageDraftJob(planStage.id, "# Plan");
    await approveStage(managerCtx, planStage.id);
    const tasksStage = await db.stage.findUniqueOrThrow({ where: { pipelineId_type: { pipelineId: pipeline.id, type: "TASKS" } } });

    await draft(managerCtx, tasksStage.id);
    await runStageDraftJob(tasksStage.id, "# Tasks v1", [{ title: "First draft task" }]);
    await rejectStage(managerCtx, tasksStage.id, "Needs more detail");
    await draft(managerCtx, tasksStage.id);
    await runStageDraftJob(tasksStage.id, "# Tasks v2", [{ title: "Second draft task" }]);

    const drafts = await listTaskDraftsForStage(managerCtx, tasksStage.id);
    expect(drafts.map((d) => d.title)).toEqual(["Second draft task"]);
  });
});

describe("materializeTaskDrafts", () => {
  it("creates a child WorkItem for each selected draft and marks it materialized", async () => {
    const { workItem, tasksStage } = await driveToApprovedTasksStage("Materialize selected", [
      { title: "Task A" },
      { title: "Task B" },
    ]);
    const drafts = await listTaskDraftsForStage(managerCtx, tasksStage.id);

    const created = await materializeTaskDrafts(managerCtx, tasksStage.id, { taskDraftIds: [drafts[0].id] });
    expect(created).toHaveLength(1);
    expect(created[0].title).toBe("Task A");
    expect(created[0].parentId).toBe(workItem.id);
    expect(created[0].type).toBe("TASK");

    const updatedDrafts = await listTaskDraftsForStage(managerCtx, tasksStage.id);
    expect(updatedDrafts.find((d) => d.title === "Task A")?.materializedWorkItemId).toBe(created[0].id);
    expect(updatedDrafts.find((d) => d.title === "Task B")?.materializedWorkItemId).toBeNull();
  });

  it("refuses to materialize from a TASKS stage that is not yet approved", async () => {
    const { workItem } = await createWorkItem(managerCtx, { projectId, title: "Not yet approved" });
    const pipeline = await startPipeline(managerCtx, workItem.id);
    const specStage = await db.stage.findUniqueOrThrow({ where: { pipelineId_type: { pipelineId: pipeline.id, type: "SPEC" } } });

    await expect(materializeTaskDrafts(managerCtx, specStage.id, { taskDraftIds: ["nonexistent"] })).rejects.toThrow(ValidationError);
  });

  it("refuses to re-materialize an already-materialized draft", async () => {
    const { tasksStage } = await driveToApprovedTasksStage("No double materialize", [{ title: "Only task" }]);
    const drafts = await listTaskDraftsForStage(managerCtx, tasksStage.id);

    await materializeTaskDrafts(managerCtx, tasksStage.id, { taskDraftIds: [drafts[0].id] });
    await expect(materializeTaskDrafts(managerCtx, tasksStage.id, { taskDraftIds: [drafts[0].id] })).rejects.toThrow(ValidationError);
  });

  it("refuses an unknown task draft id", async () => {
    const { tasksStage } = await driveToApprovedTasksStage("Unknown draft id", [{ title: "Only task" }]);
    await expect(materializeTaskDrafts(managerCtx, tasksStage.id, { taskDraftIds: ["nonexistent-id"] })).rejects.toThrow(NotFoundError);
  });

  it("refuses a read-only user", async () => {
    const { tasksStage } = await driveToApprovedTasksStage("Forbidden materialize", [{ title: "Only task" }]);
    const drafts = await listTaskDraftsForStage(managerCtx, tasksStage.id);
    await expect(materializeTaskDrafts(viewerCtx, tasksStage.id, { taskDraftIds: [drafts[0].id] })).rejects.toThrow(ForbiddenError);
  });
});
