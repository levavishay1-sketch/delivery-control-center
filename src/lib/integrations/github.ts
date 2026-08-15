import type { IntegrationAdapter } from "./types";

interface GithubConfig {
  owner: string;
  repo: string;
  token: string;
}

function resolveConfig(config: Record<string, unknown> | null): GithubConfig {
  const owner = (config?.owner as string) || process.env.GITHUB_REPO_OWNER || "";
  const repo = (config?.repo as string) || process.env.GITHUB_REPO_NAME || "";
  const token = (config?.token as string) || process.env.GITHUB_TOKEN || "";
  if (!owner || !repo || !token) {
    throw new Error(
      "GitHub integration is not configured. Set GITHUB_REPO_OWNER, GITHUB_REPO_NAME and GITHUB_TOKEN (or the connector's config)."
    );
  }
  return { owner, repo, token };
}

interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  pull_request?: unknown;
}

export const githubAdapter: IntegrationAdapter = {
  type: "GITHUB",
  async fetchWorkItems(config) {
    const { owner, repo, token } = resolveConfig(config);
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=100`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub sync failed: ${res.status} ${res.statusText} — ${await res.text()}`);
    }
    const issues = (await res.json()) as GithubIssue[];

    // GitHub's issues endpoint also returns pull requests — those carry a pull_request key and
    // aren't work items in this system's sense, so they're filtered out here.
    return issues
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        externalId: String(issue.number),
        externalUrl: issue.html_url,
        title: issue.title,
        description: issue.body ?? undefined,
        status: issue.state,
      }));
  },
};
