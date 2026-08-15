import { createHmac, timingSafeEqual } from "node:crypto";
import type { IntegrationAdapter } from "./types";

interface GithubConfig {
  owner: string;
  repo: string;
  token: string;
  baseUrl: string;
}

/** baseUrl defaults to the real GitHub API; a config override lets tests point it at a local stub, mirroring jira.ts's baseUrl field. */
function resolveConfig(config: Record<string, unknown> | null): GithubConfig {
  const owner = (config?.owner as string) || process.env.GITHUB_REPO_OWNER || "";
  const repo = (config?.repo as string) || process.env.GITHUB_REPO_NAME || "";
  const token = (config?.token as string) || process.env.GITHUB_TOKEN || "";
  const baseUrl = (config?.baseUrl as string) || process.env.GITHUB_API_BASE_URL || "https://api.github.com";
  if (!owner || !repo || !token) {
    throw new Error(
      "GitHub integration is not configured. Set GITHUB_REPO_OWNER, GITHUB_REPO_NAME and GITHUB_TOKEN (or the connector's config)."
    );
  }
  return { owner, repo, token, baseUrl };
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
    const { owner, repo, token, baseUrl } = resolveConfig(config);
    const res = await fetch(`${baseUrl}/repos/${owner}/${repo}/issues?state=all&per_page=100`, {
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

export interface FetchedRepository {
  externalId: string;
  owner: string;
  name: string;
}

export interface FetchedCommit {
  sha: string;
  message: string;
  authorName: string | null;
  authoredAt: string;
  url: string;
}

export interface FetchedPullRequest {
  number: number;
  title: string;
  state: "open" | "closed";
  merged: boolean;
  mergedAt: string | null;
  headSha: string | null;
  url: string;
}

export interface FetchedCheckRun {
  externalId: string;
  name: string;
  status: string;
  conclusion: string | null;
  headSha: string;
  startedAt: string | null;
  completedAt: string | null;
}

const CATCH_UP_PAGE_SIZE = 30;

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubGet(baseUrl: string, path: string, token: string): Promise<unknown> {
  const res = await fetch(`${baseUrl}${path}`, { headers: githubHeaders(token) });
  if (!res.ok) {
    throw new Error(`GitHub request failed: ${res.status} ${res.statusText} — ${await res.text()}`);
  }
  return res.json();
}

export async function fetchRepository(config: Record<string, unknown> | null): Promise<FetchedRepository> {
  const { owner, repo, token, baseUrl } = resolveConfig(config);
  const data = (await githubGet(baseUrl, `/repos/${owner}/${repo}`, token)) as { id: number; name: string; owner: { login: string } };
  return { externalId: String(data.id), owner: data.owner.login, name: data.name };
}

export async function fetchCommits(config: Record<string, unknown> | null): Promise<FetchedCommit[]> {
  const { owner, repo, token, baseUrl } = resolveConfig(config);
  const data = (await githubGet(baseUrl, `/repos/${owner}/${repo}/commits?per_page=${CATCH_UP_PAGE_SIZE}`, token)) as Array<{
    sha: string;
    html_url: string;
    commit: { message: string; author: { name: string; date: string } | null };
  }>;
  return data.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    authorName: c.commit.author?.name ?? null,
    authoredAt: c.commit.author?.date ?? new Date().toISOString(),
    url: c.html_url,
  }));
}

export async function fetchPullRequests(config: Record<string, unknown> | null): Promise<FetchedPullRequest[]> {
  const { owner, repo, token, baseUrl } = resolveConfig(config);
  const data = (await githubGet(baseUrl, `/repos/${owner}/${repo}/pulls?state=all&per_page=${CATCH_UP_PAGE_SIZE}`, token)) as Array<{
    number: number;
    title: string;
    state: string;
    merged_at: string | null;
    html_url: string;
    head: { sha: string };
  }>;
  return data.map((pr) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state as "open" | "closed",
    merged: pr.merged_at !== null,
    mergedAt: pr.merged_at,
    headSha: pr.head?.sha ?? null,
    url: pr.html_url,
  }));
}

export async function fetchCheckRuns(config: Record<string, unknown> | null, ref: string): Promise<FetchedCheckRun[]> {
  const { owner, repo, token, baseUrl } = resolveConfig(config);
  const data = (await githubGet(baseUrl, `/repos/${owner}/${repo}/commits/${ref}/check-runs?per_page=${CATCH_UP_PAGE_SIZE}`, token)) as {
    check_runs: Array<{
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      head_sha: string;
      started_at: string | null;
      completed_at: string | null;
    }>;
  };
  return data.check_runs.map((run) => ({
    externalId: String(run.id),
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    headSha: run.head_sha,
    startedAt: run.started_at,
    completedAt: run.completed_at,
  }));
}

/**
 * Verifies a GitHub webhook delivery's HMAC-SHA256 signature (the `X-Hub-Signature-256` header,
 * formatted `sha256=<hex>`), per GitHub's own documented scheme:
 * https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */
export function verifyGithubSignature(payload: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
