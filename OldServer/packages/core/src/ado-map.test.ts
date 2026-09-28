import { describe, expect, it } from "vitest";
import { htmlToText, mapAdoState, mapAdoType } from "./ado-map.ts";

describe("mapAdoType / mapAdoState", () => {
  it("maps known types and states case-insensitively, ignoring padding", () => {
    expect(mapAdoType("  User Story ")).toBe("story");
    expect(mapAdoType("PRODUCT BACKLOG ITEM")).toBe("story");
    expect(mapAdoState(" In Progress")).toBe("building");
    expect(mapAdoState("Removed")).toBe("archived");
  });

  it("falls back to task / intake for anything unknown", () => {
    expect(mapAdoType("Something Custom")).toBe("task");
    expect(mapAdoState("Waiting on vendor")).toBe("intake");
  });
});

describe("htmlToText", () => {
  it("turns block ends and <br> into line breaks and drops other tags", () => {
    expect(htmlToText("<div>one</div><p>two<br/>three</p>")).toBe("one\ntwo\nthree");
  });

  it("decodes the common entities", () => {
    expect(htmlToText("a&nbsp;b &amp; c &lt;d&gt; &quot;e&quot; &#39;f&#39;")).toBe("a b & c <d> \"e\" 'f'");
  });

  it("collapses runs of blank lines", () => {
    expect(htmlToText("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\n\nb");
  });
});
