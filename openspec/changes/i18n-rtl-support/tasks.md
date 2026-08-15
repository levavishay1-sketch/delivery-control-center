## 1. i18n foundation

- [x] 1.1 Add `src/lib/i18n/locales.ts`: `Locale = "en" | "he"` type and a
      `LOCALES: Record<Locale, { label: string; dir: "ltr" | "rtl" }>`
      config object (per design.md decision 3 — direction is declared
      per-locale, not hardcoded to `locale === "he"` anywhere else).
- [x] 1.2 Add `src/lib/i18n/en.ts`: the English dictionary covering every
      string used on the Dashboard, Attention Center, Quick View drawer,
      and 360° Record's Overview/Dependencies/Timeline tabs and tab
      labels. Export its inferred type as `Translations`.
- [x] 1.3 Add `src/lib/i18n/he.ts`: the Hebrew dictionary, typed as
      `Translations` so a missing key is a compile error. Hand-authored;
      flag for native-speaker review per design.md's Risks section.
- [x] 1.4 Add `src/lib/i18n/format.ts`: `formatDate(date, locale)` and
      `formatNumber(value, locale)` wrapping `Intl.DateTimeFormat`/
      `Intl.NumberFormat`, replacing the ad hoc `toLocaleDateString()`
      calls this change touches. Also added `formatMessage()` (simple
      `{token}` substitution) and `pluralize()` (`Intl.PluralRules`-based
      one/other selection) — needed once real translated strings required
      parameter interpolation and count-sensitive wording; not scoped in
      design.md but a direct, minimal extension of the same file's job.
- [x] 1.5 Add `src/lib/i18n/LocaleProvider.tsx` (`"use client"`): context
      provider taking the initial `locale` as a prop, exposing
      `useLocale()` (returns `{ locale, dir }`) and `useT()`. Implementation
      refinement from design.md: `useT()` returns the resolved
      `Translations` dictionary object directly (plain typed property
      access, e.g. `t.dashboard.heading`) rather than a string-keyed
      `t(key)` accessor function — full compile-time autocomplete/safety
      with no recursive dotted-path type utility needed, given the
      dictionary mixes plain string leaves, `{one, other}` plural-form
      objects, and enum-keyed maps that a single generic accessor
      couldn't cleanly type anyway. Observable behavior (translated text,
      RTL layout) is identical either way — this is purely a "HOW"
      choice, which design.md's own instructions leave to implementation.

## 2. Locale persistence & SSR wiring

- [x] 2.1 Add `POST /api/locale` route: validates the body against
      `Locale`, sets a `locale` cookie (`sameSite: "lax"`, 1-year
      expiry). No DB write — cookie only, per proposal.md's confirmed
      scope decision.
- [x] 2.2 Update `src/app/layout.tsx`: read the `locale` cookie via
      `next/headers`'s `cookies()` (already `async`), default to
      `"en"` when absent, set `<html lang={locale} dir={LOCALES[locale].dir}>`,
      and wrap `children` in `LocaleProvider` with that initial locale.
- [x] 2.3 Add the language switcher to `NavRail` (`"use client"` island):
      calls `POST /api/locale` then `router.refresh()`. Verified via the
      new E2E scenario (Task 8.4) that switching locale does not navigate
      away from the current page.

## 3. Design-system component RTL conversion

- [x] 3.1 Convert `NavRail`'s physical classes (`border-r`, etc.) to
      logical Tailwind v4 utilities (`border-e`, etc.) so it mirrors
      under `dir="rtl"` with no locale-specific branch, per the
      design-system delta spec's "shared components mirror structurally"
      requirement.
- [x] 3.2 Audited `StatusBadge`, `Row`/`RowList`, and `Panel` (in
      `src/components/ui/`) for physical-direction classes — found none.
      Their existing flexbox layout (`flex`, `gap-*`, `items-center`,
      symmetric `px`/`py`) already follows the browser's native reading
      direction with zero code changes, satisfying the requirement
      vacuously rather than by rewrite.
