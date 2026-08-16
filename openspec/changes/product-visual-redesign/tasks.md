## 1. Design tokens

- [x] 1.1 Add `--color-sidebar-surface` (and any needed hover/active-item
      sub-tones) to `globals.css`, derived from `--color-accent` via
      `color-mix()` per design.md decision 1 — no new unrelated color.
      Added `--color-sidebar-surface`/`-hover` and `--color-sidebar-text`.
      Found a real bug while wiring dark mode: deriving sidebar-text from
      `--color-accent-foreground` inherited that token's light/dark flip
      (white → near-black, since it means "text atop `--color-accent`",
      not "text atop the sidebar") — fixed by anchoring to literal white
      instead, since the sidebar surface stays dark in both modes.
- [x] 1.2 Add `--surface-page` (the light neutral page background behind
      the white workspace container), distinct from the existing
      `--surface`/`--surface-muted`. Reuses `--color-neutral-100` in light
      mode; needed an explicit dark-mode override to `--color-neutral-950`
      since raw neutral tokens don't themselves flip between modes (only
      the semantic tokens pointing at them do).
- [x] 1.3 Reviewed the type scale and spacing tokens (Slice 9) against the
      mockup's page-title/heading sizes — `--text-xl` (26px) and
      `--text-2xl` (32px) already cover the redesign's hierarchy; no
      change needed. Spacing stays on Tailwind's default utility scale
      (as before Slice 9/10 — this project has never tokenized spacing
      separately), so "generous density" is a per-component padding/gap
      choice made during each screen's migration, not a new token set.
- [x] 1.4 Added `--radius-shell` (1.5rem) for the workspace container's
      outer geometry; `--radius-card` (Slice 9, 0.875rem) is reused
      unchanged for cards/panels inside it.

## 2. Shared primitives

