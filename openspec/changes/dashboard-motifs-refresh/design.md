## Context

Slice 7 established `@theme` tokens in `src/app/globals.css` (11-step
neutral scale, single accent, five status colors, 6-step type scale, two
elevation levels) and shared components (`StatusBadge`, `Row`/`RowList`,
`Panel`, `NavRail`). Slice 8 layered RTL/i18n on top (logical CSS
properties, `LocaleProvider`/`useT()`/`getDictionary()`, Tailwind v4's
native `rtl:`/`ltr:` variants). `NavRail` currently has no active-route
detection at all — every item renders identically regardless of the
current page — since Slice 7 never needed it (the accent-text-only
active state that exists in the design-system spec's language actually
describes tab state, not the nav rail, which has always been static).
`WorkItemType` is a 4-value Prisma enum (`PROJECT`/`TASK`/`BUG`/
`CHANGE`); tenancy scoping (`accessibleClientIds` from `AuthContext`) is
an established pattern in every domain query module (e.g.
`src/domain/attention/queries.ts`).

## Goals / Non-Goals

**Goals:**
- Visual energy through the product's real categorical dimensions
  (status, work-item type, project identity), not decoration.
- A working global search that closes a named, long-standing gap.
- Keep every new component RTL-safe and translated from day one, per
  Slice 8's established mechanism — no new component ships without it.

**Non-Goals:**
- No chart library dependency — the AI-budget donut is a small hand-built
  SVG (stroke-dasharray progress ring), consistent with "avoid
  unnecessary complexity."
- No full-text search infrastructure (no search index, no external
  service) — the command palette runs a bounded `contains` query against
  existing `WorkItem`/`Project` tables, acceptable at current data scale;
  revisit only if it becomes a real performance problem.
- No changes to Quick View or the 360° Record's own visual treatment
  beyond the token-level ripple (radius, spacing, neutral tint) that
  reaches every surface through the shared design-system layer.
- No new Prisma model or migration. The project identity color is a
  pure function of the existing project ID; the AI-budget donut reads
  data that already exists.

## Decisions

### 1. Token revisions live entirely in `globals.css`'s `@theme` block
Neutral scale gets a few degrees of blue mixed into each step (a cool
slate rather than pure gray); the type scale's top end (`--text-lg`/
`--text-xl`) widens for stronger heading presence while the bottom end
stays tight for metadata; a `--radius-card` token (larger than the
current ad hoc `rounded-lg`) applies to cards/panels, while dense rows
(the audit trail, work-item lists) keep their current smaller radius,
set directly rather than through the new token. New tokens: `--shadow-
glow-{tone}` (a soft, tone-tinted shadow for icon badges), `--gradient-
accent` (two-stop gradient of the same accent hue), and per-status
`--gradient-{tone}` pairs for `IconBadge`. All colors get dark-mode
counterparts, following the existing `@media (prefers-color-scheme:
dark)` block pattern.

### 2. `IconBadge`: one component, tone-driven, no per-tone duplication
`src/components/ui/IconBadge.tsx` takes a `tone` (a status tone, a work-
item-type tone, or `"accent"`) and an icon, and renders a circular
gradient-filled badge plus an optional soft glow shadow. Status tones
reuse `StatusBadge`'s existing `TONE_STYLES` color mapping (imported,
not duplicated); a new `WORK_ITEM_TYPE_TONES` map in
`src/lib/colors/workItemType.ts` adds the four type colors, chosen from
hues visually distinct from the five status colors so a reader never
confuses "this is a bug" with "this is at-risk."

**Alternatives considered:** a separate badge component per use site
(dashboard stat tile, attention stat tile, work-item-type indicator) —
rejected; it's exactly the "second, locale-specific-style variant" the
design-system spec already forbids for RTL, and the same reasoning
applies to tone variants.

### 3. `StatTile` composes `IconBadge`, adds count-up and entrance motion
`src/components/ui/StatTile.tsx` renders `IconBadge` + a number + a
label, as a `Link` when a target is given. The count-up animation
interpolates the displayed number over ~400ms on mount (respecting
`prefers-reduced-motion`), formatting each intermediate value through
Slice 8's `formatNumber()` so it stays locale-correct throughout, not
just at the final value. Both `page.tsx` (Dashboard) and `attention/
page.tsx` (Attention Center) replace their `SummaryChip` usage with
`StatTile`, sharing one implementation per the modified attention-center
spec's explicit requirement.

