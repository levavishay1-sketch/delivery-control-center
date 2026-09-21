import { describe, expect, it } from "vitest";
import { normaliseAdoUrl, splitAdoUrl } from "./ado-url.ts";

describe("splitAdoUrl", () => {
  it("keeps a clean cloud org URL and finds no project", () => {
    expect(splitAdoUrl("https://dev.azure.com/my-org")).toEqual({
      orgUrl: "https://dev.azure.com/my-org",
      projectFromUrl: "",
    });
  });

  it("takes the project from the path, decoding spaces", () => {
    expect(splitAdoUrl("https://dev.azure.com/my-org/My%20Project")).toEqual({
      orgUrl: "https://dev.azure.com/my-org",
      projectFromUrl: "My Project",
    });
  });

  it("drops a repo path after the project (_git and other _ markers)", () => {
    expect(splitAdoUrl("https://dev.azure.com/my-org/My Project/_git/x")).toEqual({
      orgUrl: "https://dev.azure.com/my-org",
      projectFromUrl: "My Project",
    });
    expect(splitAdoUrl("https://dev.azure.com/my-org/_apis/projects").projectFromUrl).toBe("");
  });

  it("strips trailing slashes and surrounding whitespace", () => {
    expect(splitAdoUrl("  https://dev.azure.com/my-org///  ").orgUrl).toBe("https://dev.azure.com/my-org");
  });

  it("treats the first path segment of an on-prem URL as the collection", () => {
    expect(splitAdoUrl("http://host/DefaultCollection")).toEqual({
      orgUrl: "http://host/DefaultCollection",
      projectFromUrl: "",
    });
    expect(splitAdoUrl("http://host/DefaultCollection/My Project")).toEqual({
      orgUrl: "http://host/DefaultCollection",
      projectFromUrl: "My Project",
    });
  });

  it("keeps the tfs virtual directory in the org URL", () => {
    expect(splitAdoUrl("http://host/tfs/DefaultCollection/My%20Project")).toEqual({
      orgUrl: "http://host/tfs/DefaultCollection",
      projectFromUrl: "My Project",
    });
  });

  it("returns something that is not a URL unchanged, with no project", () => {
    expect(splitAdoUrl("not a url")).toEqual({ orgUrl: "not a url", projectFromUrl: "" });
  });
});

describe("normaliseAdoUrl", () => {
  it("prefers the project pasted in the URL over the typed one", () => {
    expect(normaliseAdoUrl("https://dev.azure.com/my-org/From Url", "Typed")).toEqual({
      orgUrl: "https://dev.azure.com/my-org",
      project: "From Url",
    });
  });

  it("falls back to the typed project, trimmed", () => {
    expect(normaliseAdoUrl("https://dev.azure.com/my-org", "  Typed  ")).toEqual({
      orgUrl: "https://dev.azure.com/my-org",
      project: "Typed",
    });
  });
});
