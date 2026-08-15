import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { azureDevOpsAdapter } from "./azureDevOps";
import { getIntegrationAdapter } from "./index";

const VALID_CONFIG = { orgUrl: "https://dev.azure.com/my-org", project: "MyProject", pat: "secret-pat" };

describe("azureDevOpsAdapter.fetchWorkItems", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws a clear configuration error when required config/env is missing", async () => {
    await expect(azureDevOpsAdapter.fetchWorkItems(null)).rejects.toThrow(/not configured/i);
  });

  it("returns an empty array when the WIQL query matches no work items", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ workItems: [] }) });

    const items = await azureDevOpsAdapter.fetchWorkItems(VALID_CONFIG);
    expect(items).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps a representative Azure DevOps API response into FetchedWorkItem[]", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workItems: [{ id: 42 }] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: [
            {
              id: 42,
              fields: {
                "System.Title": "Fix the widget",
                "System.Description": "The widget is broken",
                "System.State": "Active",
              },
            },
          ],
        }),
      });

    const items = await azureDevOpsAdapter.fetchWorkItems(VALID_CONFIG);
    expect(items).toEqual([
      {
        externalId: "42",
        externalUrl: "https://dev.azure.com/my-org/_workitems/edit/42",
        title: "Fix the widget",
        description: "The widget is broken",
        status: "Active",
      },
    ]);
  });

  it("throws when the WIQL query request fails", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized", text: async () => "bad PAT" });

    await expect(azureDevOpsAdapter.fetchWorkItems(VALID_CONFIG)).rejects.toThrow(/Azure DevOps sync failed/);
  });
});

describe("getIntegrationAdapter(\"AZURE_DEVOPS\")", () => {
  it("no longer throws 'not yet available'", () => {
    expect(() => getIntegrationAdapter("AZURE_DEVOPS")).not.toThrow();
    expect(getIntegrationAdapter("AZURE_DEVOPS").type).toBe("AZURE_DEVOPS");
  });
});
