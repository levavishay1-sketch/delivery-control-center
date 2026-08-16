## Roadmap Source

Implements `docs/ROADMAP.md` Slice 10 — "Product-wide visual redesign
(reference-driven design system overhaul)." Scope is sourced from
`docs/roadmap-sources/2026-08-16-product-visual-redesign-reference.md`, the
user's verbatim request attaching a reference screenshot (a purple-branded
SaaS dashboard: sidebar navigation, white workspace, stat cards, project
cards, activity table). Key excerpt:

> I want you to redesign the UI of this existing application... I want the
> finished product to feel as if the same designer who designed the
> attached reference designed my entire application. The reference image
> is a dashboard, but the requirement applies to the entire product, not
> only the dashboard... Preserve the application's: functionality,
> business logic, workflows, routes, data, terminology, permissions,
> integrations, user actions, and existing behavior. The redesign should
> change how the product is presented and experienced, not what the
> product fundamentally does.

## Why

Two problems, both surfaced by this session's investigation of every
screen before writing this proposal (per the source document's own "First:
Understand the Existing Product" requirement):

1. **The product doesn't look or feel like one designed system yet.**
   Slices 7 and 9 built a real token-driven design system (`globals.css`,
   `src/components/ui/*`) and applied it to the Dashboard, Attention
   Center, Quick View, and `OverviewTab`'s read view — but 7 of the
   product's 9 routes (Login, Audit Trail, Pipeline Detail, Project
   Settings, Constitution, Configuration Center) and most of its ~20 form/
   action components were never migrated. They still use ad hoc "legacy"
   Tailwind (`border-black/15 dark:border-white/20`, hand-picked
   `bg-emerald-600`/`bg-red-600` colors, inconsistent radii) predating
   Slice 7. The user's own reference makes explicit what this project's
   two style systems already show internally: a product isn't "designed"
   until every screen shares one visual language, not just its newest
   three surfaces.
2. **The user has given a concrete, high-fidelity visual target** (shell
   composition, sidebar treatment, card/typography/spacing/button/badge/
   table language, RTL-aware directional behavior) that goes beyond what
   Slice 7/9 established, and wants it applied product-wide, not as
   another incremental token tweak.

This is presentation-only: no new domain capability, entity, route, or
business rule. It is squarely "meaningful work" under CLAUDE.md's OpenSpec
rule (a redesign spanning the design-system spec and every screen), not a
small local change, so it goes through the full propose → apply → archive
cycle rather than being implemented ad hoc.

## What Changes

- **Design tokens revised, not replaced**: sidebar-surface tokens (a
  distinct branded-dark palette from the existing light neutral scale),
  revised type scale/spacing for the "generous, calm" density the
  reference shows, a card/table row language that supports column-aligned
  content (the reference's activity table) without abandoning the existing
  Row/RowList row-vs-card semantic rule.
- **Application shell rebuilt**: `NavRail` (currently a narrow `w-14`/
  `sm:w-56` icon rail with a hairline border) becomes a substantially
  wider, permanently-expanded branded sidebar with product identity at the
  top and account context at the bottom, matching the reference's
  proportions. The main workspace gains the "light outer surface, white
  contained workspace" composition the reference shows, replacing content
  that currently stretches edge-to-edge under a thin top header.
- **Every screen migrated to the design-system token/component set**,
  closing the gap the investigation found — not just restyled in place:
  Login, Audit Trail, Pipeline Detail (+ `ApprovalGate`,
  `ConstitutionApprovalGate`, `ClarifyPanel`, `AnalyzeFindingsPanel`,
  `StageVersionHistory`, `DraftButton`, `ConstitutionDraftButton`,
  `StartPipelineButton`, `StageBadge`), Project Settings (+
  `ConnectorConfigForm`, `SyncButton`, `ConflictResolutionPanel`,
  `RepositoryLinkForm`), Constitution, Configuration Center (+
  `ConfigBudgetPanel`, `ConfigHistoryList`), and every cross-cutting form
  (`EditWorkItemForm`, `AddWorkItemForm`, `AddProjectForm`,
  `CreateBlockerForm`, `CreateDecisionForm`, `DecisionActions`,
  `ResolveBlockerButton`, `AddDependencyForm`, `RemoveDependencyButton`),
  plus the 360° Record's remaining hybrid-styled tabs (`EvidenceTab`,
  `CodeChangesTab`, `TestsTab`, `DependencyGraph`).
