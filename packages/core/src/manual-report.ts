/**
 * A task somebody developed themselves, not with Claude — what they tell DCC
 * about it, and what is accepted.
 *
 * The report goes through the same lifecycle as a development run (it is
 * recorded as one, marked manual), so the task's status, steps and checks
 * read it exactly as they read Claude's work. What differs is only who did it
 * and what they can say about it: no branch, no commit DCC made — a summary,
 * the customisations touched, the components involved, and optionally where
 * the work lives.
 *
 * The customisations are written as text under a heading, because DCC is not
 * yet connected to the system they live in. When it is, they become a choice
 * from that system's own list (docs/wishlist.md).
 *
 * Pure — no database. The unit test drives it directly.
 */

export const CUSTOMISATION_HEADING = "CUSTOMISATION:";
/** What the report's customisation box starts with — the person writes under it. */
export const CUSTOMISATION_TEMPLATE = `${CUSTOMISATION_HEADING}\n`;

export type ManualReportInput = {
  /** What was done. */
  summary: string;
  /** Free text that starts with the CUSTOMISATION: heading; the names follow it, one per line. */
  customisation?: string;
  /** Components involved, one per line — blank when the task did not touch anything that is built. */
  components?: string;
  /** Where the work lives — a branch, a commit, a pull request, a ticket. */
  reference?: string;
};

export type ManualReport = {
  summary: string;
  customisations: string[];
  components: string[];
  reference: string | null;
};

const BULLET = /^\s*(?:[-*•·]|\d+[.)])\s*/;

/** The lines of a free-text list, one item each: bullets and blank lines do not count. */
function items(text: string | undefined): string[] {
  return (text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(BULLET, "").trim())
    .filter(Boolean);
}

/**
 * The customisations named in the box: everything after the CUSTOMISATION:
 * heading, one per line. A box without the heading is read whole — the person
 * may have deleted the template and written names straight in.
 */
export function readCustomisations(text: string | undefined): string[] {
  const t = (text ?? "").replace(/\r\n/g, "\n");
  const at = t.search(/^\s*CUSTOMISATION\s*:/im);
  if (at < 0) return items(t);
  const after = t.slice(at).replace(/^\s*CUSTOMISATION\s*:/i, "");
  return items(after);
}

export function checkManualReport(input: ManualReportInput): { ok: true; value: ManualReport } | { ok: false; why: string } {
  const summary = (input.summary ?? "").trim();
  if (summary.length < 3) return { ok: false, why: "כתבו מה נעשה במשימה — שורה אחת מספיקה" };
  const reference = (input.reference ?? "").trim();
  return {
    ok: true,
    value: {
      summary,
      customisations: readCustomisations(input.customisation),
      components: items(input.components),
      reference: reference || null,
    },
  };
}

/** The report as one note for the requirement's timeline. */
export function manualReportNote(seq: number, r: ManualReport): string {
  return [
    `✍ משימה #${seq} דווחה ידנית — פותחה בלי Claude: ${r.summary}`,
    r.customisations.length ? `${CUSTOMISATION_HEADING} ${r.customisations.join(" · ")}` : null,
    r.components.length ? `רכיבים: ${r.components.join(", ")}` : null,
    r.reference ? `מקור: ${r.reference}` : null,
  ].filter(Boolean).join("\n");
}
