import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { answerClarifyQuestion } from "./commands";
import { createWorkItem } from "@/domain/work-item/commands";
import { startPipeline } from "@/domain/pipeline/commands";
import type { AuthContext } from "@/domain/shared/context";
import { ConflictError, ForbiddenError } from "@/domain/shared/errors";

/**
 * Integration tests against a real local Postgres — same rationale as the
 * other domain test suites in this project. Fixtures create a paused
 * CLARIFY stage directly (rather than driving the full draft flow) since
 * these tests are about answerClarifyQuestion's own pause/resume logic, not
 * the AI executor path (covered separately in pipeline/commands.test.ts and
 * lib/agents/mockExecutor.test.ts).
 */

let clientId: string;
let managerUserId: string;
let viewerUserId: string;
let managerCtx: AuthContext;
let viewerCtx: AuthContext;

const orgIds: string[] = [];
const stageIdsWithJobs: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Clarify Test Org", slug: `clarify-test-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Clarify Test Client", slug: "clarify-test" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `clarify-manager-${Date.now()}@test.local`, name: "Clarify Manager" } });
  managerUserId = manager.id;
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });

  const viewer = await db.user.create({ data: { email: `clarify-viewer-${Date.now()}@test.local`, name: "Clarify Viewer" } });
  viewerUserId = viewer.id;
  await db.clientMembership.create({ data: { userId: viewer.id, clientId, role: "VIEWER" } });

  managerCtx = { userId: managerUserId, displayName: "Clarify Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
  viewerCtx = { userId: viewerUserId, displayName: "Clarify Viewer", isOrgAdmin: false, memberships: [{ clientId, role: "VIEWER" }] };
});

afterAll(async () => {
  // answerClarifyQuestion can enqueue a real Job row that isn't reachable via any FK cascade.
  if (stageIdsWithJobs.length > 0) {
    await db.job.deleteMany({
      where: { OR: stageIdsWithJobs.map((id) => ({ idempotencyKey: { startsWith: `draft-stage-${id}-` } })) },
    });
  }
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

async function createPausedClarifyStage(questionTexts: string[]) {
  const project = await db.project.create({
    data: { clientId, name: `Clarify Fixture ${Date.now()}`, key: `CLZ${Date.now().toString(36).toUpperCase()}` },
  });
  await db.constitution.create({
    data: { projectId: project.id, version: 1, status: "APPROVED", content: "# Constitution", approvedAt: new Date() },
  });
  const { workItem } = await createWorkItem(managerCtx, { projectId: project.id, title: "Clarify fixture item" });
  const pipeline = await startPipeline(managerCtx, workItem.id);
  const firstStage = await db.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });
  const stage = await db.stage.update({ where: { id: firstStage.id }, data: { status: "AWAITING_CLARIFICATION" } });
  stageIdsWithJobs.push(stage.id);

  const questions = await Promise.all(
    questionTexts.map((question) => db.clarifyQuestion.create({ data: { stageId: stage.id, question } }))
  );
  return { stage, questions };
}

describe("answerClarifyQuestion", () => {
  it("answering the only outstanding question resumes drafting: stage -> AI_DRAFTING, job enqueued", async () => {
    const { stage, questions } = await createPausedClarifyStage(["Which email provider?"]);

    const { question, resumedDrafting } = await answerClarifyQuestion(managerCtx, questions[0].id, "SendGrid");
    expect(question.answer).toBe("SendGrid");
    expect(question.answeredByUserId).toBe(managerUserId);
    expect(question.answeredAt).not.toBeNull();
    expect(resumedDrafting).toBe(true);

    const reloadedStage = await db.stage.findUniqueOrThrow({ where: { id: stage.id } });
    expect(reloadedStage.status).toBe("AI_DRAFTING");

    const job = await db.job.findFirst({ where: { idempotencyKey: { startsWith: `draft-stage-${stage.id}-` } } });
    expect(job).not.toBeNull();
    expect(job!.type).toBe("DRAFT_STAGE");
    expect(job!.status).toBe("QUEUED");
  });

  it("answering one of two questions leaves the stage paused", async () => {
    const { stage, questions } = await createPausedClarifyStage(["Which email provider?", "Is SMS 2FA in scope?"]);

    const { resumedDrafting } = await answerClarifyQuestion(managerCtx, questions[0].id, "SendGrid");
    expect(resumedDrafting).toBe(false);

    const reloadedStage = await db.stage.findUniqueOrThrow({ where: { id: stage.id } });
    expect(reloadedStage.status).toBe("AWAITING_CLARIFICATION");

    const stillUnanswered = await db.clarifyQuestion.count({ where: { stageId: stage.id, answer: null } });
    expect(stillUnanswered).toBe(1);
  });

  it("answering the second (last) question resumes drafting", async () => {
    const { stage, questions } = await createPausedClarifyStage(["Which email provider?", "Is SMS 2FA in scope?"]);
    await answerClarifyQuestion(managerCtx, questions[0].id, "SendGrid");
    const { resumedDrafting } = await answerClarifyQuestion(managerCtx, questions[1].id, "No");
    expect(resumedDrafting).toBe(true);

    const reloadedStage = await db.stage.findUniqueOrThrow({ where: { id: stage.id } });
    expect(reloadedStage.status).toBe("AI_DRAFTING");
  });

  it("rejects answering an already-answered question", async () => {
    const { questions } = await createPausedClarifyStage(["Which email provider?"]);
    await answerClarifyQuestion(managerCtx, questions[0].id, "SendGrid");
    await expect(answerClarifyQuestion(managerCtx, questions[0].id, "Mailgun")).rejects.toThrow(ConflictError);
  });

  it("rejects a Viewer answering (write role required)", async () => {
    const { questions } = await createPausedClarifyStage(["Which email provider?"]);
    await expect(answerClarifyQuestion(viewerCtx, questions[0].id, "SendGrid")).rejects.toThrow(ForbiddenError);
  });

  it("survives a simulated process restart: re-fetching from Postgres mid-pause shows unchanged state", async () => {
    const { stage, questions } = await createPausedClarifyStage(["Which email provider?", "Is SMS 2FA in scope?"]);
    await answerClarifyQuestion(managerCtx, questions[0].id, "SendGrid");

    // Simulate a restart: nothing kept in memory, just re-fetch from Postgres directly — the
    // whole point of persisting the pause as ordinary rows (design.md Decision 2).
    const restarted = await db.stage.findUniqueOrThrow({ where: { id: stage.id }, include: { clarifyQuestions: true } });
    expect(restarted.status).toBe("AWAITING_CLARIFICATION");
    expect(restarted.clarifyQuestions.find((q) => q.id === questions[0].id)?.answer).toBe("SendGrid");
    expect(restarted.clarifyQuestions.find((q) => q.id === questions[1].id)?.answer).toBeNull();
  });
});
