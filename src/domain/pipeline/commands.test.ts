import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { startPipeline } from "./commands";
import { createWorkItem } from "@/domain/work-item/commands";
import type { AuthContext } from "@/domain/shared/context";
import { ConflictError, ValidationError } from "@/domain/shared/errors";

/**
 * Integration tests against a real local Postgres — same rationale as the
 * other domain test suites in this project.
 */

let clientId: string;
let projectId: string;
let managerUserId: string;
let managerCtx: AuthContext;

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
});

afterAll(async () => {
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
