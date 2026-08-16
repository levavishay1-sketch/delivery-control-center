## Context

This session's investigation (before any code was written) read every one
of the product's 9 routes and ~30 shared/feature components. Finding,
verbatim from that investigation:

> Two distinct styling systems coexist in this codebase: a "legacy raw"
> style (hard-coded Tailwind, ad hoc colors, inconsistent radii) and a
> "design-system" style (semantic tokens + `src/components/ui/*`
> primitives). [...] Nearly every page/component falls cleanly into one
> bucket or the other.

Design-system-compliant today: Dashboard (`src/app/page.tsx`), Attention
Center, `NavRail`, `CommandPalette`, `QuickViewDrawer`'s shell,
`OverviewTab`'s read view, `DependenciesTab`/`TimelineTab` (tokens only,
plain markup).

Still legacy-raw today: Login, Audit Trail, Pipeline Detail (+8 sub-
components), Project Settings (+4 sub-components), Constitution,
Configuration Center (+3 sub-components), every cross-cutting mutation
form (`EditWorkItemForm`, `AddWorkItemForm`, `AddProjectForm`,
`CreateBlockerForm`, `CreateDecisionForm`, `DecisionActions`,
`ResolveBlockerButton`, `AddDependencyForm`, `RemoveDependencyButton`),
`EvidenceTab`/`CodeChangesTab`/`TestsTab`/`DependencyGraph` (hybrid).

Real duplication found: `ApprovalGate`/`ConstitutionApprovalGate` (differ
only in API path), `DraftButton`/`ConstitutionDraftButton` (same),
`DecisionActions` (a third near-duplicate approve/reject pair),
`StageBadge` (a second, independent status-badge system with its own
color map and no "reason" requirement, parallel to `ui/StatusBadge`), two
independent audit-feed implementations (`audit/page.tsx`, server-paginated
vs. `TimelineTab.tsx`, client-paginated — same actor-icon map, same row
shape, different styling and pagination), and dead `BudgetForm.tsx`
(superseded by `ConfigBudgetPanel`, referenced only from archived
OpenSpec docs).

The existing `design-system` spec (Slice 7/9) already establishes real
constraints this redesign must work within or explicitly amend: exactly
two elevation levels (flat/floating), rows-not-cards for comparable
collections, one accent color reserved for actions/active-state, every
status carries color+icon+reason, every list/panel/tab defines its four
data states, and full RTL structural mirroring with no locale-specific
component variant.

See `proposal.md` for the full motivation and scope list.

## Goals / Non-Goals

**Goals:**
- Extract the reference's complete visual language (shell composition,
  sidebar, card/typography/spacing/button/badge/table treatment) as
  concrete token and component decisions, not a vague "make it purple."
- Close the legacy/design-system gap the investigation found — migrate
  every screen and component to one shared visual system, consolidating
  the real duplication found rather than adding a third parallel pattern.
- Reconcile every point where the reference's direction and the existing
  design-system spec appear to conflict, explicitly, in this document —
  never silently override an existing requirement (CLAUDE.md).
- Preserve every existing route, form field, business rule, and
  permission check exactly as investigated.

**Non-Goals:**
- No new domain feature, entity, Prisma model, or API route.
- No redesign of the underlying information architecture beyond what's
  needed to host the new shell (e.g., no new pages, no route renames).
- No dark-mode-specific redesign — dark mode continues to derive from the
  same tokens via `color-mix()`, as Slice 7/9 already established.
- No mobile-first rework; desktop is the primary target per the source
  document, responsive behavior is preserved/extended, not redesigned.
- Not attempting literal pixel-parity with the reference's own business
  content (fake users/projects/budgets) — only its visual language,
  applied to this product's real data, per the source document's explicit
  instruction.

## Decisions

### 1. The sidebar's brand color is the existing accent hue, not a new color

The reference's sidebar is a deep purple; this product's existing
`--color-accent` (`#4f46e5`, Slice 7) is already an indigo/violet in the
same family. Rather than introducing an unrelated second brand color,
the sidebar surface is derived from the *same* accent hue via
`color-mix()` — e.g. `--color-sidebar-surface: color-mix(in srgb,
var(--color-accent), black 55%)` — following the exact pattern Slice 9's
`--gradient-accent`/`--shadow-glow-accent` tokens already use to derive
variants from a single source color. This keeps the product to one true
brand hue (satisfying the spirit of "one accent color," see Decision 2)
while matching the reference's visual weight.

**Alternative considered**: pick a new standalone purple matching the
reference's exact hex. Rejected — it would give the product two
unrelated "purples" (accent buttons vs. sidebar) that happen to look
similar instead of literally being the same color, undermining the "one
accent color" principle rather than extending it.

