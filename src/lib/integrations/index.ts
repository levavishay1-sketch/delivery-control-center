import type { IntegrationType } from "@/generated/prisma/client";
import type { IntegrationAdapter } from "./types";
import { manualAdapter } from "./manual";
import { jiraAdapter } from "./jira";
import { ValidationError } from "@/domain/shared/errors";

const adapters: Partial<Record<IntegrationType, IntegrationAdapter>> = {
  MANUAL: manualAdapter,
  JIRA: jiraAdapter,
  // No AZURE_DEVOPS adapter exists yet — deliberately absent rather than aliased to manual,
  // so a sync attempt fails loudly instead of silently doing the wrong thing.
};

export function getIntegrationAdapter(type: IntegrationType): IntegrationAdapter {
  const adapter = adapters[type];
  if (!adapter) {
    throw new ValidationError(`The ${type} integration is not yet available.`);
  }
  return adapter;
}

export type { IntegrationAdapter, FetchedWorkItem } from "./types";
