## Roadmap Source

Implements `docs/ROADMAP.md` Slice 8 — "i18n readiness & RTL support
(Hebrew/English)". Scope is sourced verbatim from
`docs/roadmap-sources/2026-08-15-i18n-rtl-support.md`:

> The product must be i18n-ready from day one, with Hebrew and English as
> the initial supported languages.
>
> Hebrew must be treated as a true RTL experience, not just translated
> text. Account for RTL/LTR layout, navigation rail, drawers, tabs,
> tables, forms, icons, spacing, alignment, dates/numbers, and all other
> UI patterns.
>
> Keep the implementation lightweight and avoid unnecessary localization
> complexity. The architecture should make adding more languages later
> straightforward.
>
> Incorporate this into the Slice 7 design-system implementation without
> changing the existing domain/backend architecture.

Two scope decisions were confirmed with the user before writing this
proposal (the user deferred to "best practice" for both, so the reasoning
is recorded here rather than as a user-specified constraint):

1. **Locale switching is cookie/localStorage-based, not URL-prefixed**
   (no `/en/...`, `/he/...` routes). This is an authenticated internal
   dashboard, not a public/SEO-driven site — locale-prefixed routing
   would force every existing route, every internal `Link`, and all 10
   existing E2E specs' URL assertions to change for no benefit an
   authenticated app gets from it. Enterprise dashboards (Linear, Vercel,
   Notion) use account/browser-level language preference for the same
   reason.
2. **Translation coverage in this slice is Slice 7's four core surfaces**
   (Dashboard, Attention Center, Quick View drawer, 360° Delivery
   Record) — matching the user's own phrasing ("incorporate this into
   the Slice 7 design-system implementation") and this codebase's own
   incremental-delivery precedent (Slice 7 itself scoped to three
   surfaces, not the whole app). The i18n mechanism (translation keys,
   RTL-safe logical CSS, locale provider) is built app-wide and reusable;
   older pages (Audit, Configuration Center, pipeline detail, login,
   forms) keep English-only strings for now, ready to translate later
   with the same mechanism, not a different one.

## Why

Slice 7 gave the product a real design-token system, but every token,
layout, and string in it is hardcoded English/LTR. The user's own
customer base needs Hebrew as a true RTL experience, not a translated
skin over an LTR layout — and every slice added from here on (audit
trail, configuration center, future work) would otherwise keep compounding
the same hardcoded-string, physical-CSS-property debt. Doing this now,
directly on top of Slice 7's token/component layer while it's still fresh
and only four surfaces deep, is far cheaper than retrofitting six-plus
slices of ad hoc English strings later.

## What Changes

- New `Locale` type (`"en" | "he"`) with a lightweight client-side
  provider (`LocaleProvider` + `useLocale()`/`useT()` hooks) — no new
  npm dependency; translation dictionaries are plain TypeScript modules,
  not a runtime i18n framework, per the "avoid unnecessary localization
  complexity" instruction.
- A language switcher control in the persistent nav rail
  (`NavRail`) that flips `<html lang>`/`<html dir>` and persists the
  choice in a cookie (read on the server for the initial SSR render, so
  there's no LTR-then-RTL flash) plus `localStorage` for client-side
  reads.
- `he.ts`/`en.ts` translation dictionaries covering every string on the
  four Slice 7 surfaces: Dashboard, Attention Center, Quick View drawer,
  360° Delivery Record (`WorkItemTabs`, `OverviewTab`).
- The design-token layer (`globals.css`'s `@theme` block and every
  Slice-7-built component: `NavRail`, `StatusBadge`, `Row`/`RowList`,
  `Panel`, `QuickViewDrawer`) converted from physical CSS properties
  (`left`/`right`/`ml-*`/`mr-*`/`border-l`/`text-left`, etc.) to logical
  properties (`inset-inline-start`/`ms-*`/`me-*`/`border-inline-start`,
  etc.) so RTL mirroring is automatic under `dir="rtl"` rather than
  duplicated per-component.
- Date and number formatting routed through `Intl.DateTimeFormat`/
  `Intl.NumberFormat` with the active locale, replacing the current
  locale-less `toLocaleDateString()`/raw string interpolation on the
  four surfaces in scope.
- Icons that encode direction (e.g. chevrons, the "back" arrow, the
  progress-bar fill direction) mirror under RTL; icons that don't (status
  icons, checkmarks) do not.

## Capabilities

### New Capabilities
- `internationalization`: the locale/translation mechanism itself —
  locale selection, persistence, the translation-key contract, and the
  requirement that RTL is a first-class layout mode, not a text-direction
  hack.

### Modified Capabilities
- `design-system`: elevation, row/panel, and status-badge requirements
  gain an RTL-mirroring obligation — the existing flat/floating
  elevation rules, row-list rules, and status-badge rules must hold
  identically under `dir="rtl"`, not just `dir="ltr"`.
- `dashboard`, `attention-center`, `quick-view`, `delivery-record-360`:
  each gains a requirement that its rendered content (labels, dates,
  numbers) reflects the active locale, since these are the four surfaces
  in scope for full translation.

## Impact

- `src/app/globals.css`: physical → logical CSS properties across the
  `@theme` block and Slice-7 component styles.
- `src/app/layout.tsx`: reads the locale cookie server-side, sets
  `<html lang>`/`<html dir>` before first paint.
- New: `src/lib/i18n/` (locale types, `en.ts`/`he.ts` dictionaries,
  `LocaleProvider`, `useLocale`/`useT` hooks, a small server-side cookie
  reader).
- `src/components/NavRail.tsx`: adds the language switcher.
- `src/app/page.tsx`, `src/app/attention/page.tsx`,
  `src/components/QuickViewDrawer.tsx`, `src/components/OverviewTab.tsx`,
  `src/components/WorkItemTabs.tsx`, `src/components/DependenciesTab.tsx`,
  `src/components/TimelineTab.tsx`: strings routed through the
  translation mechanism; dates/numbers through `Intl`. (`OverviewTab`,
  `DependenciesTab`, and `TimelineTab` are shared between the Quick View
  drawer and the 360° Record's own tabs, so translating each once covers
  both surfaces.)
- No Prisma schema change, no new API route, no domain-layer change —
  locale is a client/cookie concern only, per the roadmap source's
  explicit "without changing the existing domain/backend architecture."
- E2E: existing specs that assert on English strings in the four
  in-scope surfaces need locale-aware selectors or an explicit
  `en` default; a new E2E scenario verifies the Hebrew/RTL path on at
  least one of the four surfaces.