- [x] 3.3 Convert `QuickViewDrawer`'s physical classes (`border-l` →
      `border-s`) to logical equivalents; verified `justify-end` already
      reads as "trailing edge" once `dir` flips (native CSS flexbox
      behavior, no change needed). Also fixed the drawer's subtle
      slide-in animation offset (`globals.css`'s `drawer-in` keyframe),
      which used a hardcoded `translateX(16px)` that would have slid in
      from the wrong side under RTL — added a `:dir(rtl)` override
      flipping the offset sign. Not explicitly named in this task, but
      the same "drawer opens/animates from the correct edge" concern the
      task describes.
- [x] 3.4 Audited every lucide-react icon used across the four in-scope
      surfaces (NavRail, StatusBadge, CheckCircle2 on Dashboard/Attention
      Center) — none are directional (no chevrons/arrows). The one
      directional affordance found is a literal "→" text glyph in the
      "Open full 360° Record" link, handled by baking the
      direction-correct glyph directly into each locale's translation
      string (en: "→", he: "←") rather than a CSS icon-mirroring class —
      simpler and consistent with "avoid unnecessary complexity" since
      it's plain text, not an SVG icon.

## 4. Dashboard translation

- [x] 4.1 Routed every string in `src/app/page.tsx`'s attention-summary
      chips, project quick-access list, and recent-activity feed through
      `useT()`/server-side `getDictionary()` (this page is a Server
      Component, so it reads the dictionary directly rather than via the
      client `useT()` hook — see design.md decision 2's server/client
      split). The "Projects"/client-budget section below stays
      untouched, matching Slice 7's own precedent and this task's
      literal scope.
- [x] 4.2 Formatted recent-activity and "updated" relative timestamps
      through the shared `formatMessage()` helper with locale-aware
      minute/hour/day templates.

## 5. Attention Center translation

- [x] 5.1 Routed every group heading, row reason, and required-action
      string in `src/app/attention/page.tsx` through the server-side
      dictionary (also a Server Component).
- [x] 5.2 Verified row content order (status indicator → label → reason)
      reads correctly under `dir="rtl"` via the new E2E scenario — no new
      per-row RTL logic was needed, confirming the Task Group 3 finding.

## 6. Quick View drawer and shared tab-content translation

- [x] 6.1 Routed every string in `OverviewTab.tsx` (status/risk/priority
      explanations, field labels, action button labels) through
      `useT()`; formatted the due date and overdue/in-N-days suffix
      through `formatDate()`/`formatMessage()`. Covers both the Quick
      View drawer and the 360° Record's Overview tab.
- [x] 6.2 Routed every string in `DependenciesTab.tsx` (added `"use
      client"` — it had none before, needed for `useT()`) and
      `TimelineTab.tsx` through `useT()`; formatted Timeline's
      audit-event timestamps through `formatDateTime()`.
- [x] 6.3 Routed `QuickViewDrawer.tsx`'s own chrome (loading text, the
      dialog's fallback aria-label, close button aria-label, "Open full
      360° Record →" link, section headings) through `useT()`. Added two
      keys beyond the task's literal list (`quickView.close`,
      `quickView.dialogFallbackLabel`) for the close button and dialog
      aria-labels — small, disclosed additions in the same spirit as the
      listed strings, not separately called out in the task text.

## 7. 360° Record tab labels and RTL keyboard navigation

- [x] 7.1 Routed the tab labels passed into `WorkItemTabs` from
      `src/app/work-items/[id]/360/page.tsx` through the server-side
      dictionary (this page is a Server Component).
- [x] 7.2 Updated `WorkItemTabs.tsx`'s `onKeyDown` so `ArrowRight`/
      `ArrowLeft` map to next/previous tab in logical order, reversing
      under `dir="rtl"` via `useLocale()`'s `dir` value, per the modified
      delivery-record-360 requirement.

## 8. Tests

- [x] 8.1 Unit test (`dictionaries.test.ts`): `he.ts` has no missing or
      empty keys relative to `en.ts` (belt-and-suspenders runtime check
      alongside the compile-time type constraint from Task 1.3).
- [x] 8.2 Unit test (`format.test.ts`): `formatMessage`, `pluralize`, and
      `formatDate`/`formatNumber` produce correct/different output for
      `"en"` vs `"he"` given the same input.
- [x] 8.3 Unit test (`route.test.ts`): `POST /api/locale` rejects a value
      outside `Locale` (and a missing field) and sets the cookie
      correctly for a valid one.
- [x] 8.4 New E2E scenario (`e2e/slice8-i18n-rtl.spec.ts`): switch to
      Hebrew from the nav rail, verify `<html dir="rtl">`, verify the
      Dashboard and Attention Center render Hebrew text, verify the Quick
      View drawer opens from the mirrored (left) edge via bounding-box
      position, verify 360° Record tab arrow-key navigation is reversed,
      verify no LTR-then-RTL flash by inspecting the raw server HTML
      response (not just the post-hydration DOM), and verify switching
      back to English reverts layout/text. Passes.
- [x] 8.5 Ran the full existing E2E suite (10 pre-existing specs + the
      new one). 10/11 passed, no regressions. One pre-existing failure
      (`slice6-configuration-center.spec.ts`, unrelated to this change —
      Configuration Center budget-panel rendering) was confirmed to
      reproduce identically on the unmodified base commit via `git
      stash`, ruling out a Slice 8 regression. Not fixed — out of scope
      for an i18n/RTL change, flagged for separate follow-up.

## 9. Documentation & verification

- [x] 9.1 Ran `/verify`-equivalent checks: `npm run build` and `npm run
      lint` both clean; live check via a running dev server + Playwright
      screenshots confirming Hebrew text and mirrored RTL layout on the
      Dashboard and Quick View drawer (sent to the user), plus the full
      E2E scenario (Task 8.4) as a browser-based live check of the
      complete flow against the real dev server and database.
- [x] 9.2 Updated `docs/ROADMAP.md`'s Slice 8 row and detail section to
      **Done**, linking this change's archive path, following the same
      pattern as Slices 0-7.