### 4. Project identity color: deterministic hash, curated palette, no storage
`src/lib/colors/projectIdentity.ts` exports `projectIdentityColor(id:
string): string`, a pure function hashing the project's existing
`cuid` ID (a simple string hash, e.g. summing char codes mod palette
length — no cryptographic property needed, only stability) into an
8-10 color curated palette. The palette is chosen to read as a
coherent, pastel-leaning set distinct from the five status hues (teal,
rose, amber-adjacent-but-not-warning-amber, sky, fuchsia, lime, etc.)
so identity color is never mistaken for status. Rendered as a left
accent bar or card-top wash on the Dashboard's project cards — never as
the card's dominant fill, so status/type colors elsewhere on the same
card stay legible.

**Alternatives considered:** storing an assigned color on `Project` —
rejected; a pure function needs no migration, no backfill, and produces
the same stability the reference's folder colors have, since a
project's ID never changes.

### 5. AI-budget donut: hand-built SVG ring, reads existing budget data
A `src/components/ui/DonutChart.tsx` primitive (value 0-100, color,
optional center label) renders two concentric SVG circles (a muted
track + a `stroke-dasharray`-based progress arc). A `src/components/
BudgetUsageDonut.tsx` wrapper computes the percentage from the same
`getEffectiveBudget`/AI-cost data `page.tsx` already fetches for the
existing per-client budget text — no new query. Colors and proportions
will be checked against the `dataviz` skill's accessibility/consistency
guidance during implementation before finalizing the exact palette.

### 6. Command palette: client-side overlay, server-side scoped search
`CommandPalette.tsx` (`"use client"`) mounts once in `RootLayout`
(alongside `QuickViewDrawer`), listens for Ctrl+K/Cmd+K, and calls `GET
/api/search?q=`. `src/domain/search/queries.ts` exports
`searchAccessible(ctx, query)`, reusing the exact `accessibleClientIds`
tenancy-scoping pattern already used in `src/domain/attention/
queries.ts` — a `WorkItem.title`/`Project.name`/`Project.key`
case-insensitive `contains` filter, scoped to accessible clients,
capped at ~8 results per group. No new domain write command, no schema
change — this is a read query module exactly like the existing ones.

### 7. `NavRail` active-state detection requires a client-side pathname read
`NavRail` currently has no active-route awareness at all (confirmed:
every item renders identically today). Detecting "which item is active"
needs the current URL, which a Server Component layout doesn't reliably
receive in the App Router. `NavRail.tsx` becomes `"use client"` (it
already renders only `Link`s and receives `configHref`/`t`/`locale` as
props from `RootLayout`, so the conversion doesn't add a data-fetching
dependency) and uses `usePathname()` to apply the solid accent-pill
class to the matching item.

### 8. Motion respects `prefers-reduced-motion` centrally
A single `@media (prefers-reduced-motion: reduce)` block in
`globals.css` disables/shortens every new `animate-*` class
(entrance, hover-lift, count-up's CSS transition) in one place, rather
than a `prefers-reduced-motion` check duplicated in every component —
consistent with the drawer's existing single-keyframe pattern.

### 9. Gradients stay direction-agnostic for RTL
Every new gradient (icon-badge fill, accent-button fill, the
gradient-mesh hero wash) uses radial gradients or a vertical
(top-to-bottom) linear gradient — never a horizontal left-to-right
gradient, which would visually "point" the wrong way under `dir="rtl"`
and require a mirrored variant. This sidesteps RTL-mirroring complexity
for every gradient in this change, rather than adding `rtl:` overrides
per gradient.

## Risks / Trade-offs

- **A curated identity-color palette can still visually clash with
  status colors in edge cases** (e.g. a project whose identity color
  lands close to the critical-red hue) → Mitigation: palette is
  deliberately built from hues with real distance from all five status
  hues, and identity color is confined to a card accent/wash, never the
  same visual role (a filled circular badge) that status/type colors
  use, so the reader's association is unambiguous by context and shape
  even if two hues are near.
- **`NavRail` becoming a client component loses nothing today** (it was
  already receiving all its data as props, no direct data fetching) but
  forecloses adding a direct-data-fetch inside `NavRail` later without
  re-converting it back — acceptable, matches the project's existing
  "small client islands" convention.
- **Bounded `contains` search doesn't scale indefinitely** → Mitigation:
  explicitly out of scope per Non-Goals; capped result count keeps
  response times reasonable at current and near-term data volumes.
- **Motion adds a first real animation surface beyond the drawer** →
  Mitigation: centralized `prefers-reduced-motion` handling from the
  start, not retrofitted.

## Migration Plan

No data migration. Additive UI/read-query layer only — no existing
behavior changes for a user who never opens the command palette or
never sees a client with a set budget (the donut simply doesn't render,
per the modified dashboard spec's explicit empty-budget scenario).
