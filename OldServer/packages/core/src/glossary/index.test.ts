import { describe, expect, it } from "vitest";
import { matchGlossary } from "./index.ts";

/**
 * `matchGlossary` is step zero of the chat (`packages/core/src/chat/index.ts`):
 * a "certain" match answers from the concept's fixed text with no model call
 * and no access to the screen's real facts. A concept whose alias is a
 * generic Hebrew question word therefore hijacks every short question of
 * that shape — about anything on the screen, not just that concept — into
 * the same boilerplate answer.
 *
 * Confirmed live 2026-09-27: `component_why` carried "למה" as an alias, so
 * asking the onboarding chat "why was this card proposed" answered with the
 * fixed definition of "כי ראיתי" instead of that card's actual reason.
 * `scripts/audit-stale.mjs` now fails the whole registry on this alias
 * shape; this test pins the specific regression at the function itself.
 */
describe("matchGlossary — a generic question word must never be an alias", () => {
  it("a short 'why' question about something else does not match component_why", () => {
    const m = matchGlossary("onboarding", "למה הרכיב הזה מוצע?");
    expect(m?.entry.key).not.toBe("component_why");
  });

  it("the concept's own title still matches", () => {
    const m = matchGlossary("onboarding", "מה זה כי ראיתי?");
    expect(m?.entry.key).toBe("component_why");
    expect(m?.certainty).toBe("certain");
  });
});

/**
 * A generic-word alias is not the only way this can happen: a card's own
 * auto-composed title routinely carries a glossary word inside it (a trust
 * label, a kind, a family), and the "ask" button drops that title verbatim
 * into the question it sends. `certain` used to fire off question length
 * alone, so any short question — however long its own substantive content —
 * that merely brushed past a glossary word anywhere in it got hijacked into
 * that word's fixed definition. `certain` now requires the matched term to
 * account for most of the question, once pure filler is stripped.
 *
 * Confirmed live 2026-09-28: a marketplace card's title always carries its
 * trust label ("רשמי" / "קהילה מוכרת" / "לא מאומת" — `source_trust`'s own
 * aliases), so "מה זה csharp-lsp (LSP) — רשמי, Anthropic ולמה הוא מוצע?"
 * (the "ask" button's own question about that specific card) answered with
 * the fixed explanation of "אמון במקור" instead of anything about the card.
 */
describe("matchGlossary — a term embedded in a longer, substantive question is not 'certain'", () => {
  it("an auto-composed card title carrying a trust label does not hijack the question about that card", () => {
    const m = matchGlossary("onboarding", "מה זה csharp-lsp (LSP) — רשמי, Anthropic ולמה הוא מוצע?");
    expect(m?.certainty).not.toBe("certain");
  });

  it("a genuinely short definitional question about the same term still answers for free", () => {
    const m = matchGlossary("onboarding", "מה זה אמון במקור?");
    expect(m?.entry.key).toBe("source_trust");
    expect(m?.certainty).toBe("certain");
  });
});