### 2. Reconciling the single-accent-color rule: shell identity vs. decorative emphasis

The existing `design-system` spec requires: "The system SHALL use a
single accent color across the product exclusively for primary actions
and active navigation/tab state, and SHALL NOT use the accent color for
purely decorative emphasis." The reference's branded sidebar is a large,
non-text surface — read literally, this could look like exactly the
"decorative emphasis" the rule forbids.

It isn't, and the delta spec's `MODIFIED Requirements` states why
explicitly rather than leaving the tension unresolved: the sidebar is
**one singular, structural, product-identity surface** (the application
shell itself, present exactly once, in exactly one place) — categorically
different from sprinkling the accent color across page content as
decoration. The rule's real intent (never let the accent color become
ambient decoration that competes with status/type color-coding on page
content) is preserved; the requirement's wording is extended to name the
shell surface as a second permitted, bounded use, alongside actions and
active state — not opened up generally.

### 3. Row/RowList gains an optional column-grid mode instead of a new Table component

The reference's "recent activity" surface is a genuine multi-column table
(avatar, project, task, priority, status, AI confidence, updated,
actions). The existing `design-system` spec requires comparable
collections to render as `Row`s in a `RowList`, not cards or a literal
`<table>`. Rather than introduce a competing `Table` primitive (which
would fork the row-vs-card rule into a three-way choice), `Row` gains an
optional `columns` prop rendering its children in a CSS grid with
consistent column widths/alignment across all rows in the same
`RowList`, keeping the semantic list markup (`role`-free `div`s, already
the pattern) and RTL behavior (`text-start` alignment, already used by
`CommandPalette`) that the existing component has. Column headers become
an optional `RowListHeader` sibling.

**Alternative considered**: a real `<table>` element. Rejected — the
existing accessibility/RTL patterns (`Row`'s `href` wrapping, hover
states, `text-start`) are already proven across the product; a parallel
table-semantics implementation would duplicate rather than extend them,
and the reference's own "avoid heavy grids and excessive borders"
instruction favors the lighter row treatment already in use.

### 4. Consolidating duplicate components: parameterize, don't re-abstract

- `ApprovalGate`/`ConstitutionApprovalGate` → one `ApprovalGate` taking
  an `apiBasePath` prop (`/api/stages/{id}` vs. `/api/constitutions/{id}`)
  instead of two files with identical JSX.
- `DraftButton`/`ConstitutionDraftButton` → one `DraftButton` taking the
  same kind of `apiBasePath` prop, plus a `pollPath` for the status-poll
  endpoint (they already differ only here).
- `DecisionActions` → reuses the same approve/reject button pair
  `ApprovalGate` now exposes as an internal building block (extracted as
  `ApproveRejectButtons`), rather than staying a third hand-rolled copy.
  `DecisionActions` keeps its own component identity (no comment field,
  different endpoint) but stops duplicating the button markup/styling.
- `StageBadge` → retired. Every caller switches to `StatusBadge`. Pipeline/
  constitution/stage statuses (`PENDING`, `AI_DRAFTING`,
  `PENDING_APPROVAL`, `APPROVED`, `DONE`, `REJECTED`, etc.) map onto the
  existing `StatusTone` scale (e.g. `DONE`→`healthy`, `REJECTED`→
  `critical`, `AI_DRAFTING`→`ai`, `PENDING_APPROVAL`→`active`,
  `PENDING`→`inactive`) via a new `STAGE_STATUS_TONES` map in
  `src/components/StageBadge.tsx`'s replacement location (folded into
  `ui/StatusBadge.tsx`'s tone-mapping pattern, matching how
  `workItemType.ts` already sits alongside it). Every call site must now
  supply a `reason` (design-system spec's existing requirement,
  previously unenforced for stage status) — for pipeline/constitution
  contexts, the reason is the stage's own label/description text already
  computed by `getStageConfigOrFallback`, not new copy.
- The two audit-feed implementations (`audit/page.tsx`,
  `TimelineTab.tsx`) converge on one presentation: a shared
  `AuditEventRow` component (actor icon, action text, relative time,
  actor/project/pipeline meta line, optional detail dump) used by both,
  with each screen keeping its own pagination mechanism (server query-
  param pagination for the full Audit Trail page, client fetch-pagination
  for the per-work-item Timeline tab) since those differ for a real
  reason (global vs. scoped feed) documented in the investigation, not
  merged away.
- `BudgetForm.tsx` is deleted — confirmed dead (not imported by any
  current page/component, referenced only in archived OpenSpec docs).

### 5. New `Button` and form-field primitives, not per-form styling

