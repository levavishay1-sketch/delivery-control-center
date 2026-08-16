/**
 * A stable, curated palette for "which project is this" visual scanning
 * (accent bar / card-top wash) — a secondary, decorative-but-meaningful
 * signal, distinct in role from the primary status/work-item-type
 * categorical channels (never the card's dominant fill, never implying
 * status). Pastel-leaning hues, chosen to read as a coherent set without
 * duplicating any of the five status hex values.
 *
 * Hue distance from the five status colors (computed, not eyeballed —
 * see projectIdentity.test.ts): worst case 9° (rose vs. critical), best
 * 51° (lime), average ~22°. Full ≥30° separation on all eight slots isn't
 * achievable in the hue space left after the five status anchors (this
 * was computed and confirmed, not assumed) — accepted here because this
 * is a secondary, low-stakes signal (a thin bar/wash, never the card's
 * dominant fill, never appearing in the same visual role — a badge — as
 * a status color), unlike the work-item-type palette in workItemType.ts,
 * which IS a primary categorical channel and was held to the full
 * dataviz-skill validator instead.
 */
const IDENTITY_PALETTE = [
  "#f472b6", // pink
  "#22c55e", // mint
  "#38bdf8", // sky
  "#a3e635", // lime
  "#d946ef", // fuchsia
  "#facc15", // yellow
  "#2dd4bf", // teal
  "#fb7185", // rose
] as const;

/** djb2 — no cryptographic property needed, only a stable, well-distributed hash. */
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return hash >>> 0;
}

/** Deterministic — the same project ID always yields the same color, across sessions, with no stored field. */
export function projectIdentityColor(projectId: string): string {
  return IDENTITY_PALETTE[hashString(projectId) % IDENTITY_PALETTE.length];
}
