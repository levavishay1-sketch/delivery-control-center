import type { IntegrationType } from "@/generated/prisma/client";
import type { IntegrationAdapter } from "./types";
import { manualAdapter } from "./manual";
import { jiraAdapter } from "./jira";
import { azureDevOpsAdapter } from "./azureDevOps";
import { githubAdapter } from "./github";
import { ValidationError } from "@/domain/shared/errors";
import { encryptSecret, decryptSecret } from "@/domain/shared/crypto";

/** Which keys inside a project's integrationConfig are credentials, per integration type. */
const SECRET_FIELDS: Partial<Record<IntegrationType, string[]>> = {
  JIRA: ["apiToken"],
  AZURE_DEVOPS: ["pat", "webhookSecret"],
  GITHUB: ["token", "webhookSecret"],
};

/** Encrypts the credential fields of an integrationConfig before it's written to the DB. Non-secret fields pass through untouched. */
export function encryptIntegrationConfig(
  type: IntegrationType,
  config: Record<string, unknown> | null | undefined
): Record<string, unknown> | null | undefined {
  if (!config) return config;
  const secretFields = SECRET_FIELDS[type];
  if (!secretFields?.length) return config;
  const result = { ...config };
  for (const field of secretFields) {
    if (typeof result[field] === "string" && result[field]) {
      result[field] = encryptSecret(result[field]);
    }
  }
  return result;
}

/** Decrypts the credential fields of an integrationConfig for actual use (e.g. calling an external API). */
export function decryptIntegrationConfig(
  type: IntegrationType,
  config: Record<string, unknown> | null | undefined
): Record<string, unknown> | null | undefined {
  if (!config) return config;
  const secretFields = SECRET_FIELDS[type];
  if (!secretFields?.length) return config;
  const result = { ...config };
  for (const field of secretFields) {
    if (typeof result[field] === "string" && result[field]) {
      result[field] = decryptSecret(result[field]);
    }
  }
  return result;
}

const adapters: Partial<Record<IntegrationType, IntegrationAdapter>> = {
  MANUAL: manualAdapter,
  JIRA: jiraAdapter,
  AZURE_DEVOPS: azureDevOpsAdapter,
  GITHUB: githubAdapter,
};

export function getIntegrationAdapter(type: IntegrationType): IntegrationAdapter {
  const adapter = adapters[type];
  if (!adapter) {
    throw new ValidationError(`The ${type} integration is not yet available.`);
  }
  return adapter;
}

export type { IntegrationAdapter, FetchedWorkItem } from "./types";