Every mutation form today hand-rolls its own button colors
(`bg-emerald-600`, `bg-red-600`, `bg-foreground`) and input borders
(`border-black/15 dark:border-white/20`). Two new primitives in
`src/components/ui/`:
- `Button`: `variant` of `primary` (accent gradient, matches
  `IconBadge`'s existing gradient pattern), `secondary` (neutral
  bordered), `destructive` (critical-status-colored, for reject/remove/
  unlink actions), each in one consistent size/radius/padding.
- `FormField`: a labeled wrapper around `input`/`select`/`textarea`
  sharing one border/padding/radius/focus treatment, with built-in
  required-field and validation-error presentation.

Every migrated form (18+ components named in `proposal.md`) is
rewritten to use these instead of inventing new markup, per CLAUDE.md's
design-system rule.

### 6. Application shell: sidebar width, workspace container, page background

- `NavRail` is rebuilt as a permanently-expanded sidebar (no more
  `w-14`/icon-only collapse breakpoint) at a fixed comfortable width
  (reference-matched proportions), rendering product identity at the top,
  nav items with icon+label and the existing `aria-current`-driven active
  pill (kept, restyled to the new sidebar's contrast), and account
  context (user email + sign-out, currently in the top header bar) moved
  to the sidebar's bottom, matching the reference.
- The top header bar (`src/app/layout.tsx`) is removed as a separate
  strip; its remaining content (page-independent global search entry,
  notifications if any exist — none currently do, so omitted rather than
  invented) folds into a page-level header row each screen already
  partially has (Dashboard's `hero-mesh` header, Attention Center's,
  etc.), consistent with the reference's per-page header pattern.
- The overall page background becomes a very light neutral (new
  `--surface-page` token, distinct from `--surface`/`--surface-muted`),
  with the main content area rendered as a large, rounded, white
  (`--surface`) workspace container inset from the sidebar and viewport
  edges — the reference's "designed product surface" rather than content
  stretched edge-to-edge.

### 7. RTL: sidebar and column-grid rows

The sidebar continues using `border-e` (already RTL-correct in the
current `NavRail`) and its icon+label content order is unaffected by
direction (already the case). `Row`'s new `columns` mode uses CSS grid
with `text-start` per cell (no `text-left`/`text-right`), so column
content order visually mirrors under `dir="rtl"` without a separate
implementation, consistent with the existing design-system RTL
requirement and Slice 8's established verification mechanism
(`e2e/slice8-i18n-rtl.spec.ts`).

### 8. Migration is one OpenSpec change, executed and verified in groups

Given the scope (9 routes, ~30 components), `tasks.md` is broken into
groups mirroring Slice 9's pattern (foundation → shared primitives →
shell → consolidation → screen-by-screen migration → RTL/i18n pass →
tests → verification), each independently buildable/testable/committable
per CLAUDE.md's "Change sizing" rule — one proposal/design so the visual
language decisions stay single-sourced, but implementation and
verification proceed incrementally, not as one unreviewable diff.

## Risks / Trade-offs

- **[Risk] Touching ~30 components in one change is a large surface for
  regressions.** → Mitigation: task groups are independently
  buildable/testable; the existing E2E suite (14 spec files) is run after
  each screen-group migration, not only at the end, and selector updates
  are made in the same commit as the markup change that necessitated
  them.
- **[Risk] Consolidating `ApprovalGate`/`ConstitutionApprovalGate` and
  `DraftButton`/`ConstitutionDraftButton` could silently change behavior
  if the two variants differ in more than API path.** → Mitigation: the
  investigation already confirmed they're "near-identical, differ only in
  API path" for both pairs; the merge task includes a diff-read of both
  originals immediately before merging, and the existing pipeline/
  constitution E2E scenarios (`e2e/slice2-*`) continue to pass unmodified
  as the regression check.
- **[Risk] Retiring `StageBadge` for `StatusBadge` requires a reason for
  every call site, which `StageBadge` never required.** → Mitigation:
  Decision 4 above defines the exact reason text (the stage's own label/
  description, already computed) per call site before any code changes,
  so this isn't discovered ad hoc during migration.
- **[Trade-off] The top header bar is removed rather than restyled in
  place.** → This is a real structural change (not pure restyling), but
  necessary to match the reference's shell composition; every piece of
  content it held (title, session email, sign-out) is preserved, just
  relocated into the sidebar/page-header pattern, so no functionality is
  lost.

## Migration Plan

No data migration — presentation-layer only. Deployed as a normal code
change (this app has no separate UI-version flag or gradual rollout
mechanism, and none is warranted for a single-tenant-per-org internal
tool). Rollback is a normal git revert if a regression is found post-
merge; no schema/data rollback is needed since nothing persisted changes
shape.
