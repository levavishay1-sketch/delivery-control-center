## Roadmap Source

This change implements `docs/ROADMAP.md`'s Slice 6 row ("Configuration
Center"), scoped from
`docs/roadmap-sources/2026-08-14-gap-analysis-full.md` §5 "Slice 6":

> - Hierarchical config: Organization → Client → Project → Repository →
>   Work Item, with inheritance and overrides.
> - Each field shows effective value, source scope, inherited-or-override,
>   help text, and reset-to-inherited.
> - **Impact preview before saving** — "this affects 5 clients, 12
>   projects, 94 work items" — then explicit confirmation. No silent
>   config changes.
> - Config versioning and audit. Running processes reference the version
>   they started under.

The source names no specific config fields and no bound on hierarchy
depth. Two scope decisions were confirmed with the user before this
change was written:

1. **Config field scope: the AI budget threshold only.** `Client.
   aiBudgetUsd`/`Project.aiBudgetUsd` (Slice 3) already have an informal
   "unset means inherit" pattern with no dedicated UI, no effective-value
   display, no impact preview, and no change history — this slice turns
   that into the first real Configuration Center entry. Pipeline/gate
   policy (`config/workflow.yaml`), integration defaults
   (`Client.integrationConfig`/`aiConfig`), and Slice 5's fixed
   completion policy are explicitly deferred to a later slice.
2. **Hierarchy depth: Organization → Client → Project only.** This
   matches the app's existing tenancy chain exactly
   (`Organization 1─*Client 1─*Project`). Repository and Work Item levels
   have no existing inheritance-target concept to build on and are
   deferred.

## Why

`Client.aiBudgetUsd` and `Project.aiBudgetUsd` already implement
inheritance in code (`checkBudget`, `src/domain/agent/commands.ts`:
project overrides client) but nowhere in the product: there is no
Organization-level budget at all (Client is the top of the chain today),
no page shows a scope's *effective* value versus where it comes from, no
warning before a change silently reduces every descendant's spending
limit, and no history of who changed a budget or when beyond an ordinary
audit-event line buried in the general trail. The source's own
non-negotiable — "No silent config changes" — is not met today: `Budget
Form` (`src/components/BudgetForm.tsx`) saves immediately with no
preview of who else it affects.

## What Changes

- Add `Organization.aiBudgetUsd` (nullable `Decimal`), extending the
  existing two-level Client→Project inheritance to a true three-level
  Organization→Client→Project chain.
- `checkBudget`'s scope resolution (`src/domain/agent/commands.ts`)
  extends to fall through Project → Client → Organization → unbounded,
  preserving its existing "project overrides client, not the stricter of
  the two" rule at each additional level.
- New `ConfigChange`: an append-only version-history row for every AI
  budget threshold set or cleared at any scope (old value, new value,
  scope, changed-by, timestamp) — the source's "config versioning,"
  scoped to this slice's one configurable field.
- New Configuration Center: a page (reachable per scope — an org admin
  sees the Organization level; a client's write-capable role sees that
  Client and its Projects) listing each scope's AI budget with its
  **effective value**, **source scope** (where that effective value
  actually comes from), and an **inherited/override** indicator.
- Setting or clearing a budget at the Organization or Client level shows
  an **impact preview** — how many descendant clients/projects have no
  override of their own and would see their effective value change —
  before an explicit confirm; the existing inline `BudgetForm` (Client/
  Project dashboard cards) is replaced by this flow. Project-level
  changes (no descendants) save directly, matching today's behavior.
- **Reset to inherited** is an explicit action (distinct from typing an
  empty value into a form) that clears a scope's own override and shows
  the effective value it now inherits.
- **BREAKING** (internal only, no external API): `checkBudget`'s
  resolution order gains a fourth fallback tier (Organization) between
  Client and unbounded; a client with `aiBudgetUsd` unset and an
  Organization-level budget now configured is newly bounded by it — this
  can only happen once an org admin explicitly sets an Organization
  budget, never silently.

## Capabilities

### New Capabilities
- `configuration-center`: the Organization/Client/Project effective-value
  display, impact preview, reset-to-inherited action, and `ConfigChange`
  version history for the AI budget field.

### Modified Capabilities
- `ai-cost-budgets`: budget resolution gains an Organization-level
  fallback tier (Project → Client → Organization → unbounded, was
  Project → Client → unbounded); a budget change now goes through the
  Configuration Center's impact-preview-then-confirm flow instead of
  saving immediately.

## Impact

- **Schema**: `Organization.aiBudgetUsd` (nullable `Decimal`); new
  `ConfigChange` model (`scope` enum, `scopeId`, `oldValueUsd`,
  `newValueUsd`, `changedByUserId`, `createdAt`).
- **Domain**: new `src/domain/config/` (commands: `previewBudgetImpact`,
  `setBudget` — replacing the ai-budget route's direct
  `client.update`/`project.update` calls, `resetToInherited`; queries:
  `getEffectiveBudget`, `listConfigHistory`); `checkBudget`
  (`src/domain/agent/commands.ts`) extended with the Organization
  fallback tier.
- **API**: routes for previewing and setting/clearing a budget at each
  scope, and listing a scope's change history.
- **UI**: new Configuration Center page(s) replacing the inline
  `BudgetForm` on the Dashboard's Client cards and on the project
  Constitution page's Project card; an org-admin-only Organization view.
