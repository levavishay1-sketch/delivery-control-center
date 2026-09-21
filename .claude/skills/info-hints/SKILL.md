---
name: info-hints
description: How to add the "i" hint to a screen, card, title, figure or field in the DCC web app — find or write the concept, word it in plain Hebrew, attach it, and pass the audit. Use whenever you build or change a screen or a shared component, add a card or a section title, add a non-obvious field or a costly button, or the user asks for an explanation next to something. A screen, card or non-obvious field is not finished without it.
---

# info-hints

Every card, section title, figure and non-obvious field carries an **"i"** that
opens one or two plain Hebrew sentences. The end user is a Hebrew speaker who
is **not fluent in developer concepts**; the "i" is how a screen explains
itself without sending them elsewhere. The design and its reasons are in
`openspec/changes/info-hints/design.md`.

## Where things live

| What | Where |
|---|---|
| The wording (one entry per **concept**) | `packages/core/src/glossary/concepts/<area>.ts`, listed in `concepts/index.ts` |
| What a chat-registered screen is for | `packages/core/src/glossary/screens.ts` |
| Reading the registry | `getConcept` / `allConcepts` / `glossaryFor` in `glossary/index.ts` — never the arrays |
| The component | `apps/web/src/claude/Info.tsx` (`<Info k="key" />`) |
| Shared components that carry it | `PageHead`, `CardTitle`, `StatTile` in `apps/web/src/ui.tsx` — prop `info` |
| The check | `npm run audit:stale` (section 7 of `scripts/audit-stale.mjs`) |

## Adding one — in this order

1. **Look for the concept first.** Search the registry by its Hebrew title and
   by its meaning. The same idea on two screens is **one** entry ("עלות AI"),
   used by both. Two things that only share a word are two entries (the
   "סקירה" of a pull request is not the "סקירה" step of onboarding).
2. **If it does not exist, write it** in the right area file:

   ```ts
   { key: "ai_cost", kind: "field", title: "עלות AI בפועל", aliases: ["עלות", "כמה עלה"], screens: ["requirement"],
     explain: "כמה כסף ה-AI הוציא על הדרישה עד עכשיו, מיומן הקריאות." }
   ```

   - `key`: snake_case, named for the **concept**, not the screen it first appeared on (`pr_review`, not `pr_screen_review`). Page titles are `page_<screen>`.
   - `kind`: `section` (a card, an area, a screen title) · `term` (an idea) · `field` (a figure or an input) · `button`.
   - `screens`: only the screens registered with the chat (`useClaudeContext`) whose chat should answer about it. Leave it out otherwise; it also grows that screen's chat context, so do not list everything.
   - A `button` **must** have `press`: what happens, and what does **not**.
3. **Attach it.**
   - A screen title: `<PageHead info="page_x" …>`.
   - A card or section heading: `<CardTitle info="key">…</CardTitle>` (default `h4`; `as="h3"`). Never write a raw `h1`–`h4` in a screen — the audit fails it.
   - A tile: `<StatTile info="key" …>`. A figure, a field or a button: `<Info k="key" />` next to its label.
   - A heading that truly needs none: `info={null}`, and say why in the review. The audit counts them.
4. **Run** `npm run typecheck` and `npm run audit:stale`. The web reads the registry
   from the API, so **restart the API once** for a new or changed concept to show (see "Working in this repo" in `CLAUDE.md` — never leave the app down, say you restarted it).

## What gets an "i"

| Element | "i"? |
|---|---|
| Screen title, card title, section title | yes |
| A figure, a tile, a status the person must interpret | yes |
| A field whose meaning is not obvious from its label | yes |
| A button | **only** when pressing it is irreversible, costs money, writes to an outside system (Azure DevOps, the git host), or is not what its name says |
| A tab, a plain link, a column that says what it is | no |

Too many hints become noise; a button explains itself by its name.

## Wording

Hebrew, plain, **short but clear** — one or two sentences (the audit fails an
`explain` over 240 characters and a `press` over 320).

- Say what the thing **is** and what the person can do with it. For a button say what **happens** and what does **not** ("שום דבר לא נדחף ולא מתמזג לבד").
- Assume the reader learned what a branch, a pull request and a merge are only recently. Any English term keeps its meaning next to it, in the same sentence: "Blocker — משהו שעוצר את העבודה עד שמישהו עונה".
- Name the consequence of an action, especially when it costs money or writes outside DCC.
- Describe numbers and states; never quote an example value.
- One idea per entry. If the sentence needs "and also", it is two concepts.
- Write it so the chat can say the same words aloud: the chat answers from this entry with no model call.

Good: "כמה כסף ה-AI הוציא על הדרישה עד עכשיו — סכום כל הקריאות לקלוד עליה, מיומן הקריאות."
Not: "סה״כ עלות אגרגטיבית של invocations." (jargon, no meaning)

## Later

The registry moves to the database one day (wishlist). That is why an entry is
flat and self-contained, and why nothing reads the arrays directly: keep it so.
