import { z } from "zod";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { createProject } from "@/domain/project/commands";
import { createWorkItem } from "@/domain/work-item/commands";
import { getProjectById } from "@/domain/project/queries";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";

const workItemTypeSchema = z.enum(["PROJECT", "TASK", "BUG", "CHANGE"]);

const createRequirementSchema = z.object({
  clientId: z.string().min(1),
  type: workItemTypeSchema.optional(),
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).optional(),
  projectId: z.string().min(1).optional(),
});

export type CreateRequirementInput = z.infer<typeof createRequirementSchema>;

const updateRequirementSchema = z.object({
  type: workItemTypeSchema.optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10_000).optional(),
});

export type UpdateRequirementInput = z.infer<typeof updateRequirementSchema>;

/** Creates a Requirement — standalone, or linked to one of the client's existing Projects. */
export async function createRequirement(ctx: AuthContext, rawInput: CreateRequirementInput) {
  const input = createRequirementSchema.parse(rawInput);
  requireClientRole(ctx, input.clientId, WRITE_ROLES);

  if (input.projectId) {
    const project = await getProjectById(input.projectId);
    if (!project || project.clientId !== input.clientId) {
      throw new ValidationError("Project must belong to the same client.");
    }
  }

  return db.$transaction(async (tx) => {
    const created = await tx.requirement.create({
      data: {
        clientId: input.clientId,
        type: input.type ?? "TASK",
        title: input.title,
        description: input.description,
        projectId: input.projectId,
        createdByUserId: ctx.userId,
      },
    });
    await recordAuditEvent(tx, {
      projectId: input.projectId,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} created Requirement "${created.title}"`,
      detail: { requirementId: created.id, clientId: input.clientId },
    });
    return created;
  });
}

async function requireOpenRequirement(ctx: AuthContext, id: string) {
  const requirement = await db.requirement.findUnique({ where: { id } });
  if (!requirement) throw new NotFoundError("Requirement not found");
  requireClientRole(ctx, requirement.clientId, WRITE_ROLES);
  if (requirement.status !== "OPEN") {
    throw new ValidationError(`Requirement is ${requirement.status}, not OPEN.`);
  }
  return requirement;
}

/** Updates a Requirement's type/title/description. Refuses once it has left OPEN status. */
export async function updateRequirement(ctx: AuthContext, id: string, rawInput: UpdateRequirementInput) {
  const input = updateRequirementSchema.parse(rawInput);
  const existing = await requireOpenRequirement(ctx, id);

  return db.$transaction(async (tx) => {
    const updated = await tx.requirement.update({
      where: { id },
      data: { type: input.type, title: input.title, description: input.description },
    });
    await recordAuditEvent(tx, {
      projectId: existing.projectId ?? undefined,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} updated Requirement "${updated.title}"`,
      detail: { requirementId: id, ...rawInput },
    });
    return updated;
  });
}

/** Declines an open Requirement. Refuses once it has left OPEN status. */
export async function declineRequirement(ctx: AuthContext, id: string) {
  const existing = await requireOpenRequirement(ctx, id);

  return db.$transaction(async (tx) => {
    const updated = await tx.requirement.update({ where: { id }, data: { status: "DECLINED" } });
    await recordAuditEvent(tx, {
      projectId: existing.projectId ?? undefined,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} declined Requirement "${existing.title}"`,
      detail: { requirementId: id },
    });
    return updated;
  });
}

/** Turns a title into a short, unique-per-client Project key (e.g. "Improve onboarding flow" -> "IMP", "IMP2" on collision). */
async function generateProjectKey(clientId: string, title: string): Promise<string> {
  const base = (title.match(/[a-zA-Z0-9]+/g) ?? ["PRJ"]).join("").slice(0, 6).toUpperCase() || "PRJ";
  let candidate = base;
  let suffix = 1;
  while (await db.project.findUnique({ where: { clientId_key: { clientId, key: candidate } } })) {
    suffix += 1;
    candidate = `${base}${suffix}`;
  }
  return candidate;
}

/**
 * SDD Activation gate (design.md decision 2): resolves a Project (creating one if the
 * Requirement is standalone), creates a root WorkItem of the Requirement's type under it, and
 * moves the Requirement to SDD_ACTIVE — reusing createProject/createWorkItem verbatim rather
 * than duplicating their logic. Deliberately does NOT call startPipeline: a freshly created
 * Project has no approved Constitution yet, so Pipeline start stays the existing, separate,
 * Constitution-gated action on the resulting WorkItem.
 */
export async function startSddForRequirement(ctx: AuthContext, id: string) {
  const requirement = await requireOpenRequirement(ctx, id);

  let projectId = requirement.projectId;
  if (!projectId) {
    const key = await generateProjectKey(requirement.clientId, requirement.title);
    const project = await createProject(ctx, { clientId: requirement.clientId, name: requirement.title, key });
    projectId = project.id;
  }

  const { workItem } = await createWorkItem(ctx, {
    projectId,
    title: requirement.title,
    description: requirement.description ?? undefined,
    type: requirement.type,
  });

  return db.$transaction(async (tx) => {
    const updated = await tx.requirement.update({
      where: { id },
      data: { projectId, workItemId: workItem.id, status: "SDD_ACTIVE" },
    });
    await recordAuditEvent(tx, {
      projectId,
      workItemId: workItem.id,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} started SDD for Requirement "${requirement.title}"`,
      detail: { requirementId: id, projectId, workItemId: workItem.id },
    });
    return updated;
  });
}
