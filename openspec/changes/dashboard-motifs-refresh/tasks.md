## 1. Design tokens & motion foundation

- [x] 1.1 Revise `globals.css`'s neutral scale to a cool-tinted slate
      (light + dark), keeping the same 11 lightness steps.
- [x] 1.2 Widen the type scale's top end (`--text-lg`/`--text-xl`) for
      stronger heading presence; keep the bottom end (`--text-2xs`/
      `--text-xs`) tight for metadata.
- [x] 1.3 Add a `--radius-card` token for cards/panels (larger than the
      current `rounded-lg`); leave dense rows (audit trail, work-item
      lists) on their current smaller radius.
- [x] 1.4 Add `--shadow-glow-{tone}` tokens (soft, tone-tinted shadow)
      for the five status tones plus accent; add `--gradient-accent`
      (two-stop, single-hue) and per-status `--gradient-{tone}` pairs.
      Dark-mode counterparts derive automatically via `color-mix()`
      referencing the already-dark-overridden base color vars — no
      separate dark declarations needed (simpler than planned).
- [x] 1.5 Add entrance (`fade-up`), hover-lift, and count-up-adjacent
      transition keyframes/utility classes; add one centralized
      `@media (prefers-reduced-motion: reduce)` block disabling/
      shortening all of them (plus the pre-existing drawer entrance,
      folded in for consistency), per design.md decision 8.
