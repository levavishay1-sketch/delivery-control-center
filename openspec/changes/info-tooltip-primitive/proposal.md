## Roadmap Source

Implements Slice 11 of `docs/ROADMAP.md` ("ⓘ info/explanation shared primitive"), sourced from
`docs/roadmap-sources/2026-08-16-product-vision-blueprint.md` §6.5 and §4:

> "Missing: a generic, reusable info/tooltip primitive (zero exist in `src/components/ui` today) —
> the natural carrier for §4's 'why/assumptions' detail without cluttering the primary card."

> "Every place AI proposes something ... should produce the same shape of recommendation ...
> paired with the ⓘ explanation primitive (§6.5) so 'why' is always one click away without
> leaving the screen."

This is Slice 11, the first of eleven dependency-ordered slices (11–21) in that blueprint,
deliberately scoped with zero dependencies so every later AI-facing slice can build on it from
the start.

## Why

Every later slice in the product-vision roadmap (AI recommendation cards, model-selection
reasoning, repository-relevance explanations, Configuration Center field generalization,
assignment-conflict prompts) needs a consistent way to explain a non-obvious concept — what it
is, why it matters, how it's determined — without cluttering the primary UI. No such primitive
exists today: `src/components/ui` has zero tooltip/info components. `StatusBadge` already
requires a `reason` prop, proving the product's own design-system spec already values "never
show something unexplained" — but that pattern is hand-rolled once, not reusable. Building the
primitive now, before any of the AI-facing slices that depend on it, avoids each of them
inventing its own ad hoc explanation UI.

## What Changes

- Add a new shared `InfoTooltip` component to `src/components/ui/`: a small "ⓘ" affordance that
  reveals an explanation (what/why/how) on hover, focus, or click/tap — not hover-only, since
  touch and keyboard users need a path too.
- Follow the existing design-system spec's elevation rules: the revealed explanation is a
  floating-elevation surface (shadow + no backdrop dimming needed for a small popover), consistent
  with how the Quick View drawer and dropdowns are already categorized.
- Mirror correctly under RTL using the existing i18n/RTL infrastructure (logical positioning,
  not hardcoded left/right), consistent with how every other shared component already mirrors.
- Adopt it at one small, real site to prove it works end-to-end, rather than shipping an unused
  component: add an ⓘ next to the Configuration Center's AI Budget field, explaining what the
  effective budget means and how inheritance/override determines it — the same explanation that
  today only exists implicitly via the field's own label text.

## Capabilities

### New Capabilities

(none — this extends the existing design-system capability's component contract)

### Modified Capabilities

- `design-system`: adds a requirement that a non-obvious concept (a config field, a status
  determination, a future AI recommendation) SHALL offer an accessible, keyboard-reachable
  explanation via a shared component, rather than each screen inventing its own explanation UI or
  leaving the concept unexplained.

## Impact

- New file: `src/components/ui/InfoTooltip.tsx` (or similar), following the existing primitive
  conventions (`Button.tsx`, `FormField.tsx`) — Tailwind utility classes, no separate CSS, RTL via
  logical properties.
- One real adoption site: `src/components/ConfigBudgetPanel.tsx` (or the Configuration Center
  page it renders on), adding one `InfoTooltip` usage — small, additive, no behavior change to
  the budget logic itself.
- No schema, API route, or domain-layer changes — this is a UI-only primitive.
- No breaking changes.
