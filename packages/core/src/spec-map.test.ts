import { describe, expect, it } from "vitest";
import { checkSpecRead, type SpecRead } from "./spec-map.ts";

const read = (over: Partial<SpecRead> = {}): SpecRead => ({
  sections: [
    { anchor: "h1", kind: "heading", title: "3.9 ניהול האישורים" },
    { anchor: "f20", kind: "field", parentAnchor: "h1", title: "בקשת נציג לביטול טופס", body: "Two Options" },
    { anchor: "r3a", kind: "rule", parentAnchor: "h1", title: "קביעת סטטוס 5", body: "בשמירה…" },
  ],
  links: [{ seq: 2, anchors: ["f20"] }, { seq: 7, anchors: ["r3a"] }],
  ...over,
});

describe("checkSpecRead", () => {
  it("accepts a reading whose parts, tasks and decisions all exist", () => {
    const r = checkSpecRead(read(), [2, 7], ["d.dec1", "d.dec2", "d.dec3"]);
    expect(r.ok).toBe(true);
  });

  it("refuses a reading with nothing in it — an empty spec is a failed read, not an empty requirement", () => {
    expect(checkSpecRead(read({ sections: [] }), [2], [])).toMatchObject({ ok: false });
  });

  it("refuses an anchor that is not a plain, short id — anchors are written into links and must stay stable", () => {
    for (const anchor of ["", "a b", "שדה", "x".repeat(41)]) {
      expect(checkSpecRead(read({ sections: [{ anchor, kind: "field", title: "t" }] }), [2], [])).toMatchObject({ ok: false });
    }
  });

  it("refuses the same anchor twice — a link would not know which part it means", () => {
    const dup = read({ sections: [{ anchor: "f20", kind: "field", title: "a" }, { anchor: "f20", kind: "field", title: "b" }] });
    expect(checkSpecRead(dup, [2], [])).toMatchObject({ ok: false, why: expect.stringContaining("f20") });
  });

  it("refuses a kind it does not know", () => {
    expect(checkSpecRead(read({ sections: [{ anchor: "x1", kind: "paragraph", title: "t" }] }), [2], [])).toMatchObject({ ok: false });
  });

  it("refuses a part that sits under something that is not there", () => {
    const orphan = read({ sections: [{ anchor: "f1", kind: "field", parentAnchor: "nope", title: "t" }] });
    expect(checkSpecRead(orphan, [2], [])).toMatchObject({ ok: false, why: expect.stringContaining("nope") });
  });

  it("lets a field's own requirement sit under the field, not only under a heading", () => {
    // The spec asks for audit history ON a field: its own piece, under the field it belongs to.
    const nested = read({ sections: [
      { anchor: "h1", kind: "heading", title: "שדות" },
      { anchor: "f20", kind: "field", parentAnchor: "h1", title: "בקשת נציג לביטול" },
      { anchor: "f20audit", kind: "field", parentAnchor: "f20", title: "היסטוריית ביקורת = כן" },
    ], links: [] });
    expect(checkSpecRead(nested, [], []).ok).toBe(true);
  });

  it("refuses a ring of parents — the screen would recurse forever", () => {
    const ring = read({ sections: [
      { anchor: "a", kind: "rule", parentAnchor: "b", title: "a" },
      { anchor: "b", kind: "rule", parentAnchor: "a", title: "b" },
    ], links: [] });
    expect(checkSpecRead(ring, [], [])).toMatchObject({ ok: false, why: expect.stringContaining("מעגל") });
  });

  it("refuses a part that sits under itself", () => {
    const self = read({ sections: [{ anchor: "a", kind: "rule", parentAnchor: "a", title: "a" }], links: [] });
    expect(checkSpecRead(self, [], [])).toMatchObject({ ok: false });
  });

  it("refuses a link to a task or a part that does not exist", () => {
    expect(checkSpecRead(read({ links: [{ seq: 99, anchors: ["f20"] }] }), [2, 7], [])).toMatchObject({ ok: false, why: expect.stringContaining("#99") });
    expect(checkSpecRead(read({ links: [{ seq: 2, anchors: ["ghost"] }] }), [2, 7], [])).toMatchObject({ ok: false, why: expect.stringContaining("ghost") });
  });

  it("refuses a correction that points at a part or a decision that is not there", () => {
    expect(checkSpecRead(read({ corrections: [{ anchor: "ghost", decision: 1, correction: "x" }] }), [2, 7], ["d.dec1", "d.dec2", "d.dec3"])).toMatchObject({ ok: false });
    expect(checkSpecRead(read({ corrections: [{ anchor: "r3a", decision: 9, correction: "x" }] }), [2, 7], ["d.dec1", "d.dec2", "d.dec3"])).toMatchObject({ ok: false, why: expect.stringContaining("9") });
  });

  it("accepts a reading with no links at all — a spec nothing implements yet is a real answer", () => {
    expect(checkSpecRead(read({ links: [] }), [], []).ok).toBe(true);
  });
});

describe("a decision is a piece of the spec too", () => {
  it("accepts a task linked to a decision, whose anchor the system decides", () => {
    const r = checkSpecRead(
      { sections: [{ anchor: "f20", kind: "field", title: "שדה" }], links: [{ seq: 2, anchors: ["f20", "d.86e1920a"] }] },
      [2], ["d.86e1920a"],
    );
    expect(r.ok).toBe(true);
  });

  it("still refuses a link to a decision that is not one of this requirement's", () => {
    const r = checkSpecRead(
      { sections: [{ anchor: "f20", kind: "field", title: "שדה" }], links: [{ seq: 2, anchors: ["d.deadbeef"] }] },
      [2], ["d.86e1920a"],
    );
    expect(r).toMatchObject({ ok: false, why: expect.stringContaining("d.deadbeef") });
  });
});
