## 1. i18n foundation

- [ ] 1.1 Add `src/lib/i18n/locales.ts`: `Locale = "en" | "he"` type and a
      `LOCALES: Record<Locale, { label: string; dir: "ltr" | "rtl" }>`
      config object (per design.md decision 3 — direction is declared
      per-locale, not hardcoded to `locale === "he"` anywhere else).
- [ ] 1.2 Add `src/lib/i18n/en.ts`: the English dictionary covering every
      string used on the Dashboard, Attention Center, Quick View drawer,
      and 360° Record's Overview/Dependencies/Timeline tabs and tab
      labels. Export its inferred type as `Translations`.
- [ ] 1.3 Add `src/lib/i18n/he.ts`: the Hebrew dictionary, typed as
      `Translations` so a missing key is a compile error. Hand-authored;
      flag for native-speaker review per design.md's Risks section.
- [ ] 1.4 Add `src/lib/i18n/format.ts`: `formatDate(date, locale)` and
      `formatNumber(value, locale)` wrapping `Intl.DateTimeFormat`/
      `Intl.NumberFormat`, replacing the ad hoc `toLocaleDateString()`
      calls this change touches.
- [ ] 1.5 Add `src/lib/i18n/LocaleProvider.tsx` (`"use client"`): context
      provider taking the initial `locale` as a prop, exposing
      `useLocale()` (returns `{ locale, dir }`) and `useT()` (returns a
      `t(key)` accessor typed against `Translations`).

## 2. Locale persistence & SSR wiring

- [ ] 2.1 Add `POST /api/locale` route: validates the body against
      `Locale`, sets a `locale` cookie (`sameSite: "lax"`, 1-year
      expiry). No DB write — cookie only, per proposal.md's confirmed
      scope decision.
- [ ] 2.2 Update `src/app/layout.tsx`: read the `locale` cookie via
      `next/headers`'s `cookies()` (already `async`), default to
      `"en"` when absent, set `<html lang={locale} dir={LOCALES[locale].dir}>`,
      and wrap `children` in `LocaleProvider` with that initial locale.
- [ ] 2.3 Add the language switcher to `NavRail` (`"use client"` island):
      calls `POST /api/locale` then `router.refresh()`. Verify manually
      that switching locale does not navigate away from the current page.

## 3. Design-system component RTL conversion

- [ ] 3.1 Convert `NavRail`'s physical classes (`border-r`, etc.) to
      logical Tailwind v4 utilities (`border-e`, etc.) so it mirrors
      under `dir="rtl"` with no locale-specific branch, per the
      design-system delta spec's "shared components mirror structurally"
      requirement.
- [ ] 3.2 Convert `StatusBadge`, `Row`/`RowList`, and `Panel` (in
      `src/components/ui/`) the same way — physical → logical spacing,
      borders, and text alignment.
- [ ] 3.3 Convert `QuickViewDrawer`'s physical classes (`border-l`, the
      close button's position) to logical equivalents so the drawer
      opens from the correct edge under both directions from the same
      markup (`justify-end` already reads as "trailing edge" once `dir`
      flips, so verify rather than rewrite it).
- [ ] 3.4 Add `rtl:-scale-x-100` to directional icons only (verify each
      icon used on the four in-scope surfaces against the design-system
      delta spec's directional-vs-non-directional distinction before
      adding the class).

## 4. Dashboard translation

- [ ] 4.1 Route every string in `src/app/page.tsx`'s attention-summary
      chips, project quick-access list, and recent-activity feed through
      `useT()`.
- [ ] 4.2 Format recent-activity timestamps through `formatDate()`.

## 5. Attention Center translation

- [ ] 5.1 Route every group heading, row reason, and required-action
      string in `src/app/attention/page.tsx` through `useT()`.
- [ ] 5.2 Verify row content order (status indicator → label → reason)
      reads correctly under `dir="rtl"` using the converted `Row`
      component from Task Group 3 — no new per-row RTL logic expected.

## 6. Quick View drawer and shared tab-content translation

- [ ] 6.1 Route every string in `OverviewTab.tsx` (status/risk/priority
      explanations, field labels, action button labels) through
      `useT()`; format the due date and blocked-since timestamp through
      `formatDate()`. Covers both the Quick View drawer and the 360°
      Record's Overview tab, since both render this component.
- [ ] 6.2 Route every string in `DependenciesTab.tsx` and
      `TimelineTab.tsx` through `useT()`; format Timeline's audit-event
      timestamps through `formatDate()`.
- [ ] 6.3 Route `QuickViewDrawer.tsx`'s own chrome (loading/error text,
      "Open full 360° Record →" link, section headings) through
      `useT()`.

## 7. 360° Record tab labels and RTL keyboard navigation

- [ ] 7.1 Route the tab labels passed into `WorkItemTabs` from
      `src/app/work-items/[id]/360/page.tsx` through `useT()`.
- [ ] 7.2 Update `WorkItemTabs.tsx`'s `onKeyDown` so `ArrowRight`/
      `ArrowLeft` map to next/previous tab in logical order, reversing
      under `dir="rtl"` (read once from `useLocale()`, not a per-keystroke
      DOM query), per the modified delivery-record-360 requirement.

## 8. Tests

- [ ] 8.1 Unit test: `he.ts` has no missing keys relative to `en.ts`
      (belt-and-suspenders runtime check alongside the compile-time type
      constraint from Task 1.3).
- [ ] 8.2 Unit test: `formatDate`/`formatNumber` produce different output
      for `"en"` vs `"he"` given the same input.
- [ ] 8.3 Unit test: `POST /api/locale` rejects a value outside
      `Locale` and sets the cookie correctly for a valid one.
- [ ] 8.4 New E2E scenario: switch to Hebrew from the nav rail, verify
      `<html dir="rtl">`, verify the Dashboard and Attention Center
      render Hebrew text, verify the Quick View drawer opens from the
      mirrored edge, verify 360° Record tab arrow-key navigation is
      reversed. Reload and verify no LTR-then-RTL flash (assert `dir`
      is already `"rtl"` on the first response's HTML, not only after
      client hydration).
- [ ] 8.5 Run the full existing E2E suite and confirm no regression —
      default locale stays English, so existing English-string
      assertions on the four in-scope surfaces should pass unchanged;
      fix any that don't due to real string/selector drift from Task
      Groups 4-7 (e.g. a string that moved into a translation key
      changing its exact rendered text).

## 9. Documentation & verification

- [ ] 9.1 Run `/verify` (build + lint + a live check: switch locale in a
      running dev server, confirm RTL layout and Hebrew text visually
      on at least one of the four surfaces).
- [ ] 9.2 Update `docs/ROADMAP.md`'s Slice 8 row and detail section to
      **Done**, linking this change's archive path, following the same
      pattern as Slices 0-7.
