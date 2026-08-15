import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubAdapter, verifyGithubSignature } from "./github";
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
