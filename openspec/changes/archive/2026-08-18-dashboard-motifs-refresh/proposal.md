## Roadmap Source

Implements `docs/ROADMAP.md` Slice 9 — "Dashboard motifs refresh (budget
usage meter, real global search, nav polish)". Scope is sourced from
`docs/roadmap-sources/2026-08-15-dashboard-motifs-direction.md`'s
"Final synthesis" section (the last of three rounds of user direction on
this file — the two "superseding instruction" sections above it record
why the scope moved from "adopt six fixed items under Slice 7's existing
rules" to a genuine design-judgment revision):

> **The reconciliation**: richness comes from using the product's *real*
> categorical dimensions as color more generously and vividly — not from
> adding meaningless decoration. Two dimensions already exist and were
> under-used: (1) status/health (5-value palette...) and (2) work-item
> type (`project`/`task`/`bug`/`change`...). A third, optional dimension
> — a stable per-project/per-client identity color...
>
> Concretely, beyond the first synthesis's token/spacing/hierarchy
> revisions: Status and type colors get to be bigger and bolder...
> Gradients on primary buttons, stat-tile icon badges, and AI-related
> surfaces... Layered, two-tier shadows and soft color glows... Motion:
> staggered entrance animation... A subtle gradient-mesh background wash
> behind hero/summary sections...
>
> Still held from the earlier synthesis: no arbitrary/meaningless color,
> no vanity engagement charts, no upsell card, status always ships with
> a stated reason, RTL/i18n from Slice 8 unaffected.

## Why

Slice 7 gave the product a sound but deliberately austere design system.
The user's own reference and three rounds of direction converged on a
clear gap: the product needs to *feel* alive and premium at first
glance, not merely tasteful — and the way to get there without lapsing
into decoration is to use the product's own real categorical dimensions
(status, work-item type, project identity) more generously than Slice 7
did, plus real depth, motion, and a genuinely useful search feature that
was already a known, named gap.

## What Changes

- Design tokens revised: a subtly tinted neutral scale (replacing pure
  gray), a wider type-scale hierarchy (bigger jump between page
  title/section heading/body/metadata), more generous default spacing on
  primary surfaces, larger corner radius on cards/panels (dense rows/
  tables keep their current tighter radius), a layered two-tier
  shadow/glow system extending (not replacing) the existing flat/
  floating elevation levels, and gradient tokens for primary actions and
  status/type-colored surfaces.
- New `IconBadge` component: a circular, gradient-filled badge carrying a
  status color, work-item-type color, or the single accent color —
  replaces ad hoc icon placement with one reusable, RTL-safe pattern.
- New `StatTile` component: icon badge + large number + label, replacing
  the small `SummaryChip` pills currently used for attention-summary
  counts on the Dashboard and Attention Center.
- New `AvatarStack` component: overlapping member avatars with an
  overflow count, for "who's involved" — rendered per Dashboard client
  section (that client's team, via the existing `listClientMembers`
  query), not per project card or Attention Center row as first sketched.
  Corrected after implementation: `WorkItem` has only a single optional
  `ownerId`, not a members list, and `ClientMembership` is the only real
  multi-person "who's involved" data this app has — a project card or
  attention row would have nothing genuine to show a multi-avatar stack
  of.
- New `CommandPalette` component + a read-only search query: a real
  global search opened via Ctrl+K, closing the roadmap gap register's
  item #16 ("Ctrl+K command palette / global search — still not built").
  Searches work items and projects the user can already access — no new
  domain write path, reuses existing tenancy/authz scoping.
- A stable per-project identity color (deterministic hash of the
  project's existing ID into a curated palette, not a new stored field)
  for fast visual scanning on the Dashboard's project quick-access cards.
- Work-item-type color coding using the existing 4-value `type` enum
  (`project`/`task`/`bug`/`change`).
- An AI-budget-usage meter on the Dashboard's per-client section,
  built entirely on existing `AI Cost`/`aiBudgetUsd` data (Slices 3, 6) —
  no new metric, no schema change.
- A subtle gradient-mesh background wash behind the Dashboard and
  Attention Center's header/hero sections only — explicitly not applied
  to dense tables, rows, or the audit trail, where it would hurt
  scannability.
- Motion: staggered entrance animation for Dashboard/Attention Center
  stat tiles and project cards, hover lift/scale on interactive cards,
  animated count-up on `StatTile` numbers, skeleton shimmer loading
  states — all respecting `prefers-reduced-motion`.
- `NavRail`'s active-item state upgraded from bare accent text to a
  solid gradient/accent-colored pill.
- A persistent primary CTA in the Dashboard's header (e.g. "+ New Work
  Item"), elevating an action currently buried in a page-body form.

## Capabilities

### New Capabilities
- `command-palette`: global keyboard-driven search (Ctrl+K) across work
  items and projects the user can access, with results grouped and
  linking to Quick View / the 360° Record.

### Modified Capabilities
- `design-system`: token revisions (neutral scale, type scale, spacing,
  radius), a layered shadow/glow depth model extending the existing
  flat/floating elevation rule, a motion vocabulary, permitted gradient
  use tied to status/type/accent color (never arbitrary), and the nav
  rail's active-state treatment.
- `dashboard`: attention-summary counts render as `StatTile`s instead of
  `SummaryChip` pills; project quick-access cards gain a per-project
  identity color and an AI-budget-usage meter per client; a persistent
  header-level primary CTA is added.
- `attention-center`: attention-summary counts render as `StatTile`s
  instead of `SummaryChip` pills, reusing the same component and
  requirement as the dashboard.

## Impact

- `src/app/globals.css`: `@theme` block revision (neutral scale, type
  scale, spacing, radius, shadow/glow, gradient, and animation-keyframe
  tokens).
- New: `src/components/ui/IconBadge.tsx`, `src/components/ui/
  StatTile.tsx`, `src/components/ui/AvatarStack.tsx`, `src/components/
  CommandPalette.tsx`.
- New: `src/lib/colors/projectIdentity.ts` (deterministic hash → curated
  palette, pure function, no storage), `src/lib/colors/workItemType.ts`
  (fixed type → color map).
- New: `src/domain/search/queries.ts` (read-only, reuses existing
  tenancy/authz scoping patterns — no new Prisma model, no write path)
  and `src/app/api/search/route.ts`.
- `src/app/page.tsx` (Dashboard): stat tiles, project identity color,
  budget usage meter, header CTA.
- `src/app/attention/page.tsx`: stat tiles.
- `src/components/NavRail.tsx`: active-pill treatment.
- `src/app/layout.tsx`: mounts `CommandPalette`, wires the Ctrl+K
  listener.
- New translation keys added to `src/lib/i18n/en.ts`/`he.ts` for every
  new string (command palette chrome, stat-tile labels reused from
  existing `common.*` keys where possible); all new components use
  logical CSS properties and are verified under `dir="rtl"`, per Slice
  8's established mechanism.
- No Prisma schema change, no new domain write command. The Configuration
  Center's own page is explicitly out of scope for the meter — it
  already renders per-client budget elsewhere; duplicating the meter
  there is deferred, not silently dropped.
- Quick View drawer and the 360° Record are not directly modified by this
  change beyond inheriting the base token revision (radius, spacing,
  neutral tint) that applies globally through the shared design-system
  layer — no new energetic treatment (gradients, stat tiles, motion) is
  added to those two surfaces in this slice.
