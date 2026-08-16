## Context

`src/components/ui/` has an established pattern for shared primitives (`Button.tsx`,
`FormField.tsx`, `Panel.tsx`, `StatusBadge.tsx`, `Row.tsx`): plain function components, Tailwind
utility classes with design tokens (`--color-*`, `rounded-*`, `--shadow-floating`), RTL via
logical properties (`text-start`, `border-e`, `ms-*`/`me-*`) rather than hardcoded left/right, no
external UI-library dependency (no Radix/Headless UI in `package.json`). The design-system spec
already defines exactly two elevation levels — flat (panels, rows) and floating (drawers,
dropdowns, modals — shadow + no backdrop dimming needed for something this small). See
proposal.md for motivation; this doc covers the component's shape and interaction model.

The HTML mock this slice traces back to (`AI_Delivery_Control_Center_SDD_v7.html`) has a
superficially similar `.info` element, but it's CSS-only: `.info:hover::after{...}` — a pure
`:hover` popover with no keyboard or touch path. That pattern is explicitly **not** being ported;
the design-system spec's own new requirement (this change) requires keyboard/touch reachability,
which a `:hover`-only CSS pseudo-element cannot provide.

## Goals / Non-Goals

**Goals:**
- One shared, accessible component for revealing a short explanation next to any element.
- Reachable by mouse hover (discoverability), keyboard focus + Enter/Space (accessibility), and
  touch tap (mobile) — the interaction model is a **toggle disclosure**, not a hover-only tooltip.
- Correct RTL mirroring via the same component, no separate variant.
- One small, real adoption site proving it end-to-end.

**Non-Goals:**
- Wiring this into Configuration Center broadly, AI recommendation cards, or any other future
  slice's UI — those are separate, later slices (12–21) that will each adopt this primitive.
- Rich/interactive popover content (forms, nested actions) — text-only (a short title + body),
  matching the "what/why/how" shape this slice's requirement calls for. A richer content model can
  be added later without a breaking change if a future slice needs it.
- A floating-ui/positioning library dependency — not needed at this component's scale.

## Decisions

**Toggle disclosure, not CSS `:hover`-only tooltip.** A `role="tooltip"` element is meant to
label/describe a single element for assistive tech and per ARIA authoring practices shouldn't
contain interactive or lengthy multi-sentence content, and CSS `:hover` provides no keyboard or
touch path at all. Instead: the ⓘ affordance is a real `<button>` with `aria-expanded` and
`aria-controls` pointing at the revealed panel (`role="dialog"`-less, non-modal — it doesn't trap
focus or block the page, it's supplementary information the user can dismiss anytime). Opens on
click, Enter/Space (native button behavior), or mouse hover for discoverability; closes on
Escape, click-outside, or mouse-leave-without-a-prior-click. This keeps one interaction model that
naturally serves all three input types instead of a hover-only implementation with a bolted-on
keyboard fallback.

**Positioning: anchored `absolute`, no portal.** The popover is `position: absolute` relative to
an inline wrapping span around the trigger, not rendered through a React portal. Simpler, matches
the codebase's existing no-extra-dependency convention, and every current usage site (Configuration
Center panels/cards) doesn't clip overflow. See Risks below for the trade-off.

**Content API: `label` + `children`.** `<InfoTooltip label="What is this?">explanation text or
short JSX</InfoTooltip>` — a short accessible label (used as the trigger's `aria-label` and the
popover's heading) plus body content. Deliberately not split into rigid `what`/`why`/`how` props;
callers write those as plain sentences in `children`, keeping the component reusable for shapes
this slice can't fully anticipate (status explanations, budget rules, future AI-recommendation
reasoning).

**First adoption site: Configuration Center's AI Budget field.** Small, already real (Slice 6),
and a genuine case of "non-obvious — why does this number say 'inherited from organization'?" —
proves the component against real inheritance-explanation content without touching budget logic
itself.

## Risks / Trade-offs

- **No-portal positioning could clip inside a future `overflow: hidden` ancestor.** →
  Mitigation: none of today's adoption sites use `overflow: hidden` on an ancestor of the trigger;
  if a future slice hits this, add portal-based positioning then rather than preemptively.
- **Hover-to-open on non-touch devices could feel noisy if adopted too densely later.** →
  Mitigation: this slice adopts it at exactly one site; density is a concern for the slices that
  do the broad adoption (17, 21), not this one.

## Migration Plan

Purely additive — a new component file plus one new usage in an existing, already-shipped screen.
No data migration, no API changes, no rollback complexity beyond reverting the two touched files.
