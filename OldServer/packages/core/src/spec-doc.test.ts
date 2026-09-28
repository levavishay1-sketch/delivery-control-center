import { describe, expect, it } from "vitest";
import { checkSpecRead, docElements, docForPrompt, docFromHtml, docFromText, overruledPieces, type SpecRead } from "./spec-doc.ts";

// What mammoth writes for a real spec: bold numbered paragraphs as headings, and tables with a header row.
const HTML =
  "<p><strong>3.9 ניהול האישורים</strong></p><p><strong>3.9.2 שדות בישות</strong></p>" +
  "<table><thead><tr><th><p><strong>#</strong></p></th><th><p><strong>שם תצוגה</strong><br /><strong>*הערה</strong></p></th><th><p>היסטוריית ביקורת</p></th><th><p>ערכים</p></th></tr></thead>" +
  "<tbody><tr><td><p>20.</p></td><td><p>בקשת נציג &amp; ביטול</p></td><td><p>כן</p></td><td><p>שתי אפשרויות:<br />· לא<br />· כן </p></td></tr>" +
  "<tr><td><p>21.</p></td><td><p>סיבת בקשה</p></td><td></td><td><p>עד 2000 תווים</p></td></tr></tbody></table>" +
  "<p>אחרת, סיים תהליך<br />סוף אם</p>" +
  "<ul><li>ראשון</li><li>שני</li></ul>";

describe("the document as it arrived", () => {
  const doc = docFromHtml(HTML);

  it("reads a bold numbered paragraph as a heading, as deep as its number", () => {
    expect(doc.blocks.slice(0, 2)).toEqual([
      { type: "heading", id: "h1", level: 2, text: "3.9 ניהול האישורים" },
      { type: "heading", id: "h2", level: 3, text: "3.9.2 שדות בישות" },
    ]);
  });

  it("keeps a table a table — the customer's own columns, and every row after the header", () => {
    const t = doc.blocks[2]!;
    expect(t.type).toBe("table");
    if (t.type !== "table") return;
    expect(t.head).toEqual(["#", "שם תצוגה *הערה", "היסטוריית ביקורת", "ערכים"]);
    expect(t.rows.map((r) => r.id)).toEqual(["t1.r1", "t1.r2"]);
  });

  it("gives every line of a cell its own id, so one allowed value can be pointed at", () => {
    const t = doc.blocks[2]!;
    if (t.type !== "table") throw new Error("not a table");
    expect(t.rows[0]!.cells[3]!.lines).toEqual([
      { id: "t1.r1.c4.l1", text: "שתי אפשרויות:" },
      { id: "t1.r1.c4.l2", text: "· לא" },
      { id: "t1.r1.c4.l3", text: "· כן" },
    ]);
  });

  it("keeps an empty cell, so the columns stay where they are", () => {
    const t = doc.blocks[2]!;
    if (t.type !== "table") throw new Error("not a table");
    expect(t.rows[1]!.cells.map((c) => c.id)).toEqual(["t1.r2.c1", "t1.r2.c2", "t1.r2.c3", "t1.r2.c4"]);
    expect(t.rows[1]!.cells[2]!.lines).toEqual([]);
  });

  it("decodes the document's characters", () => {
    expect(docElements(doc).find((e) => e.id === "t1.r1.c2")!.text).toBe("בקשת נציג & ביטול");
  });

  it("reads a plain paragraph line by line, and a list item by item", () => {
    expect(doc.blocks[3]).toEqual({ type: "para", id: "p1", lines: [{ id: "p1.l1", text: "אחרת, סיים תהליך" }, { id: "p1.l2", text: "סוף אם" }] });
    expect(doc.blocks[4]).toEqual({ type: "para", id: "p2", lines: [{ id: "p2.l1", text: "• ראשון" }, { id: "p2.l2", text: "• שני" }] });
  });

  it("gives the same ids every time it reads the same document — what a task was linked to stays put", () => {
    expect(docFromHtml(HTML)).toEqual(doc);
  });

  it("offers the model a single-line cell by its own id, and a longer one line by line, never an empty one", () => {
    const p = docForPrompt(doc);
    expect(p).toContain("[t1.r1.c3] (היסטוריית ביקורת) כן");
    expect(p).toContain("[t1.r1.c4.l2] · לא");
    expect(p).not.toContain("[t1.r2.c3]");
  });
});

describe("a document that is only text", () => {
  it("becomes paragraphs, a line each, with a numbered line on its own read as a heading", () => {
    const doc = docFromText("3.1 כללי\n\nשורה ראשונה\nשורה שנייה\n\n\nעוד פסקה");
    expect(doc.blocks).toEqual([
      { type: "heading", id: "h1", level: 2, text: "3.1 כללי" },
      { type: "para", id: "p1", lines: [{ id: "p1.l1", text: "שורה ראשונה" }, { id: "p1.l2", text: "שורה שנייה" }] },
      { type: "para", id: "p2", lines: [{ id: "p2.l1", text: "עוד פסקה" }] },
    ]);
  });
});