- [x] 1.6 Add a `.hero-mesh` utility (two soft radial-gradient blobs,
      accent + ai-violet, mirrored horizontal positions so it's
      inherently RTL-safe with no logical-property handling needed) —
      retroactively added along with a design-system delta-spec
      requirement and this task, after finding the proposal's "gradient-
      mesh background wash" item had never been broken down into a spec
      requirement or task (surfaced per the apply workflow's "fix the
      artifacts" rule, not silently skipped).

## 2. Shared components

- [x] 2.1 Add `src/components/ui/IconBadge.tsx`: tone-driven (status
      tone, work-item-type tone, or `"accent"`), gradient fill + glow
      shadow, reusing `StatusBadge`'s existing tone→color mapping rather
      than duplicating it (exported `TONE_STYLES` from `StatusBadge.tsx`).
- [x] 2.2 Add `src/lib/colors/workItemType.ts`: a `WORK_ITEM_TYPE_TONES`
      map for the four `WorkItemType` values, validated for hue distance
      from the five status colors with the `dataviz` skill's palette
      checker (all six checks pass, light and dark, against this app's
      actual surfaces) rather than hand-estimated.
- [x] 2.3 Add `src/components/ui/StatTile.tsx`: `IconBadge` + count +
      label, optional `href`, count-up animation on mount using Slice
      8's `formatNumber()` at every intermediate value, entrance
      animation, respecting reduced-motion (explicit JS
      `matchMedia` check, since the count-up loop is `requestAnimationFrame`-driven, not CSS).
- [x] 2.4 Add `src/components/ui/AvatarStack.tsx`: overlapping member
      avatars with an overflow count badge. No avatar image exists
      anywhere in this app (Credentials auth, no OAuth image upload), so
      every avatar renders as an honest initials fallback, not a
      placeholder image.
- [x] 2.5 Add `src/components/ui/Meter.tsx` — renamed from the
      originally-planned "DonutChart" after consulting the `dataviz`
      skill: "a single ratio against a limit" is its documented Meter
      case, explicitly distinct from "a pie of 2 slices" (the anti-
      pattern a naive donut would have been). Track + single progress
      arc, never two competing fill colors. Updated proposal.md,
      design.md, and the dashboard delta spec to match this corrected
      terminology before continuing (surfaced per the apply workflow's
      "implementation reveals a design issue → update artifacts" rule).

## 3. Project identity color

- [x] 3.1 Add `src/lib/colors/projectIdentity.ts`: deterministic
      string-hash of a project's ID into a curated, status-color-distinct
      palette (pure function, no storage).
- [x] 3.2 Unit test: the same project ID always yields the same color;
      hue distance from the five status hues computed (not eyeballed) —
      worst case 9°, average ~22° (full ≥30° separation isn't achievable
      for 8 slots in the remaining hue space; documented as an accepted
      trade-off for this secondary/decorative signal, see the rationale
      comment in `projectIdentity.ts`).

## 4. Dashboard

- [x] 4.1 Replace `SummaryChip` usage in `src/app/page.tsx`'s attention
      summary with `StatTile`, per the modified dashboard spec. Staggered
      entrance delay per tile (0/60/120/180ms).
- [x] 4.2 Apply `projectIdentityColor()` to each project quick-access
      card and each full project `Panel` (an inline-start accent border
      via a new `style` passthrough prop on `Panel` — a dynamic hex
      can't be a static Tailwind class — not the dominant fill).
- [x] 4.3 Add `src/components/BudgetUsageMeter.tsx` (wraps `Meter`) to
      each client section, computing percentage from the same
      `getEffectiveBudget`/AI-cost data already fetched; renders nothing
      when the client's effective budget is unset, per the modified
      dashboard spec's explicit scenario. Fill color reuses the status
      scale by usage severity (design.md decision 5).
- [x] 4.4 Add `src/components/HeaderCreateWorkItem.tsx`: a persistent
      primary CTA in the dashboard header that opens a small
      floating-elevation popover with a project `<select>` + title
      input, reusing the same `POST /api/work-items` endpoint
      `AddWorkItemForm` already calls — reaches creation without first
      scrolling to a specific project's section.
- [x] 4.5 Apply `.hero-mesh` to the Dashboard's header/attention-summary
      container only (Task 1.6's retroactive addition), not the
      recent-activity row list or project work-item rows below it.
- [x] 4.6 Wire the (already-built, Task 2.4) `AvatarStack` component into
      each Dashboard client section header via the existing
      `listClientMembers` query — retroactively added, along with the new
      "A client section shows who has access to it" dashboard delta-spec
      requirement and this task, after `docs/ROADMAP.md`'s Slice 9 update
      (Task 10.2) surfaced that `AvatarStack` had been built (Task 2.4)
      but never actually rendered anywhere, despite being listed in
      `proposal.md`'s "What Changes" (per the apply workflow's "fix the
      artifacts" rule, not silently left as dead code or silently
      dropped). Scoped to per-client team membership, not per-project
      card or per-Attention-Center-row as `proposal.md` first sketched —
      `proposal.md` corrected with the reasoning (no real multi-person
      "who's involved" data exists at the project/work-item level in this
      domain: `WorkItem` has only a single optional `ownerId`).

## 5. Attention Center

- [x] 5.1 Replace `SummaryChip` usage in `src/app/attention/page.tsx`
      with the same `StatTile` component used on the Dashboard, per the
      new attention-center requirement (same component, not a
      lookalike). Tone per group matches the tone each item already used
      individually elsewhere on this page (e.g. `active` for approval
      gates, `warning` for clarifications/sync conflicts).
- [x] 5.2 Apply `.hero-mesh` to the Attention Center's header/stat-tile
      container only, matching the Dashboard's treatment (Task 1.6).

## 6. NavRail active state

- [x] 6.1 Convert `NavRail.tsx` to `"use client"` and use `usePathname()`
      to detect the active destination, per design.md decision 7 (it
      already receives all data as props; no new data-fetching
      dependency introduced).
- [x] 6.2 Apply the solid accent-gradient pill background to the active
      item only, via `aria-current="page"` for a11y plus a matching
      visual class.

## 7. Command palette

- [x] 7.1 Add `src/domain/search/queries.ts`: `searchAccessible(ctx,
      query)` — case-insensitive `contains` on `WorkItem.title` and
      `Project.name`/`Project.key`, scoped via the existing
      `accessibleClientIds` tenancy pattern, capped at ~8 results per
      group.
- [x] 7.2 Add `GET /api/search` route calling `searchAccessible`
      (wrapped in the same `DomainError` try/catch pattern the other
      read routes use).
- [x] 7.3 Add `src/components/CommandPalette.tsx` (`"use client"`):
      Ctrl+K/Cmd+K to open, Escape/outside-click to close, arrow-key
      navigation, Enter to select, 150ms debounce on the search fetch;
      mount once in `RootLayout` alongside `QuickViewDrawer`.
- [x] 7.4 Selecting a work item navigates directly to its 360° Record
      (`/work-items/[id]/360`) — simpler and unambiguous regardless of
      the page the palette was opened from, vs. threading a `quickView`
      query param onto an arbitrary origin path. Selecting a project
      navigates to `/#project-{id}`, the dashboard's existing anchor for
      that project's `Panel`.

## 8. i18n & RTL for every new surface

- [x] 8.1 Add translation keys to `src/lib/i18n/en.ts`/`he.ts` for the
      command palette (placeholder, empty-results message, group
      headings) and any new Dashboard/Attention Center chrome (header
      CTA label), reusing existing `common.*` keys where the string
      already exists (stat-tile labels reuse `common.decisions` etc.).
      Added `dashboard.newWorkItem*`, `dashboard.budgetUsed`, and the new
      `commandPalette.{placeholder,noResults,workItemsGroup,projectsGroup,hint}`
      namespace to both `en.ts` and `he.ts`; `StatTile` and `IconBadge`
      accept labels as props and were fed existing `common.*`/`dashboard.*`
      keys at each call site rather than owning any new strings themselves.
- [x] 8.2 Verify every new component (`IconBadge`, `StatTile`,
      `AvatarStack`, `Meter`, `BudgetUsageMeter`, `CommandPalette`,
      `NavRail`'s active pill) uses logical CSS properties and renders
      correctly under `dir="rtl"` — extend the existing Slice 8 E2E
      scenario or add assertions to it rather than starting a new RTL
      test from scratch. Confirmed by construction: `AvatarStack` uses
      `marginInlineStart` for overlap, `CommandPalette`'s result rows use
      `text-start`, `IconBadge`/`Meter`/`StatTile` have no directional
      properties (gradients are vertical, SVG arc rotation is
      direction-agnostic), and `.hero-mesh`'s two radial blobs are
      mirrored so RTL needs no logical-property handling; the NavRail
      active pill is a full-tile background fill (no positioned accent
      element to mirror) driven by a direction-agnostic vertical
      gradient, so its only RTL-relevant behavior is that `aria-current`
      and the active style still apply to the right item once the label
      switches to Hebrew. Extended `e2e/slice8-i18n-rtl.spec.ts` (Slice
      8's existing RTL scenario) with assertions for the command palette
      opening (Ctrl+K), showing its Hebrew placeholder, searching, and
      selecting a result under `dir="rtl"`, plus a check that the
      Hebrew-labeled active NavRail item still carries `aria-current`,
      rather than adding a new spec file.

## 9. Tests

- [x] 9.1 Unit tests: `projectIdentityColor()` stability (Task 3.2,
      already covered by `src/lib/colors/projectIdentity.test.ts`),
      `searchAccessible()` tenancy scoping (new
      `src/domain/search/queries.test.ts`, mirroring
      `src/domain/attention/queries.test.ts`'s integration-test pattern
      against real Postgres: an outsider's work item never appears for
      the in-client manager and vice versa), `Meter`'s percentage-to-arc
      math (extracted into a pure `computeMeterArc()` in the new
      `src/lib/meter.ts` so it's testable without rendering the SVG;
      `Meter.tsx` now calls it instead of inlining the math). Full suite
      (296 tests) passes.
- [x] 9.2 E2E: open the command palette with Ctrl+K, search, select a
      work item result, land on its Quick View/360° Record; verify a
      result from an inaccessible client does not appear (reuse the
      existing isolation-fixture client/user from `e2e/isolation.spec.ts`
      rather than creating a new fixture). New
      `e2e/slice9-dashboard-motifs.spec.ts`'s third scenario: admin
      creates a project/work item on "Client B (isolation fixture)",
      finds and navigates to it via the palette, then signs out and back
      in as the seeded `viewer@example.com` (a Default-Client-only
      member) and confirms the same search returns "No results".
- [x] 9.3 E2E: Dashboard and Attention Center stat tiles render and link
      to the correct section; a client with an unset budget shows no
      meter, a client with a set budget and recorded cost shows one.
      Same spec file's first two scenarios: a blocker is created via UI
      (mirroring `e2e/slice1-delivery-model.spec.ts`'s flow) to force a
      non-zero "Blockers" `StatTile` on both the Dashboard and Attention
      Center, verifying the href and the count; the budget scenario
      checks the meter-presence/effective-budget-text relationship on
      Client B in an order-independent way (whatever the displayed
      effective-budget text says, the meter's presence must agree with
      it), then deterministically sets a fresh override and confirms the
      meter appears at 0%.
- [x] 9.4 Run the full existing E2E suite and confirm no regression from
      the `SummaryChip` → `StatTile` swap (existing tests asserting on
      `SummaryChip`'s rendered text/links need equivalent `StatTile`
      selectors, not new assertions). Full suite run (14 tests, all spec
      files): 13 passed. The one failure
      (`slice6-configuration-center.spec.ts`) is unrelated to the
      `StatTile` swap — traced it directly against the dev database and
      confirmed "Default Client" already carried a stale $50 CLIENT-scope
      budget override from an earlier, non-Slice-9 run of that same test
      (dated the day before this session; that test never resets its own
      override on completion), which pre-empts the org-level inheritance
      this run expects. This is a pre-existing test-isolation gap in
      Slice 6's own test, not a regression from this change, and is left
      out of scope here. While extending `e2e/slice8-i18n-rtl.spec.ts`
      and writing the new spec, also fixed a real flake found in both:
      `page.keyboard.press("Control+k")` can land before
      `CommandPalette`'s keydown listener attaches post-hydration (a
      dev-server timing race); both files now retry the keypress until
      the dialog appears, and use a scoped `.fill()` on the palette's
      input instead of `page.keyboard.type()` for the search query.

## 10. Documentation & verification

- [x] 10.1 Run `/verify` (build + lint + a live check: load the
      Dashboard and Attention Center in a running dev server, open the
      command palette, confirm motion/reduced-motion behavior and RTL
      layout on at least one new component). `npm run build` and
      `npm run lint` both pass clean (lint surfaced 3 real
      `react-hooks/set-state-in-effect` violations in `StatTile.tsx` and
      `CommandPalette.tsx` from earlier in this implementation, fixed by
      routing `StatTile`'s reduced-motion branch through the same
      rAF-scheduled callback as the animated path, and by deriving
      `CommandPalette`'s empty-query result set at render time instead of
      resetting it via an effect). Live check against a manually started
      dev server + Postgres: with `page.emulateMedia({ reducedMotion:
      "reduce" })`, the Dashboard's Risks `StatTile` shows its final
      count immediately (no 0-then-animate flash); the command palette
      opens on Ctrl+K and closes on Escape; `.hero-mesh` renders on the
      Dashboard header; switching to Hebrew flips `<html dir="rtl">` and
      the active `NavRail` item still carries its accent-gradient
      background. Screenshot taken of the live Dashboard confirming the
      gradient hero, colored stat tiles, and per-project identity-color
      borders render as designed.
- [x] 10.2 Update `docs/ROADMAP.md`'s Slice 9 row and detail section to
      **Done**, linking this change's archive path, following the same
      pattern as Slices 0-8.