- **Real duplication found during investigation gets consolidated, not
  routed around**: `ApprovalGate`/`ConstitutionApprovalGate` (near-
  identical, differ only in API path) merge into one parameterized
  component; `DraftButton`/`ConstitutionDraftButton` likewise;
  `DecisionActions` reuses the same merged approve/reject primitive;
  `StageBadge` (a second, independent status-badge implementation with no
  "reason" requirement) is retired in favor of `StatusBadge`'s existing
  tone system; the two independent audit-feed implementations (`audit/
  page.tsx`'s server-paginated raw-Tailwind list and `TimelineTab`'s
  client-paginated token-styled list) converge on one shared row
  presentation; dead `BudgetForm.tsx` (superseded by `ConfigBudgetPanel`,
  referenced only from archived OpenSpec docs) is deleted.
- **New shared primitives** added to `src/components/ui/` where the
  investigation found the same pattern hand-rolled 3+ times with no shared
  component: a `Button` primitive (primary/secondary/destructive variants
  — currently every form invents its own `bg-emerald-600`/`bg-red-600`/
  `bg-foreground` button), an `Input`/`Select`/`Textarea` form-field
  primitive (currently every form hand-rolls its own border/padding), and
  a defined empty/loading/error/disabled state presentation per component
  type (design-system spec already requires this; today only partially
  implemented).
- **Design-system spec's single-accent-color rule is reconciled, not
  silently overridden**: the reference's branded sidebar is a shell-level
  identity surface, not decorative emphasis on page content — `design.md`
  states this distinction explicitly and the delta spec updates the
  requirement's wording accordingly, per CLAUDE.md's "never silently
  contradict an existing spec" rule.
- **RTL-first**: every new/migrated component (sidebar, tables, forms,
  dialogs) uses logical CSS properties from the start, verified under
  `dir="rtl"` per the existing Slice 8 mechanism, not retrofitted after.
- Explicitly **not** in scope: any new domain feature, entity, API route,
  permission, or business rule; any change to routes/terminology; any
  fabricated data, users, or metrics to match the reference screenshot's
  example content (the redesigned Dashboard renders this app's real data,
  as it already does).

## Capabilities

### New Capabilities

None. This change introduces no new user-facing capability.

### Modified Capabilities

- `design-system`: token set revised (sidebar-surface palette, type
  scale/spacing/card geometry adjustments), the application-shell/sidebar
  requirement rewritten for the reference's proportions and branded
  treatment, the single-accent-color requirement's wording reconciled to
  distinguish shell-identity surfaces from decorative emphasis, a new
  requirement that every screen (not just a subset) uses the shared
  component set, and a consolidation requirement retiring duplicate
  status-badge/approval-gate/draft-button implementations in favor of one
  shared component each.

## Impact

- `src/app/globals.css`: token revisions (sidebar palette, type scale,
  spacing, card/table row treatment); no removal of existing status/type/
  elevation tokens Slice 7/9 established.
- `src/components/NavRail.tsx` and `src/app/layout.tsx`: shell
  restructure (sidebar width/composition, main-workspace container).
- New: `src/components/ui/Button.tsx`, `src/components/ui/Input.tsx` (or
  `FormField.tsx` covering input/select/textarea), a shared approve/reject
  action primitive, a shared paginated-row-feed primitive (for the audit-
  trail/timeline convergence).
- Migrated to design-system tokens/components: `src/app/login/page.tsx`,
  `src/app/audit/page.tsx`, `src/app/pipelines/[id]/page.tsx`, `src/app/
  projects/[id]/settings/page.tsx`, `src/app/projects/[id]/constitution/
  page.tsx`, `src/app/organizations/[id]/config/page.tsx`, and the full
  list of pipeline/settings/config/form components named in "What
  Changes" above, plus `EvidenceTab.tsx`, `CodeChangesTab.tsx`,
  `TestsTab.tsx`, `DependencyGraph.tsx`.
- Consolidated/removed: `ConstitutionApprovalGate.tsx` and
  `ConstitutionDraftButton.tsx` merge into `ApprovalGate.tsx`/
  `DraftButton.tsx` (parameterized by API path); `StageBadge.tsx` removed
  in favor of `StatusBadge`; `BudgetForm.tsx` deleted (dead code).
- No Prisma schema change, no new API route, no new domain module, no
  change to `config/workflow.yaml` or pipeline/gate logic. Every existing
  route keeps its path; every existing form keeps its fields and submit
  behavior.
- E2E tests across every existing spec file need selector updates where
  markup structure changes (e.g. a raw `<select>` becoming a styled
  `Select` component) — behavior assertions themselves should not need to
  change, since no user-facing behavior changes.