/* ── what the model marked in the document, and what is accepted ── */

// The shape of a real spec: a numbered heading, a field table, a rule whose logic is several lines.
const spec = docFromHtml(
  "<p><strong>3.9.2 שדות בישות</strong></p>" +
  "<table><thead><tr><th><p>#</p></th><th><p>שם תצוגה</p></th><th><p>היסטוריית ביקורת</p></th></tr></thead>" +
  "<tbody><tr><td><p>20.</p></td><td><p>בקשת נציג לביטול טופס</p></td><td><p>כן</p></td></tr></tbody></table>" +
  "<table><thead><tr><th><p>#</p></th><th><p>לוגיקה</p></th></tr></thead>" +
  "<tbody><tr><td><p>3.</p></td><td><p>בעת שמירה<br />· צור רשומה (1,003) [בקרת הצטרפות]</p></td></tr></tbody></table>",
);

// What the tasks' own instructions say — the only thing a link may rest on.
const TASKS = [
  { seq: 2, text: "הוספת שדות\n   יש להקים את השדה Alt_FormCancellationRequestBit מסוג Two Options (ברירת מחדל 'לא')." },
  { seq: 7, text: "יצירת רשומת בקרת מנהל בשמירה, עם קוד צוות 1,003." },
];

const read = (over: Partial<SpecRead> = {}): SpecRead => ({
  requirements: [
    { id: "t1.r1", title: "שדה: בקשת נציג לביטול טופס" },
    { id: "t1.r1.c3", title: "היסטוריית ביקורת על השדה" },
    { id: "t2.r1.c2.l2", title: "יצירת רשומת בקרה" },
  ],
  links: [
    { seq: 2, id: "t1.r1", evidence: "יש להקים את השדה Alt_FormCancellationRequestBit" },
    { seq: 7, id: "t2.r1.c2.l2", evidence: "יצירת רשומת בקרת מנהל בשמירה" },
  ],
  ...over,
});

describe("checkSpecRead", () => {
  it("accepts a reading whose pieces, tasks and decisions all exist", () => {
    const r = checkSpecRead(read(), spec, TASKS, ["d.dec1"]);
    expect(r.ok && r.value.links.length).toBe(2);
  });

  it("refuses a reading that marked nothing — an empty answer is a failed read, not an empty requirement", () => {
    expect(checkSpecRead(read({ requirements: [] }), spec, TASKS, [])).toMatchObject({ ok: false });
  });

  it("refuses a requirement that is not a piece of this document — it would mark words that are not there", () => {
    expect(checkSpecRead(read({ requirements: [{ id: "t9.r1", title: "x" }] }), spec, TASKS, [])).toMatchObject({ ok: false, why: expect.stringContaining("t9.r1") });
  });

  it("refuses a heading or a whole table as a requirement — neither is one thing a task implements", () => {
    expect(checkSpecRead(read({ requirements: [{ id: "h1", title: "x" }], links: [] }), spec, TASKS, [])).toMatchObject({ ok: false });
    expect(checkSpecRead(read({ requirements: [{ id: "t1", title: "x" }], links: [] }), spec, TASKS, [])).toMatchObject({ ok: false });
  });

  it("refuses the same piece twice, and a requirement with no name", () => {
    expect(checkSpecRead(read({ requirements: [{ id: "t1.r1", title: "a" }, { id: "t1.r1", title: "b" }], links: [] }), spec, TASKS, [])).toMatchObject({ ok: false, why: expect.stringContaining("t1.r1") });
    expect(checkSpecRead(read({ requirements: [{ id: "t1.r1", title: "  " }], links: [] }), spec, TASKS, [])).toMatchObject({ ok: false });
  });

  it("lets a row and a cell inside it both be requirements — the field, and audit history on it", () => {
    expect(checkSpecRead(read({ links: [] }), spec, TASKS, []).ok).toBe(true);
  });

  it("refuses a link to a task that does not exist, or to a piece that was not marked a requirement", () => {
    expect(checkSpecRead(read({ links: [{ seq: 99, id: "t1.r1", evidence: "יש להקים את השדה" }] }), spec, TASKS, [])).toMatchObject({ ok: false, why: expect.stringContaining("#99") });
    expect(checkSpecRead(read({ links: [{ seq: 2, id: "t1.r1.c1", evidence: "יש להקים את השדה" }] }), spec, TASKS, [])).toMatchObject({ ok: false, why: expect.stringContaining("t1.r1.c1") });
  });

  it("accepts a task linked to one of this requirement's decisions, and refuses someone else's", () => {
    expect(checkSpecRead(read({ links: [{ seq: 2, id: "d.86e1920a", evidence: "יש להקים את השדה" }] }), spec, TASKS, ["d.86e1920a"]).ok).toBe(true);
    expect(checkSpecRead(read({ links: [{ seq: 2, id: "d.deadbeef", evidence: "יש להקים את השדה" }] }), spec, TASKS, ["d.86e1920a"])).toMatchObject({ ok: false, why: expect.stringContaining("d.deadbeef") });
  });

  it("accepts a reading with no links at all — a spec nothing implements yet is a real answer", () => {
    expect(checkSpecRead(read({ links: [] }), spec, TASKS, []).ok).toBe(true);
  });
});