- [x] 2.1 Added `src/components/ui/Button.tsx`: `primary` (accent
      gradient, matches `IconBadge`'s existing gradient pattern),
      `secondary` (neutral bordered), `destructive` (critical-status-
      colored) variants, one size/radius/padding scale (`sm`/`md`).
- [x] 2.2 Added `src/components/ui/FormField.tsx`: a `FormField` label
      wrapper (label/required-marker/hint/error) plus shared-styled
      `Input`/`Select`/`Textarea` wrapping the native elements with one
      border/padding/radius/focus treatment.
- [x] 2.3 Extended `src/components/ui/Row.tsx` with an optional `columns`
      prop (CSS grid, `text-start` per cell — grid item order follows
      the ambient `direction`, so RTL mirrors for free) and an optional
      `RowListHeader` sibling for column headers.
- [x] 2.4 Added `src/components/ui/ApproveRejectButtons.tsx` — confirmed
      via direct diff that `ApprovalGate.tsx`/`ConstitutionApprovalGate.tsx`
      are byte-for-byte identical except the fetch path, and
      `DecisionActions.tsx` duplicates the same button pair verbatim
      (down to the exact class strings). Built as a controlled/
      presentational component (caller owns pending/error state, since
      `ApprovalGate` also gates an adjacent comment field `DecisionActions`
      doesn't have) — Approve maps to the `primary` Button variant, Reject
      to `destructive`, matching the exact 3-variant set design.md
      decision 5 scoped (not a new 4th "success" variant).
- [x] 2.5 Added `AuditEventRow`. Refined during implementation: design.md
      decision 3 anticipated a rigid column-grid for "the reference's
      activity table," but reading the real audit-event data (Task Group
      8's investigation) found each event's meta line is genuinely
      variable — 0–3 optional pieces (actor name / linked pipeline or
      project / stage type) — plus an optional multi-line JSON detail
      dump, none of which fits a fixed column grid without truncation.
      `AuditEventRow` instead reuses `Row`'s existing flex-column mode
      (`className="flex-col items-start gap-1"`), the exact pattern the
      Dashboard's recent-activity list already ships — restyled, not
      reinvented. The column-grid mode built in 2.3 gets its real,
      well-fitted use in Task Group 12 (`ConfigHistoryList`'s old-value/
      new-value/changed-by/when rows, which genuinely are fixed,
      comparable fields), fulfilling the design-system delta spec's
      column-grid requirement there instead of forcing it here.

## 3. Application shell

- [x] 3.1 Rebuilt `NavRail` as a permanently-expanded 240px branded
      sidebar (dropped the `w-14` icon-only breakpoint) using
      `bg-sidebar-surface`, per design.md decision 6: brand mark+
      wordmark at top, nav items with icon+label, existing
      `aria-current` active-pill logic kept and restyled, account
      context (avatar initials + email + sign-out, moved from the old
      top header) at the bottom. The sign-out form's Server Action
      (`handleSignOut`) is now defined in `layout.tsx` and passed to
      `NavRail` as an `onSignOut` prop — Server Actions passed as props
      to a Client Component is a supported Next.js pattern, so the form
      itself could move without becoming a client-side fetch.
- [x] 3.2 Restructured `src/app/layout.tsx`: removed the separate top
      header strip; `body` now carries `bg-surface-page`; `{children}`
      is wrapped in a `rounded-shell border bg-surface shadow-(--shadow-
      floating)` workspace container inset from the sidebar/viewport
      via padding on its parent. Applies even when logged out (Login
      page gets the workspace-container treatment without the sidebar,
      per Task Group 7).
- [x] 3.3 Verified `QuickViewDrawer` and `CommandPalette` (both already
      token-driven) render correctly against the new shell — no
      functional change expected, visual check only.

## 4. Consolidation

- [x] 4.1 Confirmed via direct read that `ApprovalGate.tsx`/
      `ConstitutionApprovalGate.tsx` were byte-for-byte identical except
      the API path; merged into one `ApprovalGate` taking an
      `apiBasePath` prop, rebuilt on `ApproveRejectButtons`/`Input`;
      deleted `ConstitutionApprovalGate.tsx`; updated the Constitution
      page's import and the Pipeline Detail page's call site.
- [x] 4.2 Confirmed `DraftButton.tsx`/`ConstitutionDraftButton.tsx`
      differed in more than the API path: drafting a Constitution
      creates a *new* one whose id (needed for the status poll) only
      exists in the response body, unlike a stage's already-known id.
      Merged into one `DraftButton` — **found and fixed a real runtime
      bug in the same pass**: the first merge parameterized this by a
      `resolvePollPath(res)` function prop, which crashed immediately
      ("Functions cannot be passed directly to Client Components unless
      ... marked with 'use server'") because the callers are Server
      Components and only Server Actions can cross that boundary as
      functions. Redesigned around a serializable `target` discriminated
      union (`{kind:"stage", stageId}` | `{kind:"constitution",
      projectId}`) instead, with the response-dependent poll-path logic
      moved inside the Client Component itself. Deleted
      `ConstitutionDraftButton.tsx`; updated all 3 call sites (Pipeline
      Detail ×2, Constitution page ×2).
- [x] 4.3 Rewrote `DecisionActions` to use the extracted
      `ApproveRejectButtons` (Task 2.4) instead of its own hand-rolled
      button markup.
- [x] 4.4 Added `src/lib/colors/stageStatus.ts`'s `STAGE_STATUS_TONES`
      map (pipeline/stage status → `StatusTone`) per design.md decision
      4's mapping; replaced every `StageBadge` call site (Dashboard,
      Pipeline Detail ×2, Constitution page) with `StatusBadge`,
      supplying the stage's own label/description as the required
      `reason`; deleted `StageBadge.tsx`. Caught and fixed a visible
      duplicate-text bug this introduced on the Pipeline Detail page:
      `StatusBadge`'s new `reason` already showed the stage's
      description, which a separate pre-existing paragraph directly
      below it was also showing — removed the now-redundant paragraph.
- [x] 4.5 Deleted `BudgetForm.tsx` (confirmed dead code — not imported by
      any current page/component; grep across `src/` found zero
      importers).

Verified live (dev server + seeded DB, not just build/lint): Pipeline
Detail and Constitution pages both render with zero console/page errors,
the merged `DraftButton` and `StatusBadge` render correctly in place, and
the duplicate-text bug is gone after the fix.

## 5. Dashboard, Attention Center, Quick View

- [x] 5.1 The new shell/workspace container applies automatically via
      `layout.tsx` (Task Group 3) to every page including these — no
      per-page change needed here; verified live below.
- [x] 5.2 Migrated `AddProjectForm.tsx` and `AddWorkItemForm.tsx` (both
      previously raw-legacy) to `Button`/`FormField`/`Input`/`Select`.
- [x] 5.3 Migrated `CreateBlockerForm.tsx`, `CreateDecisionForm.tsx`,
      `ResolveBlockerButton.tsx`, `AddDependencyForm.tsx`,
      `RemoveDependencyButton.tsx` to `Button`/`FormField`. Consolidated
      their previously-inconsistent submit-button colors (red for
      blocker, amber for decision, emerald for resolve/add — three ad
      hoc choices, exactly the "every feature chooses its own color"
      problem the redesign exists to fix) onto the same `primary`
      variant every other "Create X" action already uses; `Remove` maps
      to `destructive` (a real removal), matching the same reasoning
      Task Group 4 applied to Approve/Reject.
- [x] 5.4 Verified `QuickViewDrawer` and its embedded `OverviewTab`/
      `DependenciesTab`/`TimelineTab` live against the migrated forms —
      Edit/Create Blocker/Create Decision all render as consistent
      `Button`s with zero console errors.

**Bug found and fixed during live verification, not caught by build/
lint**: `ResolveBlockerButton` and `DecisionActions` rendered as a
full-width purple bar spanning the entire row on the Attention Center,
not a compact button. Root cause: the Attention Center defines its own
local `Row` component (`flex flex-col gap-1.5`, distinct from
`ui/Row.tsx`) with no `items-start`, so flexbox's default
`align-items: stretch` stretched the button's direct wrapping `<div>`
to the row's full width — a pre-existing layout characteristic (the old
raw `<button>` had the identical wrapper), only now visible because this
session is the first time these components were actually visually
verified live rather than just built/linted. Fixed in the components
themselves (`w-fit self-start` on the outer wrapper) rather than
patching every call site's parent, so it can't recur wherever else
these are placed.

## 6. 360° Delivery Record

- [x] 6.1 Migrated `EditWorkItemForm.tsx` (previously raw-legacy, styled
      inconsistently with the `OverviewTab` read view it toggles with)
      to `Button`/`FormField`. Confirmed live: toggling Edit now shows a
      visually consistent form instead of a style mismatch.
- [x] 6.2 Migrated `EvidenceTab.tsx`, `CodeChangesTab.tsx`, `TestsTab.tsx`
      (previously hybrid) fully onto design-system tokens/components —
      their ad hoc `STATE_COLOR`/`STATUS_COLOR` maps (a PR's MERGED/OPEN/
      CLOSED state, a test run's PASSED/FAILED/PENDING status) replaced
      with `StatusBadge` and local `StatusTone` maps, following the same
      pattern as Task Group 4's `STAGE_STATUS_TONES`.
- [x] 6.3 Migrated `DependencyGraph.tsx`'s non-SVG chrome (zoom/reset
      buttons) to `Button`; left the SVG node/edge coloring as direct hex
      values per its existing documented rationale (small, hand-rolled
      visualization, not a token-driven surface) — only its container
      border/background moved to `rounded-card border-border-hairline
      bg-surface-muted` tokens.
- [x] 6.4 Reviewed `OverviewTab`'s progress bar against `ui/Meter`: it
      already used `bg-surface-muted`/`bg-accent` design-system tokens
      (not raw hex), so the "two unrelated treatments" risk was about
      shape (linear vs. circular), not color. A circular gauge doesn't
      fit well inline among the other detail-grid fields (Due date,
      Risk, ...) the way it does as `Meter`'s own standalone budget-
      usage stat, so kept the linear shape but aligned its color source
      with `Meter`'s: fill now uses `var(--gradient-accent)` (the same
      token `IconBadge`/`StatTile` gradients derive from) instead of a
      flat `bg-accent`, plus `tabular-nums` on the percentage and a
      slightly larger track for the redesign's "generous" density.

