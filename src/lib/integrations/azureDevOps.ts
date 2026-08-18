import { timingSafeEqual } from "node:crypto";
import type { IntegrationAdapter } from "./types";

interface AzureDevOpsConfig {
  orgUrl: string;
  project: string;
  pat: string;
}

function resolveConfig(config: Record<string, unknown> | null): AzureDevOpsConfig {
  const orgUrl = (config?.orgUrl as string) || process.env.AZURE_DEVOPS_ORG_URL || "";
  const project = (config?.project as string) || process.env.AZURE_DEVOPS_PROJECT || "";
  const pat = (config?.pat as string) || process.env.AZURE_DEVOPS_PAT || "";
  if (!orgUrl || !project || !pat) {
    throw new Error(
      "Azure DevOps integration is not configured. Set AZURE_DEVOPS_ORG_URL, AZURE_DEVOPS_PROJECT and AZURE_DEVOPS_PAT (or the connector's config)."
    );
  }
  return { orgUrl, project, pat };
}

interface AzureDevOpsWorkItem {
  id: number;
  fields: {
    "System.Title": string;
    "System.Description"?: string;
    "System.State": string;
  };
}

/** Azure DevOps has no single "list work items" endpoint — a WIQL query returns matching ids, then a second call fetches their fields. */
export const azureDevOpsAdapter: IntegrationAdapter = {
  type: "AZURE_DEVOPS",
  async fetchWorkItems(config) {
    const { orgUrl, project, pat } = resolveConfig(config);
    const base = orgUrl.replace(/\/$/, "");
    const auth = Buffer.from(`:${pat}`).toString("base64");
    const headers = { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Accept: "application/json" };

    const wiqlRes = await fetch(`${base}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.1`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' ORDER BY [System.ChangedDate] DESC`,
      }),
    });
    if (!wiqlRes.ok) {
      throw new Error(`Azure DevOps sync failed: ${wiqlRes.status} ${wiqlRes.statusText} — ${await wiqlRes.text()}`);
    }
    const wiql = (await wiqlRes.json()) as { workItems: Array<{ id: number }> };
    const ids = wiql.workItems.map((w) => w.id);
    if (ids.length === 0) return [];

    const itemsRes = await fetch(
      `${base}/_apis/wit/workitems?ids=${ids.join(",")}&fields=System.Title,System.Description,System.State&api-version=7.1`,
      { headers }
    );
    if (!itemsRes.ok) {
      throw new Error(`Azure DevOps sync failed: ${itemsRes.status} ${itemsRes.statusText} — ${await itemsRes.text()}`);
    }
    const data = (await itemsRes.json()) as { value: AzureDevOpsWorkItem[] };

    return data.value.map((item) => ({
      externalId: String(item.id),
      externalUrl: `${base}/_workitems/edit/${item.id}`,
      title: item.fields["System.Title"],
      description: item.fields["System.Description"],
      status: item.fields["System.State"],
    }));
  },
};

/**
 * Verifies an Azure DevOps service hook request against its configured Basic-Auth-on-URL scheme
 * (Azure DevOps service hooks authenticate via a username/password baked into the webhook's own
 * "Basic authentication" fields, sent as a standard `Authorization: Basic <base64>` header) —
 * `expectedSecret` is the `username:password` pair configured for this connector's webhook.
 */
export function verifyAzureDevOpsAuth(authorizationHeader: string | null, expectedSecret: string): boolean {
  if (!authorizationHeader) return false;
  const expected = `Basic ${Buffer.from(expectedSecret).toString("base64")}`;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(authorizationHeader);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
