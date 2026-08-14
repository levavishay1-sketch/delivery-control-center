import type { IntegrationType } from "@/generated/prisma/client";
import type { IntegrationAdapter } from "./types";
import { manualAdapter } from "./manual";
import { jiraAdapter } from "./jira";

const adapters: Record<IntegrationType, IntegrationAdapter> = {
  MANUAL: manualAdapter,
  JIRA: jiraAdapter,
  AZURE_DEVOPS: manualAdapter, // not implemented yet; falls back to manual entry
};

export function getIntegrationAdapter(type: IntegrationType): IntegrationAdapter {
  return adapters[type];
}

export type { IntegrationAdapter, FetchedWorkItem } from "./types";
