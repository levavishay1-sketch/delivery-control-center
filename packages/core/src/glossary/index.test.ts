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
