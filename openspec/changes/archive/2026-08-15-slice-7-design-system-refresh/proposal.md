## Roadmap Source

Implements `docs/ROADMAP.md`'s "Slice 7 — Design system foundation &
premium UI refresh," sourced from
`docs/roadmap-sources/2026-08-15-design-system-direction.md`. That source's
"Scope note for the first implementation slice" states:

> First slice scope, agreed as: design tokens + base components
> (`StatusBadge`, row/list primitives, panel, drawer elevation) + restyle
> of the three core surfaces (Dashboard/Attention Center, Quick View
> drawer, 360° Delivery Record). Does not add new domain features,
> entities, or change any backend behavior — purely visual/structural UI
> layer on top of the existing, unchanged domain model and data.

## Why

The product's functional UX architecture (Dashboard/Attention Center →
Quick View → 360° Delivery Record) is complete and correct, but the visual
layer is unstyled Tailwind defaults — no color tokens (borders are
`black/10`/`white/15` opacity hacks), no type scale beyond `text-xl`/
`text-sm` + opacity, no elevation system, underlined text-link buttons, no
icons. It reads as a well-organized internal tool, not a product sellable
as premium enterprise SaaS. This slice establishes the design token
foundation and applies it to the three core surfaces users spend the most
time in, without touching the domain model or backend behavior.

## What Changes

- New design tokens: neutral color scale, one accent color, five-value
  status-semantic palette (green/blue/purple/amber/red), a 4–5-step type
  scale, an 8px spacing baseline, and exactly two elevation levels (flat /
  floating).
- New base UI components: `StatusBadge` (status + required reason,
  structurally enforced), list-row primitives (replacing ad hoc
  `rounded-lg border p-4` divs used as both cards and rows today), a
  `Panel` component for grouped detail sections, and drawer elevation
  styling for `QuickViewDrawer`.
- Restyle of the Dashboard (`/`) and Attention Center (`/attention`) using
  the new tokens/components: attention-state-first row hierarchy, chip-style
  counters instead of KPI cards, one-line reason + inline action per row.
- Restyle of `QuickViewDrawer` for elevation/motion (backdrop dim, fast
  slide transition) — no change to what data it shows or its trigger
  mechanism (`?quickView=<id>`).
- Restyle of the 360° Delivery Record (`/work-items/[id]/360`) and its tab
  bar (`WorkItemTabs`) using the new tokens — visual restyle of existing
  tabs only; no new tabs, no change to per-tab data.
- Left icon+label navigation rail, replacing the current bare top-of-page
  text links, for the app's small stable set of top-level destinations.
- **BREAKING (visual only)**: existing inline Tailwind utility classes on
  every touched component are replaced with token-driven classes/
  components. No route, API, or data-shape changes.

Explicitly out of scope for this slice: merging `/` and `/attention` into
a single route (an information-architecture change deferred to a later
slice so this one stays additive and low-risk), Ctrl+K command palette,
critical-path analysis, WCAG audit, and restyling any surface not listed
above (pipeline detail, constitution, config panels, audit trail) — those
follow in later slices once the token system is proven on the three core
surfaces.

## Capabilities

### New Capabilities
- `design-system`: the token system (color, type, spacing, elevation,
  status semantics) and the base component contracts (`StatusBadge` requires
  a reason; two elevation levels only; row vs. card vs. panel usage rules)
  that all current and future screens must follow.

### Modified Capabilities
(none — the underlying domain/product capabilities are unchanged; only
their presentation is restyled)

## Impact

- Affected code: `src/app/globals.css` (or a new tokens file), Tailwind
  config, `src/components/QuickViewDrawer.tsx`, `src/app/page.tsx`,
  `src/app/attention/page.tsx`, `src/components/WorkItemTabs.tsx` and the
  360° Record's tab components, root `layout.tsx` (nav rail). New shared
  components under `src/components/ui/` (or similar).
- No migrations, no Zod schema changes, no API route changes, no new
  Prisma models — this slice touches presentation only.
- Dependencies: adds an icon set (Lucide or Phosphor) as specified in the
  design direction; no other new runtime dependencies. Per the master
  prompt's protected constraint (§1.7), a UI component library is not
  introduced without separate proposal/approval — this slice builds
  token-driven primitives directly in Tailwind, not a third-party
  component library.