describe("a link has to quote the task's own instruction", () => {
  const one = (evidence: string, id = "t1.r1.c3", seq = 2) => checkSpecRead(read({ links: [{ seq, id, evidence }] }), spec, TASKS, []);

  it("drops a link whose quote is not in the instruction — creating the field is not turning on its audit history", () => {
    // What went wrong on a real requirement: audit history linked to the task that creates the field.
    const r = one("היסטוריית ביקורת על השדה");
    expect(r.ok && r.value.links).toEqual([]);
    expect(r.ok && r.value.unsupported).toEqual([{ seq: 2, id: "t1.r1.c3", evidence: "היסטוריית ביקורת על השדה" }]);
  });

  it("drops a quote too short to prove anything — a single word is in almost every instruction", () => {
    const r = one("שדה", "t1.r1");
    expect(r.ok && r.value.links).toEqual([]);
  });

  it("drops a quote from ANOTHER task's instruction — it has to be this task's words", () => {
    const r = one("יצירת רשומת בקרת מנהל בשמירה", "t1.r1");
    expect(r.ok && r.value.unsupported.length).toBe(1);
  });

  it("does not count spacing, the kind of quote mark, or quotes around the whole phrase", () => {
    const r = one("\"מסוג  Two Options (ברירת מחדל ״לא״)\"", "t1.r1");
    expect(r.ok && r.value.links.length).toBe(1);
  });

  it("finds the quote in the task's title as well as its instruction", () => {
    const r = one("הוספת שדות", "t1.r1");
    expect(r.ok && r.value.links.length).toBe(1);
  });
});

describe("a decision that overrules the document's words", () => {
  const fix = (c: NonNullable<SpecRead["corrections"]>[number]) => checkSpecRead(read({ corrections: [c] }), spec, TASKS, ["d.dec1"]);

  it("keeps the exact words it strikes through, when they are there", () => {
    const r = fix({ id: "t2.r1.c2.l2", decision: "d.dec1", from: "[בקרת הצטרפות]", to: "[בקרת מנהל]" });
    expect(r.ok && r.value.corrections[0]).toEqual({ id: "t2.r1.c2.l2", decision: "d.dec1", from: "[בקרת הצטרפות]", to: "[בקרת מנהל]" });
  });

  it("strikes nothing through when the words are not in that piece — it shows what was decided beside it instead", () => {
    const r = fix({ id: "t2.r1.c2.l2", decision: "d.dec1", from: "מילים שלא כתובות שם", to: "[בקרת מנהל]" });
    expect(r.ok && r.value.corrections[0]!.from).toBe("");
  });

  it("refuses a correction on a piece that is not there, from a decision that is not this requirement's, or with nothing in its place", () => {
    expect(fix({ id: "t9", decision: "d.dec1", to: "x" })).toMatchObject({ ok: false });
    expect(fix({ id: "t2.r1.c2.l2", decision: "d.other", to: "x" })).toMatchObject({ ok: false, why: expect.stringContaining("d.other") });
    expect(fix({ id: "t2.r1.c2.l2", decision: "d.dec1", to: " " })).toMatchObject({ ok: false });
  });
});

describe("a requirement a decision struck out entirely", () => {
  const d = docFromHtml("<table><tbody><tr><td><p>בעלים<br />נוצר על-ידי</p></td></tr></tbody></table>");

  it("is not a gap when every word of it was overruled — nothing is left to build", () => {
    expect([...overruledPieces(d, [{ id: "t1.r1.c1.l2", decision: "d.x", from: "נוצר על-ידי", to: "לא נקבע" }])]).toEqual(["t1.r1.c1.l2"]);
  });

  it("still is one when a decision changed only some of its words", () => {
    expect(overruledPieces(d, [{ id: "t1.r1.c1", decision: "d.x", from: "נוצר על-ידי", to: "לא נקבע" }]).size).toBe(0);
  });
});
