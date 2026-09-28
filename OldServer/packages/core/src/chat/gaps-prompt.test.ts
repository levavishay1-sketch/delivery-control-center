import { describe, expect, it } from "vitest";
import { renderGapsContext, renderTranscript, type GapLike, type GapsContextInput } from "./gaps-prompt.ts";

const gap = (over: Partial<GapLike>): GapLike => ({
  id: "1a2b3c4d-0000-4000-8000-000000000000", description: "מי מאשר את בקשת הביטול?", why: "לא מוגדר גורם מאשר", impactIfWrong: "הבקשה תיתקע",
  options: ["מנהל הצוות", "מנהל הבקרה"], whoAnswers: "client", blocking: true, state: "proposed", answer: null, ...over,
});
const base = (over: Partial<GapsContextInput> = {}): GapsContextInput => ({
  title: "ביטול טופס", requirementType: "development", repo: { name: "trade", available: true },
  notes: [{ source: "manual", body: "נציג יוכל לבקש ביטול" }], files: [], gaps: [gap({})], ...over,
});

describe("renderGapsContext", () => {
  it("lists an open gap with its short reference and everything the model needs to judge an answer", () => {
    const t = renderGapsContext(base());
    expect(t).toContain("- [1a2b3c4d] מי מאשר את בקשת הביטול?");
    expect(t).toContain("למה זה חשוב: לא מוגדר גורם מאשר");
    expect(t).toContain("אם ננחש לא נכון: הבקשה תיתקע");
    expect(t).toContain("אפשרויות שהוצעו: מנהל הצוות | מנהל הבקרה");
    expect(t).toContain("מי מכריע: מבקש הדרישה · דחוף");
    expect(t).toContain("פערים פתוחים (1):");
  });

  it("keeps decided gaps apart, with their decision, and gives them no reference to close again", () => {
    const t = renderGapsContext(base({ gaps: [gap({ state: "resolved", answer: "מנהל הבקרה" }), gap({ id: "ffffffff-0000", description: "סיבה חובה?", state: "dismissed", answer: "כבר מוגדר" })] }));
    expect(t).toContain("(אין — כל הפערים הוכרעו)");
    expect(t).toContain("- מי מאשר את בקשת הביטול? → הוכרע: מנהל הבקרה");
    expect(t).toContain("- סיבה חובה? → לא פער: כבר מוגדר");
    expect(t).not.toContain("[1a2b3c4d]");
  });

  it("treats a gap marked 'checked, decide later' as still open", () => {
    expect(renderGapsContext(base({ gaps: [gap({ state: "verified" })] }))).toContain("[1a2b3c4d]");
  });

  it("says plainly whether the code can be read", () => {
    expect(renderGapsContext(base())).toContain("יש לך קריאה בלבד בו");
    expect(renderGapsContext(base({ repo: { name: "trade", available: false } }))).toContain("העותק המקומי לא זמין כרגע");
    expect(renderGapsContext(base({ repo: null }))).toContain("אין מאגר מקושר");
  });

  it("carries the attached files' text, says which could not be read, and cuts what is too long", () => {
    const t = renderGapsContext(base({ files: [
      { name: "spec.docx", text: "א".repeat(50_000), err: null },
      { name: "scan.pdf", text: null, err: "PDF סרוק" },
    ] }));
    expect(t).toContain("--- spec.docx ---");
    expect(t).toContain("[נקטע כאן]");
    expect(t).toContain("--- scan.pdf — לא ניתן לקרוא כטקסט (PDF סרוק) ---");
  });
});

describe("renderTranscript", () => {
  it("says so when this is the first message", () => {
    expect(renderTranscript([])).toBe("השיחה עד עכשיו: (זו ההודעה הראשונה)");
  });

  it("keeps who said what, and what became of each card", () => {
    const t = renderTranscript([
      { role: "user", kind: "answer", text: "מנהל הבקרה מאשר", payload: {} },
      { role: "assistant", kind: "answer", text: "זה עונה על הפער הראשון", payload: {} },
      { role: "assistant", kind: "proposal", text: "סגירת פער עם הכרעה", payload: { describe: "הפער \"מי מאשר\" ייסגר\nעוד שורה", status: "done" } },
      { role: "assistant", kind: "refusal", text: "לא אפשרי מכאן: הפער הזה כבר נסגר", payload: {} },
      { role: "system", kind: "system_note", text: "סיכום", payload: {} },
    ]);
    expect(t).toContain("האדם: מנהל הבקרה מאשר");
    expect(t).toContain("קלוד: זה עונה על הפער הראשון");
    expect(t).toContain("(כרטיס: סגירת פער עם הכרעה — הפער \"מי מאשר\" ייסגר — אושר ובוצע)");
    expect(t).toContain("(כרטיס שנדחה: לא אפשרי מכאן: הפער הזה כבר נסגר)");
    expect(t).not.toContain("סיכום");
  });

  it("remembers only the last turns", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ role: "user", kind: "answer", text: `הודעה ${i}`, payload: {} }));
    const t = renderTranscript(many);
    expect(t).not.toContain("הודעה 19\n");
    expect(t).toContain("הודעה 20");
    expect(t).toContain("הודעה 49");
  });
});
