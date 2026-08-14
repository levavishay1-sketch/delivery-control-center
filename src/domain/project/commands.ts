import { db } from "@/lib/db";
import type { IntegrationType, Prisma } from "@/generated/prisma/client";

export interface CreateProjectInput {
  name: string;
  key: string;
  integrationType?: IntegrationType;
  integrationConfig?: Record<string, unknown>;
}

export async function createProject(input: CreateProjectInput) {
  return db.project.create({
    data: {
      name: input.name,
      key: input.key,
      integrationType: input.integrationType ?? "MANUAL",
      integrationConfig: input.integrationConfig as Prisma.InputJsonValue | undefined,
    },
  });
}
