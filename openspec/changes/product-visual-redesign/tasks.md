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

- [ ] 2.1 Add `src/components/ui/Button.tsx`: `primary`/`secondary`/
      `destructive` variants per design.md decision 5, one size/radius/
      padding scale.
- [ ] 2.2 Add a form-field primitive (`src/components/ui/FormField.tsx`
      or similar) wrapping `input`/`select`/`textarea` with shared
      border/padding/radius/focus/required/error presentation.
- [ ] 2.3 Extend `src/components/ui/Row.tsx` with an optional `columns`
      prop (CSS grid, `text-start` per cell) per design.md decision 3;
      add an optional `RowListHeader` sibling for column headers.
- [ ] 2.4 Extract `ApproveRejectButtons` (comment-optional) as the shared
      building block `ApprovalGate`/`DecisionActions` will both use, per
      design.md decision 4.
- [ ] 2.5 Add `AuditEventRow` (actor icon, action text, relative time,
      actor/project/pipeline meta line, optional detail dump) per
      design.md decision 4's audit-feed convergence — used by both the
      Audit Trail page and `TimelineTab`, each keeping its own
      pagination mechanism.

## 3. Application shell

- [ ] 3.1 Rebuild `NavRail` as a permanently-expanded branded sidebar
      (drop the `w-14` icon-only breakpoint) using `--color-sidebar-
      surface`, per design.md decision 6: product identity at top, nav
      items with icon+label, existing `aria-current` active-pill logic
      kept and restyled, account context (email + sign-out, moved from
      the top header) at the bottom.
- [ ] 3.2 Restructure `src/app/layout.tsx`: remove the separate top
      header strip, fold its content into the sidebar (3.1) and each
      page's own header row; wrap `{children}` in the new white
      `--surface` workspace container inset from the sidebar/viewport
      edges against the `--surface-page` background.
- [ ] 3.3 Verify `QuickViewDrawer` and `CommandPalette` (both already
      token-driven) render correctly against the new shell — no
      functional change expected, visual check only.

## 4. Consolidation

- [ ] 4.1 Diff `ApprovalGate.tsx` and `ConstitutionApprovalGate.tsx` to
      confirm they differ only in API path (per this session's
      investigation), then merge into one `ApprovalGate` taking an
      `apiBasePath` prop; delete `ConstitutionApprovalGate.tsx`; update
      the Constitution page's import.
- [ ] 4.2 Diff `DraftButton.tsx` and `ConstitutionDraftButton.tsx`
      likewise; merge into one `DraftButton` taking `apiBasePath`/
      `pollPath` props; delete `ConstitutionDraftButton.tsx`; update the
      Constitution page's import.
- [ ] 4.3 Rewrite `DecisionActions` to use the extracted
      `ApproveRejectButtons` (Task 2.4) instead of its own hand-rolled
      button markup.
- [ ] 4.4 Add `STAGE_STATUS_TONES` (pipeline/stage status → `StatusTone`)
      per design.md decision 4's mapping; replace every `StageBadge`
      call site with `StatusBadge`, supplying the stage's own label/
      description as the required `reason`; delete `StageBadge.tsx`.
- [ ] 4.5 Delete `BudgetForm.tsx` (confirmed dead code — not imported by
      any current page/component).

## 5. Dashboard, Attention Center, Quick View

- [ ] 5.1 Apply the new shell/workspace container and any token changes
      to `src/app/page.tsx` and `src/app/attention/page.tsx` — both
      already design-system-token-driven, so this is adoption of the new
      shell/spacing, not a rewrite.
- [ ] 5.2 Migrate `AddProjectForm.tsx` and `AddWorkItemForm.tsx` (both
      currently raw-legacy) to the new `Button`/`FormField` primitives.
- [ ] 5.3 Migrate `CreateBlockerForm.tsx`, `CreateDecisionForm.tsx`,
      `ResolveBlockerButton.tsx`, `AddDependencyForm.tsx`,
      `RemoveDependencyButton.tsx` to `Button`/`FormField`, reusing
      `ApproveRejectButtons` (2.4) where applicable.
