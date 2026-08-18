## Context

`WorkItem.executorType`/`executorId` (who does the work) is a separate, already-existing concept
from `ownerId` (accountability, always defaults to the creator — untouched by this slice).
`executorType` already defaults to `UNASSIGNED` with no `executorId` — a real "nobody assigned"
state this slice builds on rather than reinvents. `Project` has no default-executor concept today.
Configuration Center's Preview→Confirm-impact pattern (`src/domain/config/commands.ts`) is real
code but hardcoded to one field (`aiBudgetUsd`) with a numeric-override shape (`previewBudgetImpact`
counts affected descendants; `setBudget` applies immediately, no separate confirm-token). This
slice needs a genuinely two-step flow (preview computes affected WorkItem lists; a separate confirm
step applies one of two explicit options), so it reuses the pattern's *shape*, not its code.

## Decisions

### 1. Two new domain functions, not a reused Configuration Center endpoint
`previewAssignmentCascade(ctx, projectId, newExecutor)` returns the affected/unaffected WorkItem
lists without writing anything. `applyAssignmentCascade(ctx, projectId, newExecutor, option)`
writes the Project's new default and reassigns WorkItems per the chosen option, in one transaction.
Both live in `src/domain/project/commands.ts` (project-scoped, not work-item-scoped — the trigger
is always a Project-level change). Alternative considered: extend `src/domain/config/commands.ts`'s
generic-looking `setBudget`/`previewBudgetImpact` shape to a second field. Rejected — that module's
"generic" appearance is superficial (`ConfigChange.field` is free text but every code path assumes
a single numeric override; there's no confirm-token or two-option branch anywhere in it), so
extending it would mean either forking its behavior with `if` branches keyed on field name (worse
than two purpose-built functions) or generalizing `ConfigChange` itself — out of scope per the
proposal's explicit non-goal (Slice 21 owns that generalization).

### 2. `option` is a required, explicit two-value enum with no default in the API layer
`applyAssignmentCascade`'s `option` parameter is `"INHERITED_ONLY" | "REASSIGN_ALL"`, required (no
optional/default in the Zod schema). This is what "no default pre-selected" means at the API
boundary, not just the UI: the backend refuses to guess. The UI's own two-button Confirm step
(neither button visually pre-selected/focused-as-default) is the second half of that requirement.

### 3. `assignmentSource` recomputation happens inside `applyAssignmentCascade`'s transaction, not as a trigger
Reassigned `INHERITED`/`UNASSIGNED` WorkItems stay/become `INHERITED`. Under `REASSIGN_ALL`,
previously-`EXPLICIT` WorkItems that get reassigned become `INHERITED` too (the proposal's
"explicit override, not a silent one" — the requester explicitly chose to fold them into the
cascade, so treating the result as "the new inherited value" is correct: a future cascade will
correctly re-touch them). A WorkItem's `assignmentSource` also flips to `EXPLICIT` the moment
someone edits its executor directly via `updateWorkItem` (existing command, gets one new line) —
symmetric with how it flips to `INHERITED` here.

### 4. No new `assignmentSource` value for "never had an executor" — `UNASSIGNED` executorType already covers it
Considered a three-value `assignmentSource` (`EXPLICIT`/`INHERITED`/`NONE`). Rejected: a WorkItem
with `executorType=UNASSIGNED` and no Project default is indistinguishable in outcome from one
that's `INHERITED` from an unset default — both show "unassigned" — so a third state adds a
distinction with no behavioral difference. `assignmentSource` defaults to `INHERITED` at the schema
level (matches "everything starts out following the project" semantics) and every currently-
existing WorkItem backfills to `INHERITED` in the migration (decision 5) — the safe default, since
treating pre-migration WorkItems as `EXPLICIT` would make them wrongly immune to the very first
cascade the projects that get this feature run.

### 5. Migration backfill: every existing WorkItem becomes `assignmentSource=INHERITED`
Per decision 4. No existing Project has a `defaultExecutorType` yet (new column, defaults to
`UNASSIGNED`/null), so the very next cascade a project runs is the first one to actually move
anything — this backfill has zero observable effect until a project lead sets a default for the
first time, which is the correct "opt-in on first use" behavior for an additive feature.

### 6. UI: a new section on the Project Settings page, not a new route
Mirrors Slice 16's placement pattern for project-scoped controls (added to the existing Settings
page rather than a new top-level page) — this is a single form-plus-preview interaction, not a
whole page's worth of content, so a new Panel on Settings is proportionate; a dedicated route would
be over-scoped for one flow.

## Non-Goals (explicit deferrals)

- `ownerId` assignment/cascade — a separate, already-fully-specified concept (`work-item-model`
  spec), untouched here.
- Decision Ownership transfer, or any entity type beyond Project/WorkItem (Initiative, Feature,
  Change) — per the proposal's Roadmap Source section, §23's broader "Responsibility Transfer"
  scope is deferred until those entities exist; this slice implements the one concrete, buildable
  instance the old blueprint's §5.6 fully specifies.
- Generalizing Configuration Center's `ConfigChange`/scope-inheritance machinery — Slice 21's job,
  not this one's, even though this slice's UX pattern is modeled on it.
