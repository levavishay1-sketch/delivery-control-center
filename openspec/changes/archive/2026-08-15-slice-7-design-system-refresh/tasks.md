## 1. Design tokens

- [x] 1.1 Added a Tailwind v4 `@theme` block to `src/app/globals.css`: neutral scale (11 steps, light + dark), one accent color, five status-semantic colors (healthy/active/ai/warning/critical, each with a paired `-bg`), a 6-step type scale (2xs–xl), and two elevation treatments (`--shadow-floating`/`--backdrop-floating` for floating; flat is the default hairline-border style with no shadow token needed).
- [x] 1.2 Added `lucide-react`. No postinstall script — nothing to approve.

## 2. Base components

- [x] 2.1 Created `src/components/ui/StatusBadge.tsx` — `reason: string` is a required prop, so a screen omitting it fails to build.
- [x] 2.2 Created `src/components/ui/Row.tsx` (`RowList`, `Row`, plus loading/empty/error states).
- [x] 2.3 Created `src/components/ui/Panel.tsx` (plus loading/empty/error states).
- [x] 2.4 Loading/empty/error states implemented directly in `Row.tsx`/`Panel.tsx` as `RowLoading`/`RowEmpty`/`RowError` and `PanelLoading`/`PanelEmpty`/`PanelError`.

## 3. Navigation rail

- [x] 3.1 Created `src/components/NavRail.tsx`, wired into `layout.tsx`. **Deviation**: tasks.md's literal destination list ("Pipelines," "Configuration") doesn't fully match existing routes — there is no global pipelines index (only `/pipelines/[id]` detail), so it's omitted rather than inventing a new route in a UI-only slice; Configuration links to the user's organization (org-admin only, reusing Slice 6's `listOrganizations`), the only Configuration destination that actually exists. Documented inline in `NavRail.tsx`.
- [x] 3.2 Each rail link is a real `<Link>` with `aria-label`, natively keyboard-focusable/activatable; no custom key handling needed.

## 4. Dashboard & Attention Center restyle

- [x] 4.1 `SummaryChip` replaces `SummaryCard`; chips filter via existing `#anchor` links (in-place scroll, no page nav).
- [x] 4.2 Attention Center sections restyled with `RowList`/`StatusBadge`; every row's status carries its required reason inline.
- [x] 4.3 Quick Access kept as cards (per the row-vs-card rule); Recent Activity converted to `RowList`.
- [x] 4.4 No domain/query code touched; `attention/queries.test.ts` and the rest of the unit suite pass unchanged (270/270).

## 5. Quick View drawer restyle

- [x] 5.1 Backdrop uses `--backdrop-floating`, panel uses `--shadow-floating` plus a 180ms `drawer-in` keyframe (`animate-drawer-in` in `globals.css`).
- [x] 5.2 Blocker/decision panels in `OverviewTab` (shared by Quick View and the 360° Record) restyled with `StatusBadge`; blocker/decision panels also moved above the description/metadata block, matching the design direction's "blocker panel first" priority order. No change to data shape or the `?quickView=<id>` mechanism.

## 6. 360° Delivery Record restyle

- [x] 6.1 `WorkItemTabs`' active tab now uses the accent color, matching the nav rail's active-state treatment.
- [x] 6.2 Overview tab restyled with tokens; blocker/decision panels promoted above the field grid. **Deviation**: no "collapsed Details disclosure" was added — `OverviewTab` doesn't currently render any raw IDs/timestamps/sync-provenance fields in its main view (provenance is already an inline `ⓘ` affordance, not a metadata dump), so there was nothing to move into a disclosure.
- [x] 6.3 Configuration tab's stub now states its reason explicitly via `PanelEmpty` ("not configured at the work-item level... inherits from Project"), satisfying the design-system spec's empty-tab requirement. Tab order also changed to Overview → Dependencies → Evidence → Code → Tests → Timeline → Configuration, per the design direction §5.
- [x] 6.4 Applied a token sweep (border/divide/hover-background classes → `border-border-hairline`/`divide-border-hairline`/`bg-surface-muted`) across `DependenciesTab`, `TimelineTab`, `CodeChangesTab`, `TestsTab`, `EvidenceTab`. **Deviation**: did not restructure these five components onto the `Row`/`Panel` components themselves — a full componentization of five additional files was more than a token-consistency pass required, and their existing internal structure (graphs, tables, forms) doesn't map cleanly onto a generic row/panel shape. The token sweep achieves the design-system spec's actual requirements (hairline borders, no third elevation level, no black/white opacity hacks) without forcing an unrelated structural rewrite.

## 7. Verification

- [x] 7.1 `npm run build` ✓, `npm run lint` ✓, `npx tsc --noEmit` ✓ (clean, no pre-existing gap this run), `npm test` ✓ (270/270).
- [x] 7.2 Full Playwright suite: 10/10 passing. Fixed real selector drift from the restyle (project-card `id` moved onto the wrong element; `StatusBadge`'s split label/reason spans broke concatenated-text assertions; an ambiguous `div`-by-text locator now matched a nested `StatusBadge` wrapper instead of the row). Also fixed two pre-existing, unrelated flakiness sources surfaced by re-running against the shared dev database: two E2E specs asserted on singular append-only `ConfigChange` history entries (now `.first()`); and `slice3-budget-enforcement.spec.ts` depended on a page-specific "← Back to Dashboard" link that doesn't exist on `/pipelines/[id]` (a pre-existing navigation gap, already noted in this session before Slice 7 started) — fixed by using the new nav rail's "Dashboard" link, which now works from every page.
- [x] 7.3 Live-verified with Playwright-driven Chromium against the seeded database, in both `light` and `dark` `colorScheme`: Dashboard, Attention Center, and a 360° Delivery Record page. Screenshots captured and delivered to the user.
- [x] 7.4 This file, plus `docs/PRODUCT_SPEC.md` and `docs/ROADMAP.md`'s Slice 7 entry, updated to reflect the as-built state.
