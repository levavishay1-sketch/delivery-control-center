import type { IntegrationType } from "@/generated/prisma/client";

export interface FetchedWorkItem {
  externalId: string;
  externalUrl?: string;
  title: string;
  description?: string;
  status: string;
}

export interface IntegrationAdapter {
  type: IntegrationType;
  /** Pulls the current set of work items from the external system. `config` is Project.integrationConfig. */
  fetchWorkItems(config: Record<string, unknown> | null): Promise<FetchedWorkItem[]>;
}
