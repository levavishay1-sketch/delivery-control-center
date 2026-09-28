import { describe, expect, it } from "vitest";
import { CUSTOMISATION_TEMPLATE, checkManualReport, manualReportNote, readCustomisations } from "./manual-report.ts";

describe("readCustomisations", () => {
  it("reads what is written under the CUSTOMISATION: heading, one per line", () => {
    expect(readCustomisations(`${CUSTOMISATION_TEMPLATE}FormCancellation\nControlStageStatus`)).toEqual(["FormCancellation", "ControlStageStatus"]);
  });

  it("does not count the heading, blank lines or bullets", () => {
    expect(readCustomisations("CUSTOMISATION:\n\n- FormCancellation\n• ControlStageStatus\n\n1. Third")).toEqual(["FormCancellation", "ControlStageStatus", "Third"]);
  });

  it("finds the heading in any case, with spaces before the colon", () => {
    expect(readCustomisations("customisation : One")).toEqual(["One"]);
  });

  it("reads a box with no heading whole — the template may have been deleted", () => {
    expect(readCustomisations("One\nTwo")).toEqual(["One", "Two"]);
  });

  it("gives nothing for the untouched template — a task need not have a customisation", () => {
    expect(readCustomisations(CUSTOMISATION_TEMPLATE)).toEqual([]);
    expect(readCustomisations(undefined)).toEqual([]);
  });

  it("ignores anything written before the heading", () => {
    expect(readCustomisations("הערה\nCUSTOMISATION:\nOne")).toEqual(["One"]);
  });
});

describe("checkManualReport", () => {
  it("accepts a summary alone — components and customisations are optional", () => {
    const r = checkManualReport({ summary: "עודכן הסקריפט" });
    expect(r).toEqual({ ok: true, value: { summary: "עודכן הסקריפט", customisations: [], components: [], reference: null } });
  });

  it("refuses a report that says nothing was done", () => {
    expect(checkManualReport({ summary: "  " })).toMatchObject({ ok: false });
    expect(checkManualReport({ summary: "x" })).toMatchObject({ ok: false });
  });

  it("carries the customisations, components and reference it was given", () => {
    const r = checkManualReport({
      summary: "הוקם שדה", customisation: "CUSTOMISATION:\nFormCancellation", components: "Alt.BL\nAlt.Plugins", reference: " branch/x ",
    });
    expect(r).toMatchObject({ ok: true, value: { customisations: ["FormCancellation"], components: ["Alt.BL", "Alt.Plugins"], reference: "branch/x" } });
  });
});

describe("manualReportNote", () => {
  it("says who-less facts plainly and leaves out what was not given", () => {
    const note = manualReportNote(7, { summary: "הוקם שדה", customisations: ["A", "B"], components: [], reference: null });
    expect(note).toBe("✍ משימה #7 דווחה ידנית — פותחה בלי Claude: הוקם שדה\nCUSTOMISATION: A · B");
  });
});
