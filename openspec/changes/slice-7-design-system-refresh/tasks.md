## 1. Design tokens

- [ ] 1.1 Add a Tailwind v4 `@theme` block to `src/app/globals.css` defining: neutral color scale (light + dark), one accent color, five status-semantic colors (green/blue/purple/amber/red), a 4–5-step type scale, an 8px spacing baseline reference, and two named elevation treatments (flat, floating).
- [ ] 1.2 Add the Lucide icon package dependency; verify `npm install-scripts approve` is not required (no postinstall script) or run it if it is.

## 2. Base components

- [ ] 2.1 Create `src/components/ui/StatusBadge.tsx`: color + icon + label, with a required (non-optional) `reason: string` prop; covers the five status-semantic states plus a neutral/inactive state.
- [ ] 2.2 Create `src/components/ui/Row.tsx`: a bordered list-row primitive (flat elevation) for use in the Attention Center feed and similar collections, distinct from card treatment.
- [ ] 2.3 Create `src/components/ui/Panel.tsx`: a flat-elevation grouped-detail container for on-page sections (Overview tab, config panels).
- [ ] 2.4 Define shared loading/empty/error state presentation for the `Row`-based list pattern and the `Panel` pattern (one implementation per pattern, reused everywhere it applies).

## 3. Navigation rail

- [ ] 3.1 Replace the current inline text-link navigation in `layout.tsx` with a persistent left icon+label rail (Attention, Dashboard, Pipelines, Audit, Configuration), collapsed to icons with hover/expand labels.
- [ ] 3.2 Verify the rail is keyboard-navigable and each link has an accessible label.

## 4. Dashboard & Attention Center restyle

- [ ] 4.1 Restyle the Attention Summary section on `/` using chip-style counters (not KPI cards) that filter the feed in place.
- [ ] 4.2 Restyle `/attention`'s grouped sections (Decisions, Blockers, Risks, Deadlines, Approval Gates) using `Row` + `StatusBadge`, with the required reason inline and the recommended action as a real button per row.
- [ ] 4.3 Restyle the Dashboard's Quick Access project tiles as cards (unlike the row-based feed, per the design-system spec's row-vs-card rule) and the Recent Activity feed as rows.
- [ ] 4.4 Verify existing `attention/queries.test.ts` coverage and manual data correctness are unaffected (visual-only change) — no domain/query code should need edits for this task group.

## 5. Quick View drawer restyle

- [ ] 5.1 Apply floating elevation (shadow + backdrop dim) to `QuickViewDrawer`; verify open/close transition timing (150–200ms) and no visible data-refetch flash.
- [ ] 5.2 Restyle the drawer's blocker/decision panels and action buttons using `StatusBadge`/`Panel`, without changing what data renders or the `?quickView=<id>` trigger mechanism.

## 6. 360° Delivery Record restyle

- [ ] 6.1 Restyle `WorkItemTabs` using the accent color for the active tab, consistent with the navigation rail's active-state treatment.
- [ ] 6.2 Restyle the Overview tab using `Panel` for grouped sections and `StatusBadge` for status/risk, moving raw metadata (IDs, timestamps, sync provenance) into a collapsed "Details" disclosure.
- [ ] 6.3 Restyle the Configuration tab's empty state (work-item scope, currently a stub) to explicitly state why it's empty ("not configured at this level"), per the design-system spec's empty-tab requirement.
- [ ] 6.4 Apply `Row`/`Panel` treatment to the Dependencies, Timeline, Code & Changes, Tests, and Evidence tabs' existing content without changing their data or logic.

## 7. Verification

- [ ] 7.1 Run `npm run build`, `npm run lint`, `npx tsc --noEmit`, `npm test` — confirm no regressions from the visual-only change.
- [ ] 7.2 Run the full Playwright E2E suite; fix any selector drift the same way Slice 6 fixed `slice3-budget-enforcement.spec.ts` (update stale assertions to match new DOM structure, without changing what's being asserted).
- [ ] 7.3 Live-verify in a browser (light and dark mode) against the seeded database: Dashboard, Attention Center, Quick View drawer open/close/resolve flow, and a 360° Delivery Record page with all tabs.
- [ ] 7.4 Update `docs/PRODUCT_SPEC.md` and `docs/ROADMAP.md`'s Slice 7 entry to "Done" with as-built detail, per this project's spec-anchored documentation policy.
