import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractModelFacts, fetchModelSnapshotSource } from "./modelKnowledgeSource";

describe("fetchModelSnapshotSource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the response body text on a 2xx response", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => "<html>hello</html>" });
    await expect(fetchModelSnapshotSource()).resolves.toBe("<html>hello</html>");
  });

  it("throws a clear error on a non-2xx response", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable" });
    await expect(fetchModelSnapshotSource()).rejects.toThrow(/503/);
  });
});

describe("extractModelFacts", () => {
  it("extracts a model with a recognizable pricing fact nearby", () => {
    const html = `
      <table>
        <tr><td><h3>claude-opus-4-5</h3></td>
        <td>Input: $15 per million tokens, Output: $75 per million tokens</td></tr>
      </table>
    `;
    const facts = extractModelFacts(html);
    expect(facts).toHaveLength(1);
    expect(facts[0].modelId).toBe("claude-opus-4-5");
    expect(facts[0].pricingText).toMatch(/\$15/);
  });

  it("extracts a model with a recognizable context-window fact nearby", () => {
    const html = `<p>claude-sonnet-4-5 supports a 200K token context window.</p>`;
    const facts = extractModelFacts(html);
    expect(facts).toHaveLength(1);
    expect(facts[0].modelId).toBe("claude-sonnet-4-5");
    expect(facts[0].contextWindowText).toMatch(/200K token context/i);
  });

  it("drops a model id with no recognizable pricing or context-window fact nearby", () => {
    const html = `<p>claude-haiku-4-5 is a fast, capable model with excellent performance.</p>`;
    expect(extractModelFacts(html)).toEqual([]);
  });

  it("returns an empty array when the page has no models at all (e.g. a redesigned page)", () => {
    const html = `<html><body><h1>Something else entirely</h1><p>No relevant content here.</p></body></html>`;
    expect(extractModelFacts(html)).toEqual([]);
  });

  it("deduplicates repeated mentions of the same model id", () => {
    const html = `
      <p>claude-opus-4-5 costs $15 per million tokens.</p>
      <p>Later in the page, claude-opus-4-5 is mentioned again with $75 per million tokens output pricing.</p>
    `;
    const facts = extractModelFacts(html);
    expect(facts).toHaveLength(1);
  });
});
