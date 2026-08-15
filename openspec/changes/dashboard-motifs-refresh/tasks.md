## 1. Design tokens & motion foundation

- [ ] 1.1 Revise `globals.css`'s neutral scale to a cool-tinted slate
      (light + dark), keeping the same 11 lightness steps.
- [ ] 1.2 Widen the type scale's top end (`--text-lg`/`--text-xl`) for
      stronger heading presence; keep the bottom end (`--text-2xs`/
      `--text-xs`) tight for metadata.
- [ ] 1.3 Add a `--radius-card` token for cards/panels (larger than the
      current `rounded-lg`); leave dense rows (audit trail, work-item
      lists) on their current smaller radius.
- [ ] 1.4 Add `--shadow-glow-{tone}` tokens (soft, tone-tinted shadow)
      for the five status tones plus accent; add `--gradient-accent`
      (two-stop, single-hue) and per-status `--gradient-{tone}` pairs.
      Dark-mode counterparts for all of the above.
- [ ] 1.5 Add entrance (`fade-up`), hover-lift, and count-up-adjacent
      transition keyframes/utility classes; add one centralized
      `@media (prefers-reduced-motion: reduce)` block disabling/
      shortening all of them, per design.md decision 8.

## 2. Shared components

- [ ] 2.1 Add `src/components/ui/IconBadge.tsx`: tone-driven (status
      tone, work-item-type tone, or `"accent"`), gradient fill + glow
      shadow, reusing `StatusBadge`'s existing tone→color mapping rather
      than duplicating it.
- [ ] 2.2 Add `src/lib/colors/workItemType.ts`: a `WORK_ITEM_TYPE_TONES`
      map for the four `WorkItemType` values, chosen for hue distance
      from the five status colors.
- [ ] 2.3 Add `src/components/ui/StatTile.tsx`: `IconBadge` + count +
      label, optional `href`, count-up animation on mount using Slice
      8's `formatNumber()` at every intermediate value, entrance
      animation, respecting reduced-motion.
- [ ] 2.4 Add `src/components/ui/AvatarStack.tsx`: overlapping member
      avatars with an overflow count badge.
- [ ] 2.5 Add `src/components/ui/DonutChart.tsx`: a generic hand-built
      SVG progress ring (value 0-100, color, optional center label) —
      consult the `dataviz` skill for color/accessibility guidance
      before finalizing its palette usage.

## 3. Project identity color

- [ ] 3.1 Add `src/lib/colors/projectIdentity.ts`: deterministic
      string-hash of a project's ID into a curated, status-color-distinct
      palette (pure function, no storage).
- [ ] 3.2 Unit test: the same project ID always yields the same color;
      spot-check the palette's hues are visually distant from the five
      status hues (documented, not just asserted by eye).

## 4. Dashboard

- [ ] 4.1 Replace `SummaryChip` usage in `src/app/page.tsx`'s attention
      summary with `StatTile`, per the modified dashboard spec.
- [ ] 4.2 Apply `projectIdentityColor()` to each project quick-access
      card (accent bar or card-top wash, not the dominant fill).
- [ ] 4.3 Add `src/components/BudgetUsageDonut.tsx` (wraps
      `DonutChart`) to each client section, computing percentage from
      the same `getEffectiveBudget`/AI-cost data already fetched;
      renders nothing when the client's effective budget is unset, per
      the modified dashboard spec's explicit scenario.
- [ ] 4.4 Add a persistent primary CTA to the dashboard header that
      reaches work-item creation without first scrolling to a specific
      project section (project selection as part of the same flow).

## 5. Attention Center

- [ ] 5.1 Replace `SummaryChip` usage in `src/app/attention/page.tsx`
      with the same `StatTile` component used on the Dashboard, per the
      new attention-center requirement (same component, not a
      lookalike).

## 6. NavRail active state

- [ ] 6.1 Convert `NavRail.tsx` to `"use client"` and use `usePathname()`
      to detect the active destination, per design.md decision 7 (it
      already receives all data as props; no new data-fetching
      dependency introduced).
- [ ] 6.2 Apply the solid accent-colored (or accent-gradient) pill
      background to the active item only.

## 7. Command palette

- [ ] 7.1 Add `src/domain/search/queries.ts`: `searchAccessible(ctx,
      query)` — case-insensitive `contains` on `WorkItem.title` and
      `Project.name`/`Project.key`, scoped via the existing
      `accessibleClientIds` tenancy pattern, capped at ~8 results per
      group.
- [ ] 7.2 Add `GET /api/search` route calling `searchAccessible`.
- [ ] 7.3 Add `src/components/CommandPalette.tsx` (`"use client"`):
      Ctrl+K/Cmd+K to open, Escape/outside-click to close, arrow-key
      navigation, Enter to select; mount once in `RootLayout` alongside
      `QuickViewDrawer`.
- [ ] 7.4 Selecting a work item navigates to its Quick View or 360°
      Record; selecting a project navigates to the dashboard scrolled to
      that project's card.

## 8. i18n & RTL for every new surface

- [ ] 8.1 Add translation keys to `src/lib/i18n/en.ts`/`he.ts` for the
      command palette (placeholder, empty-results message, group
      headings) and any new Dashboard/Attention Center chrome (header
      CTA label), reusing existing `common.*` keys where the string
      already exists (stat-tile labels reuse `common.decisions` etc.).
- [ ] 8.2 Verify every new component (`IconBadge`, `StatTile`,
      `AvatarStack`, `DonutChart`, `BudgetUsageDonut`, `CommandPalette`,
      `NavRail`'s active pill) uses logical CSS properties and renders
      correctly under `dir="rtl"` — extend the existing Slice 8 E2E
      scenario or add assertions to it rather than starting a new RTL
      test from scratch.

## 9. Tests

- [ ] 9.1 Unit tests: `projectIdentityColor()` stability (Task 3.2),
      `searchAccessible()` tenancy scoping (a work item in an
      inaccessible client is excluded — mirrors the existing Attention
      Center query test pattern), `DonutChart`'s percentage-to-arc math.
- [ ] 9.2 E2E: open the command palette with Ctrl+K, search, select a
      work item result, land on its Quick View/360° Record; verify a
      result from an inaccessible client does not appear (reuse the
      existing isolation-fixture client/user from `e2e/isolation.spec.ts`
      rather than creating a new fixture).
- [ ] 9.3 E2E: Dashboard and Attention Center stat tiles render and link
      to the correct section; a client with an unset budget shows no
      donut, a client with a set budget and recorded cost shows one.
- [ ] 9.4 Run the full existing E2E suite and confirm no regression from
      the `SummaryChip` → `StatTile` swap (existing tests asserting on
      `SummaryChip`'s rendered text/links need equivalent `StatTile`
      selectors, not new assertions).

## 10. Documentation & verification

- [ ] 10.1 Run `/verify` (build + lint + a live check: load the
      Dashboard and Attention Center in a running dev server, open the
      command palette, confirm motion/reduced-motion behavior and RTL
      layout on at least one new component).
- [ ] 10.2 Update `docs/ROADMAP.md`'s Slice 9 row and detail section to
      **Done**, linking this change's archive path, following the same
      pattern as Slices 0-8.
