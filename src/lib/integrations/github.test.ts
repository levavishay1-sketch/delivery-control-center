import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchCheckRuns,
  fetchCommits,
  fetchPullRequests,
  fetchRepository,
  fetchRepositorySnapshot,
  githubAdapter,
  verifyGithubSignature,
} from "./github";
import { getIntegrationAdapter } from "./index";

const VALID_CONFIG = { owner: "acme", repo: "widgets", token: "ghp_secret" };

describe("githubAdapter.fetchWorkItems", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws a clear configuration error when required config/env is missing", async () => {
    await expect(githubAdapter.fetchWorkItems(null)).rejects.toThrow(/not configured/i);
  });

  it("maps a representative GitHub issues API response into FetchedWorkItem[], filtering out pull requests", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          number: 7,
          title: "Widget breaks on load",
          body: "Steps to reproduce...",
          state: "open",
          html_url: "https://github.com/acme/widgets/issues/7",
        },
        {
          number: 8,
          title: "A pull request, not an issue",
          body: null,
          state: "open",
          html_url: "https://github.com/acme/widgets/pull/8",
          pull_request: { url: "https://api.github.com/repos/acme/widgets/pulls/8" },
        },
      ],
    });

    const items = await githubAdapter.fetchWorkItems(VALID_CONFIG);
    expect(items).toEqual([
      {
        externalId: "7",
        externalUrl: "https://github.com/acme/widgets/issues/7",
        title: "Widget breaks on load",
        description: "Steps to reproduce...",
        status: "open",
      },
    ]);
  });

  it("throws when the GitHub API request fails", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found", text: async () => "repo not found" });

    await expect(githubAdapter.fetchWorkItems(VALID_CONFIG)).rejects.toThrow(/GitHub sync failed/);
  });
});

describe("fetchRepository", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a representative GitHub repo response", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 42, name: "widgets", owner: { login: "acme" } }),
    });

    await expect(fetchRepository(VALID_CONFIG)).resolves.toEqual({
      externalId: "42",
      owner: "acme",
      name: "widgets",
    });
  });
});

describe("fetchCommits", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a representative GitHub commits API response", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          sha: "abc123",
          html_url: "https://github.com/acme/widgets/commit/abc123",
          commit: { message: "Fix widget", author: { name: "Ada", date: "2026-08-01T00:00:00Z" } },
        },
      ],
    });

    await expect(fetchCommits(VALID_CONFIG)).resolves.toEqual([
      {
        sha: "abc123",
        message: "Fix widget",
        authorName: "Ada",
        authoredAt: "2026-08-01T00:00:00Z",
        url: "https://github.com/acme/widgets/commit/abc123",
      },
    ]);
  });
});

describe("fetchPullRequests", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a representative GitHub pulls API response, including merged state", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          number: 9,
          title: "Add widgets",
          state: "closed",
          merged_at: "2026-08-02T00:00:00Z",
          html_url: "https://github.com/acme/widgets/pull/9",
          head: { sha: "def456" },
        },
      ],
    });

    await expect(fetchPullRequests(VALID_CONFIG)).resolves.toEqual([
      {
        number: 9,
        title: "Add widgets",
        state: "closed",
        merged: true,
        mergedAt: "2026-08-02T00:00:00Z",
        headSha: "def456",
        url: "https://github.com/acme/widgets/pull/9",
      },
    ]);
  });
});

describe("fetchCheckRuns", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a representative GitHub check-runs API response", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        check_runs: [
          {
            id: 5,
            name: "test",
            status: "completed",
            conclusion: "success",
            head_sha: "def456",
            started_at: "2026-08-02T00:00:00Z",
            completed_at: "2026-08-02T00:05:00Z",
          },
        ],
      }),
    });

    await expect(fetchCheckRuns(VALID_CONFIG, "def456")).resolves.toEqual([
      {
        externalId: "5",
        name: "test",
        status: "completed",
        conclusion: "success",
        headSha: "def456",
        startedAt: "2026-08-02T00:00:00Z",
        completedAt: "2026-08-02T00:05:00Z",
      },
    ]);
  });
});

describe("fetchRepositorySnapshot", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function base64(text: string): string {
    return Buffer.from(text, "utf-8").toString("base64");
  }

  it("fetches the root listing, README, and any present known manifest file", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { name: "README.md", type: "file" },
          { name: "package.json", type: "file" },
          { name: "src", type: "dir" },
        ],
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: base64("# Widgets"), encoding: "base64" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: base64('{"name":"widgets"}'), encoding: "base64" }),
      });

    const snapshot = await fetchRepositorySnapshot(VALID_CONFIG);
    expect(snapshot).toEqual({
      rootListing: ["README.md", "package.json", "src"],
      readme: { path: "README.md", content: "# Widgets" },
      manifests: [{ path: "package.json", content: '{"name":"widgets"}' }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns no README/manifests when neither is present at the root, without extra fetches", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ name: "src", type: "dir" }, { name: "LICENSE", type: "file" }],
    });

    const snapshot = await fetchRepositorySnapshot(VALID_CONFIG);
    expect(snapshot).toEqual({ rootListing: ["src", "LICENSE"], readme: undefined, manifests: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the root listing request fails", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found", text: async () => "repo not found" });

    await expect(fetchRepositorySnapshot(VALID_CONFIG)).rejects.toThrow(/GitHub request failed/);
  });
});

describe("getIntegrationAdapter(\"GITHUB\")", () => {
  it("no longer throws 'not yet available'", () => {
    expect(() => getIntegrationAdapter("GITHUB")).not.toThrow();
    expect(getIntegrationAdapter("GITHUB").type).toBe("GITHUB");
  });
});

describe("verifyGithubSignature", () => {
  // Payload/secret pair from GitHub's webhook-validation documentation
  // (https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries); the
  // expected signature is computed the same HMAC-SHA256 way GitHub itself signs a delivery,
  // rather than pasted from memory, so this checks the implementation against the documented
  // algorithm and header format (sha256=<hex>), not just a self-referential round-trip.
  const DOCS_PAYLOAD = '{"zen":"Non-blocking is better than blocking."}';
  const DOCS_SECRET = "It's a Secret to Everybody";
  const DOCS_SIGNATURE = "sha256=3a9a6deacd0fd22c63721bf8cc525d1bbe8363c8dd198d87ea1bb2fafe5b2956";

  it("accepts a correctly-signed payload for the documented example secret", () => {
    expect(verifyGithubSignature(DOCS_PAYLOAD, DOCS_SIGNATURE, DOCS_SECRET)).toBe(true);
  });

  it("rejects a payload that doesn't match the signature", () => {
    expect(verifyGithubSignature('{"zen":"tampered"}', DOCS_SIGNATURE, DOCS_SECRET)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyGithubSignature(DOCS_PAYLOAD, null, DOCS_SECRET)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(verifyGithubSignature(DOCS_PAYLOAD, DOCS_SIGNATURE, "wrong secret")).toBe(false);
  });
});
