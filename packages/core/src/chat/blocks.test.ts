import { describe, expect, it } from "vitest";
import { parseBlocks } from "./blocks.ts";

describe("parseBlocks", () => {
  it("keeps plain text as-is", () => {
    const r = parseBlocks("שלום, אין כאן בלוקים.");
    expect(r).toEqual({ text: "שלום, אין כאן בלוקים.", actions: [], needsCode: null, goto: null });
  });

  it("reads one action with its parameters and removes it from the text", () => {
    const r = parseBlocks('אני מציע לסגור.\n<action key="resolve_gap">{"gap":"1a2b3c4d","answer":"כן"}</action>');
    expect(r.text).toBe("אני מציע לסגור.");
    expect(r.actions).toEqual([{ key: "resolve_gap", params: { gap: "1a2b3c4d", answer: "כן" } }]);
  });

  it("reads several actions in one answer, in order", () => {
    const r = parseBlocks([
      "שני פערים נסגרו:",
      '<action key="resolve_gap">{"gap":"aaaaaaaa","answer":"א"}</action>',
      '<action key="dismiss_gap">{"gap":"bbbbbbbb","reason":"ב"}</action>',
    ].join("\n"));
    expect(r.actions.map((a) => a.key)).toEqual(["resolve_gap", "dismiss_gap"]);
    expect(r.actions[1]!.params).toEqual({ gap: "bbbbbbbb", reason: "ב" });
    expect(r.text).toBe("שני פערים נסגרו:");
  });

  it("gives an action whose body is not JSON no parameters, rather than dropping it", () => {
    const r = parseBlocks('<action key="assess">not json</action>');
    expect(r.actions).toEqual([{ key: "assess", params: {} }]);
  });

  it("ignores a JSON array as parameters", () => {
    expect(parseBlocks('<action key="x">["a"]</action>').actions).toEqual([{ key: "x", params: {} }]);
  });

  it("caps how many actions one answer can propose", () => {
    const many = Array.from({ length: 20 }, (_, i) => `<action key="k${i}">{}</action>`).join("\n");
    const r = parseBlocks(`טקסט\n${many}`);
    expect(r.actions).toHaveLength(12);
    expect(r.text).toBe("טקסט");
  });

  it("reads needs_code and goto blocks", () => {
    const r = parseBlocks('תשובה חלקית.\n<needs_code>לקרוא את מנוע המעבר</needs_code>\n<goto key="flow">לראות את התרשים</goto>');
    expect(r.needsCode).toBe("לקרוא את מנוע המעבר");
    expect(r.goto).toEqual({ key: "flow", reason: "לראות את התרשים" });
    expect(r.text).toBe("תשובה חלקית.");
  });
});