Verified live (dev server + seeded DB): 360° Record page, Edit form
toggle, and the Code tab all render with zero console/page errors under
the new shell. (One transient 22,232px-tall `fullPage` screenshot from
an earlier capture attempt was investigated via direct DOM measurement —
no element was actually oversized — and did not reproduce on a clean
re-capture; treated as a Playwright capture glitch, not a product bug.)

## 7. Login

- [x] 7.1 Migrated `src/app/login/page.tsx` (previously the only page
      with zero design-system-token usage) to `Button`/`FormField`.
      Since removing the old global top header (Task Group 3) took away
      the only place the product name was shown to a signed-out visitor,
      added a small brand mark + wordmark above the sign-in card here so
      that identity isn't lost, not just token-swapped styling. Verified
      live: default state and the invalid-credentials error state
      (`?error=1`) both render correctly with zero console errors.

## 8. Audit Trail

- [x] 8.1 Migrated `src/app/audit/page.tsx`'s filter form to
      `FormField`/`Button`. Pagination links needed a button-styled
      `Link`, which surfaced that `Button` had no way to render as a
      link (no `asChild`/Slot primitive in this codebase's dependencies)
      — exported `buttonClasses()`/`buttonStyle()` from `Button.tsx` so
      a `Link` can apply the identical visual treatment directly, rather
      than either adding an unsupported prop or hand-approximating the
      styling a second time.
- [x] 8.2 Replaced its hand-rolled event-row markup with the shared
      `AuditEventRow` (2.5), keeping its existing server-side query-param
      pagination. Verified live: filters, event rows (including a
      variable-length meta line and a JSON detail dump), and pagination
      controls all render correctly with zero console errors.

## 9. Pipeline Detail

- [x] 9.1 Migrated `src/app/pipelines/[id]/page.tsx`'s page chrome
      (stage cards, headers) to `Panel`/design-system tokens, replacing
      the raw-legacy bordered `<div>` pattern — the most raw-legacy page
      in the whole product per the original investigation, now fully
      token-driven. Found and fixed a real bug of my own making in the
      same pass: swapping the stage card's wrapping `<div>` for `Panel`
      initially dropped `data-stage-id` in favor of `Panel`'s own `id`
      prop — a different attribute, not the same one — which would have
      silently broken any E2E selector depending on `data-stage-id`.
      Caught before it shipped; extended `Panel` to accept `data-*`
      passthrough props instead of conflating the two.
- [x] 9.2 Migrated `ClarifyPanel.tsx` and `AnalyzeFindingsPanel.tsx` to
      `Button`/`FormField`/`StatusBadge`-adjacent tokens. `Analyze`'s 5
      raw severity hues (red/orange/amber/yellow/gray) collapsed onto
      the design system's tokens: CRITICAL and HIGH both map to
      `text-status-critical` (both urgent enough to flag the same way),
      MEDIUM/WARNING to `text-status-warning`, INFO to
      `text-status-inactive` — an intentional reduction (5 arbitrary
      hues → the product's real 5-tone status system), not an oversight.
- [x] 9.3 Migrated `StageVersionHistory.tsx` to design-system tokens.
- [x] 9.4 Verified `ApprovalGate`/`DraftButton`/`StatusBadge` (already
      migrated in Task Group 4) render correctly in place on this page —
      confirmed live, zero console errors, `data-stage-id` present on
      both rendered stage cards after the `Panel` fix.

## 10. Project Settings

- [x] 10.1 Migrated `src/app/projects/[id]/settings/page.tsx`'s page
      chrome to `Panel`/design-system tokens. Connector/sync-run raw
      color maps (`text-emerald-600`/`text-red-600`/`text-blue-600`)
      replaced with `StatusBadge` + local `StatusTone` maps
      (`CONNECTOR_STATUS_TONES`, `RUN_STATUS_TONES`), following the same
      pattern as Task Groups 4 and 6.
- [x] 10.2 Migrated `ConnectorConfigForm.tsx` to `FormField`/`Button`.
- [x] 10.3 Migrated `SyncButton.tsx`, `ConflictResolutionPanel.tsx`,
      `RepositoryLinkForm.tsx` to `Button` and status tokens. Verified
      live: connector status badge, type selector, and Save button all
      render correctly with zero console errors.

## 11. Constitution

- [x] 11.1 Migrated `src/app/projects/[id]/constitution/page.tsx`'s page
      chrome to `Panel`/design-system tokens; verified the now-shared
      `ApprovalGate`/`DraftButton` (Task Group 4) render correctly here —
      live check with zero console errors, "Draft with AI" renders as
      the consistent primary `Button`.

## 12. Configuration Center

- [x] 12.1 Migrated `src/app/organizations/[id]/config/page.tsx`'s page
      chrome to `Panel`/design-system tokens.
- [x] 12.2 Migrated `ConfigBudgetPanel.tsx` (including its preview/
      confirm-cascade card) to `FormField`/`Button`. `ConfigHistoryList.tsx`
      rebuilt on `Row`'s column-grid mode (deferred here from Task Group 2
      since its 3 fields — value change, changed-by, when — are genuinely
      fixed and comparable, unlike the audit feed's variable content).
      Verified live: header row + aligned columns render as a clean,
      readable table with zero console errors — validates both the
      column-grid primitive itself and the Task Group 2 decision to defer
      its real use here instead of forcing it onto the audit feed.

## 13. RTL & i18n verification

- [x] 13.1 Extended `e2e/slice8-i18n-rtl.spec.ts` (not a new spec file,
      per this project's established pattern) with two new steps: the
      redesigned branded sidebar sits at the mirrored (right) edge under
      RTL (was the left-hand rail under LTR), and `Row`'s column-grid
      mode (Configuration Center's budget history) still renders
      correctly under RTL — a structural check, since Configuration
      Center is outside Slice 8's Hebrew-translated four-surface scope.
      Ran the full spec live against the real dev server + worker
      (`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npx
      playwright test e2e/slice8-i18n-rtl.spec.ts`, since the pinned
      headless-shell binary isn't installed in this environment — the
      project's own `playwright.config.ts` already documents this exact
      escape hatch): all 13 steps pass, including the two new ones.
- [x] 13.2 Checked for newly-visible strings needing translation keys via
      `git diff` against every file this change touched: `NavRail`'s
      actual nav labels still route through the existing `t.nav.*` keys
      (unchanged); `Login`'s strings ("Email," "Password," "Delivery
      Control Center") were already hardcoded/untranslated before this
      redesign (the brand name was hardcoded in the old top header too,
      Login was always outside Slice 8's four-surface scope) — this
      change relocates them, it doesn't newly introduce them. No new
      translation keys needed; no coverage regression.

## 14. Tests

- [x] 14.1 Unit tests for any new pure logic. `Row`'s `columns` prop is a
      straight pass-through string (no computation to extract/test);
      the new pure logic this redesign actually introduced is
      `stageStatusTone()`/`stageStatusLabel()`
      (`src/lib/colors/stageStatus.ts`), covered by
      `src/lib/colors/stageStatus.test.ts`. Full unit suite: 300 passed.
- [x] 14.2 Updated E2E selectors broken by markup changes. Found and
      fixed one: `e2e/slice6-configuration-center.spec.ts`'s AI Budget
      locator assumed a bare `<section>`; Task Group 12 wrapped it in a
      `Panel` (a styled div), so the selector now matches on the
      Panel's own `rounded-lg` class instead — the same pattern already
      used for project cards elsewhere in this suite. No other spec
      file's selectors were broken by the redesign's markup changes
      (behavior assertions were unaffected, as expected).
- [x] 14.3 Added `e2e/slice10-visual-redesign.spec.ts`, asserting the
      branded sidebar and rounded workspace container render on both
      the Dashboard and Pipeline Detail (a legacy Slice 2 page migrated
      to `Panel`-based markup in Task Group 9), confirming the redesign
      reached beyond the Dashboard.

  Full E2E suite run (all 11 spec files, clean DB) — 15/15 passed,
  1 known pre-existing failure investigated and ruled out as a Slice 10
  regression:

  - `slice4-connector-framework.spec.ts`'s hydration-mismatch console
    error (`QuickViewDrawer`'s `<div className="fixed inset-0 ...">`
    not matching between server and client render) reproduces
    identically on `92c7483` (the last commit before this change,
    verified via a throwaway `git worktree` running the old code on a
    separate port) — same component, same stack trace, untouched by
    this redesign. Pre-existing, out of scope here.
  - `slice6-configuration-center.spec.ts` failed on a first full-suite
    run with a stale `Default Client` budget override ($50) left by an
    earlier manual verification pass this session, then failed *again*
    on a second full-suite run because the test's own "Client scope"
    step (which sets that same override) never resets it before
    finishing — the exact same non-idempotent-test-design gap already
    documented and accepted as out of scope in
    `openspec/changes/dashboard-motifs-refresh/tasks.md` (Slice 9,
    predates this change). Confirmed passing standalone against a
    clean DB. Not a Slice 10 regression; not fixed here, matching the
    established precedent.
  - Separately (not a code bug): `slice5-engineering-evidence.spec.ts`
    timed out on a fresh Dashboard load because the local dev DB had
    accumulated 101 leftover test-created projects from this session's
    live-verification work (all E2E specs create projects and never
    delete them), rendering ~100 "+ Add work item" buttons and
    degrading the page enough to blow past the test timeout. Cleaned
    up (deleted every project except the seed's `DCC`); re-ran and
    passed in 22s. Not a design-system or redesign issue.

## 15. Documentation & verification

- [ ] 15.1 Run `/verify` (build + lint + a live check): load every
      migrated screen in a running dev server, confirm shell/sidebar,
      spot-check RTL on at least one migrated legacy screen, screenshot
      the Dashboard and one legacy-turned-migrated screen (e.g. Pipeline
      Detail) side by side with the reference image for a visual
      sanity check per the source document's "Final Visual Test."
- [ ] 15.2 Update `docs/ROADMAP.md`'s Slice 10 row and detail section to
      **Done**, linking this change's archive path, following the same
      pattern as Slices 0-9.
