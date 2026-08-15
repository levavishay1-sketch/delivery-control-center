## Context

Slice 7 gave every Slice-7-touched surface (Dashboard, Attention Center,
Quick View drawer, 360° Record's `WorkItemTabs`/`OverviewTab`) a shared
component layer (`NavRail`, `StatusBadge`, `Row`/`RowList`, `Panel`) and a
Tailwind v4 `@theme` token block in `src/app/globals.css`. All of it is
built with physical CSS properties (`border-l`, `ml-*`, `text-left`,
`justify-end` for the drawer, fixed `left`/`right` on directional icons)
and hardcoded English strings. `src/app/layout.tsx` is an async Server
Component (`RootLayout`) that already reads the session and sets
`<html lang="en">` directly — it's the natural place to also read a
locale cookie and set `<html lang>`/`<html dir>` before first paint.

See `proposal.md` for the two scope decisions (cookie-based locale, four
surfaces only) and their rationale — not restated here.

## Goals / Non-Goals

**Goals:**
- A translation-key mechanism with zero new runtime npm dependencies.
- RTL that comes from the browser's native `dir` handling plus Tailwind
  v4's built-in logical-property utilities and `rtl:`/`ltr:` variants —
  not a custom mirroring layer.
- A locale/direction contract that a third locale can plug into by adding
  one dictionary file and one config entry — no code branching on
  `locale === "he"` anywhere in a component.

**Non-Goals:**
- No locale-prefixed routing (`/en/...`, `/he/...`) — see proposal.md.
- No translation of pages outside the four Slice 7 surfaces in this
  slice (Audit Trail, Configuration Center, pipeline detail, login,
  forms). Those pages still benefit from the shared components' logical
  CSS (their layout won't visibly break under `dir="rtl"`), but their
  strings stay English until a later slice translates them.
- No server-persisted per-user locale (no Prisma schema change,
  per the roadmap source's explicit constraint) — the cookie is
  browser-local, so a user's locale choice doesn't follow them to a
  different browser or device. Documented as a known limitation, not
  silently glossed over.
- No machine-translated or placeholder Hebrew text presented as
  final-quality — the Hebrew dictionary is hand-authored during this
  change and flagged for native-speaker review before it's treated as
  production-ready copy (see Risks below).
- No RTL-aware bidi handling for user-authored free text (work item
  titles/descriptions a user typed in Hebrew) beyond what the browser
  does natively for `dir="auto"` — no custom Unicode bidi algorithm work.

## Decisions

### 1. No i18n framework — plain TypeScript dictionaries + a small context
`src/lib/i18n/en.ts` and `he.ts` export a flat, nested-object dictionary
(`{ dashboard: { blockersCount: "Blockers", ... }, ... }`). `he.ts`'s
type is constrained to `Translations` (a type derived from `en.ts` via
`typeof`), so a missing Hebrew key is a compile error, not a silent
English fallback or a runtime lookup miss. A `LocaleProvider` (client
component, mounted once in `RootLayout`) puts the active locale's
dictionary and a `t(key)` accessor into React context; `useT()` reads it.

**Alternatives considered:** `next-intl` or `react-i18next` — rejected.
Both add a real runtime dependency and machinery (ICU message parsing,
namespace loading, ${} pluralization rules) this four-surface, two-locale
scope doesn't need yet, and Next.js 16 is new enough that neither
library's App-Router integration has been verified against it in this
codebase. A plain dictionary is easier to keep "lightweight" and to
type-check for completeness, which matters more here than pluralization
support.

### 2. Locale persistence: a cookie, read server-side, no localStorage
The language switcher (a small `"use client"` island inside `NavRail`)
calls a new `POST /api/locale` route that sets a `locale` cookie
(`httpOnly: false`, `sameSite: "lax"`, 1-year expiry), then calls
`router.refresh()`. `RootLayout` (already `async`, already reading
`auth()`) reads the cookie via `next/headers`'s `cookies()` and sets
`<html lang={locale}>`/`<html dir={LOCALES[locale].dir}>` on the server
render — so the very first HTML byte sent to the browser is already in
the right language and direction, with no client-side flash.

**Alternatives considered:** `localStorage`-only — rejected, because a
client-only read can't inform the server-rendered first paint, causing
exactly the LTR-then-RTL flash the spec forbids. A `locale` column on
`User` — rejected per the roadmap source's explicit "without changing
the existing domain/backend architecture" and the confirmed
cookie-based-switching decision in proposal.md.

### 3. RTL layout: Tailwind v4 logical utilities + `rtl:`/`ltr:` variants
Tailwind v4 ships logical-property utilities (`ps-*`/`pe-*`,
`ms-*`/`me-*`, `border-s`/`border-e`, `text-start`/`text-end`,
`start-*`/`end-*`) and built-in `rtl:`/`ltr:` variants compiled against
`[dir="rtl"]`/`[dir="ltr"]`. Replacing this change's in-scope
components' physical classes (`border-l` → `border-s`, `ml-*` → `ms-*`,
`justify-end` on the drawer → stays, since "end" already reads correctly
once `dir` flips the drawer to the left under RTL, etc.) gets structural
mirroring for free from the browser's native bidi/layout engine — no
JavaScript direction-detection logic, no duplicate component per
direction. Directional icons (the 360° Record's tab affordances, any
back/forward chevron) get a `rtl:-scale-x-100` class where the icon
itself needs to flip; non-directional icons (status icons, checkmarks)
get no such class, per the design-system delta spec's requirement.

**Alternatives considered:** a custom `isRTL` prop threaded through every
component — rejected as exactly the "duplicate, locale-specific variant"
the design-system delta spec forbids, and far more code than the
CSS-native approach.

### 4. Tab arrow-key reversal
`WorkItemTabs.tsx`'s existing `ArrowLeft`/`ArrowRight` keydown handler
gets its two branches swapped based on `document.documentElement.dir`
(read once via the locale context, not a DOM query per keystroke) so
"next tab" and "previous tab" stay logical concepts — the same behavior
contract as the modified delivery-record-360 requirement.

### 5. Dates and numbers: `Intl.DateTimeFormat`/`Intl.NumberFormat`
A small `src/lib/i18n/format.ts` wraps `Intl.DateTimeFormat(locale, ...)`
and `Intl.NumberFormat(locale, ...)` with the option sets already used
ad hoc today (`toLocaleDateString()` calls in `OverviewTab`,
`QuickViewDrawer`, the dashboard's recent-activity feed). No new
dependency — `Intl` is a native JS API.

## Risks / Trade-offs

- **Hand-authored Hebrew translations, not professionally reviewed** →
  Mitigation: dictionary keys and English source strings are structured
  for easy review/replacement (one flat file, one string per key); flag
  explicitly in the slice's documentation that native-speaker review is
  recommended before this is presented to real Hebrew-speaking users.
- **Locale choice is browser-local (cookie), not account-level** → a
  user switching browsers/devices loses their preference and falls back
  to English. Mitigation: explicitly out of scope per the roadmap
  source's backend-architecture constraint; revisit if/when a user
  preferences model exists.
- **Pages outside the four surfaces stay English-only under `dir="rtl"`**
  → a Hebrew user navigating to Audit Trail or Configuration Center sees
  an abrupt language switch back to English (though not a broken RTL
  layout, since the shared components' logical CSS still applies).
  Mitigation: explicitly scoped and documented as a known gap in
  proposal.md, not hidden; the same mechanism extends to those pages in
  a future slice with no rework.
- **`router.refresh()` after a locale switch re-renders the current
  route's server tree** → briefly re-fetches data already on screen.
  Mitigation: acceptable one-time cost on an explicit user action (same
  pattern already used elsewhere in this codebase for post-mutation
  refreshes).

## Migration Plan

No data migration — no schema change. Rollout is additive: existing
English-only behavior is the default (`locale` cookie absent → `"en"`),
so this ships without affecting any current user until they explicitly
switch languages. No rollback beyond reverting the change, since no
persisted state depends on it.
