import type { IntegrationAdapter } from "./types";

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

/** Jira Cloud stores issue descriptions as Atlassian Document Format (ADF) JSON, not plain text. */
function adfToText(node: AdfNode | null | undefined): string {
  if (!node) return "";
  const parts: string[] = [];
  if (node.text) parts.push(node.text);
  for (const child of node.content ?? []) parts.push(adfToText(child));
  return parts.join(node.type === "paragraph" ? " " : "\n").trim();
}

function resolveConfig(config: Record<string, unknown> | null): JiraConfig {
  const baseUrl = (config?.baseUrl as string) || process.env.JIRA_BASE_URL || "";
  const email = (config?.email as string) || process.env.JIRA_EMAIL || "";
  const apiToken = (config?.apiToken as string) || process.env.JIRA_API_TOKEN || "";
  const projectKey = (config?.projectKey as string) || process.env.JIRA_PROJECT_KEY || "";
  if (!baseUrl || !email || !apiToken || !projectKey) {
    throw new Error(
      "Jira integration is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN and JIRA_PROJECT_KEY (or the project's integrationConfig)."
    );
  }
  return { baseUrl, email, apiToken, projectKey };
}

export const jiraAdapter: IntegrationAdapter = {
  type: "JIRA",
  async fetchWorkItems(config) {
    const { baseUrl, email, apiToken, projectKey } = resolveConfig(config);
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    const url = `${baseUrl.replace(/\/$/, "")}/rest/api/3/search?jql=${encodeURIComponent(
      `project = ${projectKey} ORDER BY created DESC`
    )}&fields=summary,description,status`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Jira sync failed: ${res.status} ${res.statusText} — ${await res.text()}`);
    }

    const data = (await res.json()) as {
      issues: Array<{
        key: string;
        fields: { summary: string; description?: AdfNode; status: { name: string } };
      }>;
    };

    return data.issues.map((issue) => ({
      externalId: issue.key,
      externalUrl: `${baseUrl.replace(/\/$/, "")}/browse/${issue.key}`,
      title: issue.fields.summary,
      description: adfToText(issue.fields.description) || undefined,
      status: issue.fields.status.name,
    }));
  },
};