- [ ] 5.4 Verify `QuickViewDrawer` and its embedded `OverviewTab`/
      `DependenciesTab`/`TimelineTab` render correctly with the migrated
      forms above (they're shared between Quick View and the 360 page).

## 6. 360° Delivery Record

- [ ] 6.1 Migrate `EditWorkItemForm.tsx` (currently raw-legacy, styled
      inconsistently with the `OverviewTab` read view it toggles with)
      to `Button`/`FormField`.
- [ ] 6.2 Migrate `EvidenceTab.tsx`, `CodeChangesTab.tsx`, `TestsTab.tsx`
      (currently hybrid) fully onto design-system tokens/components.
- [ ] 6.3 Migrate `DependencyGraph.tsx`'s non-SVG chrome (zoom/reset
      buttons, legend) to `Button`; leave the SVG node/edge coloring as
      direct hex values per its existing documented rationale (small,
      hand-rolled visualization, not a token-driven surface).
- [ ] 6.4 Replace `OverviewTab`'s hand-rolled linear progress bar with
      either the new `Row` column-grid pattern or a linear variant
      consistent with `ui/Meter`'s existing track+fill visual language
      (do not silently keep two unrelated "progress" treatments).

## 7. Login

- [ ] 7.1 Migrate `src/app/login/page.tsx` (currently the only page with
      zero design-system-token usage) to the new shell's page-header
      pattern, `Button`, and `FormField` — this page renders before
      `session?.user` exists, so it does not get the sidebar, but does
      get the new page background/workspace container treatment.

## 8. Audit Trail

- [ ] 8.1 Migrate `src/app/audit/page.tsx`'s filter form to `FormField`/
      `Button`.
- [ ] 8.2 Replace its hand-rolled event-row markup with the shared
      `AuditEventRow` (2.5), keeping its existing server-side query-param
      pagination.

## 9. Pipeline Detail

- [ ] 9.1 Migrate `src/app/pipelines/[id]/page.tsx`'s page chrome (stage
      cards, headers) to `Panel`/`Row`/design-system tokens, replacing
      the raw-legacy bordered `<section>` pattern.
- [ ] 9.2 Migrate `ClarifyPanel.tsx` and `AnalyzeFindingsPanel.tsx` to
      `Button`/`FormField`/`StatusBadge` (severity groups → status
      tones).
- [ ] 9.3 Migrate `StageVersionHistory.tsx` to design-system tokens.
- [ ] 9.4 Verify `ApprovalGate`/`DraftButton`/`StatusBadge` (already
      migrated in Task Group 4) render correctly in place on this page.

## 10. Project Settings

- [ ] 10.1 Migrate `src/app/projects/[id]/settings/page.tsx`'s page
      chrome to `Panel`/design-system tokens.
- [ ] 10.2 Migrate `ConnectorConfigForm.tsx` to `FormField`/`Button`.
- [ ] 10.3 Migrate `SyncButton.tsx`, `ConflictResolutionPanel.tsx`,
      `RepositoryLinkForm.tsx` to `Button` and status tokens.

## 11. Constitution

- [ ] 11.1 Migrate `src/app/projects/[id]/constitution/page.tsx`'s page
      chrome to `Panel`/design-system tokens; verify the now-shared
      `ApprovalGate`/`DraftButton` (Task Group 4) render correctly here.

## 12. Configuration Center

- [ ] 12.1 Migrate `src/app/organizations/[id]/config/page.tsx`'s page
      chrome to `Panel`/design-system tokens.
- [ ] 12.2 Migrate `ConfigBudgetPanel.tsx` (including its preview/
      confirm-cascade card) and `ConfigHistoryList.tsx` to `FormField`/
      `Button`.

## 13. RTL & i18n verification

- [ ] 13.1 Verify the new sidebar, `Row` column-grid mode, `Button`, and
      `FormField` all render correctly under `dir="rtl"` — extend
      `e2e/slice8-i18n-rtl.spec.ts` rather than starting a new spec file,
      per this project's established pattern.
- [ ] 13.2 Add any missing translation keys for newly-visible strings
      introduced by the shell restructure (e.g. if account context moves
      to a new sidebar location with new label text) to `en.ts`/`he.ts`.

## 14. Tests

- [ ] 14.1 Unit tests for any new pure logic (e.g. `Row`'s column-grid
      width computation, if extracted as a testable helper).
- [ ] 14.2 Update E2E selectors across every existing spec file broken
      by markup changes (raw `<select>`/`<button>` becoming styled
      components) — behavior assertions should not need to change, since
      no user-facing behavior changes; run the full existing suite after
      each task group above, not only at the end.
- [ ] 14.3 Add or extend an E2E scenario asserting the new shell renders
      (sidebar present, workspace container present) on at least the
      Dashboard and one previously-unmigrated page (e.g. Pipeline
      Detail), confirming the redesign reached beyond the Dashboard.

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
