## Context

See proposal.md - Why. `Client.aiBudgetUsd`/`Project.aiBudgetUsd` (Slice
3) already resolve inheritance in code — `checkBudget`
(`src/domain/agent/commands.ts`): project overrides client, unset means
"no limit at this scope." `BudgetForm` (`src/components/BudgetForm.tsx`)
is a bare number input + Save/Clear, rendered inline on the Dashboard's
Client cards (`src/app/page.tsx`) and the project Constitution page
(`src/app/projects/[id]/constitution/page.tsx`) — no effective-value
display, no preview, no history. `requireOrgAdmin`
(`src/domain/shared/authz.ts`) already exists and gates nothing yet
beyond client-creation's absence (§12 of `docs/PRODUCT_SPEC.md`) — this
slice is its first real consumer.

## Goals / Non-Goals

**Goals:**
- Make the existing Client→Project budget inheritance a first-class,
  inspectable Configuration Center entry, extended one level up to
  Organization.
- No config change happens without the person making it seeing what it
  affects first (source's own non-negotiable).
- Every budget change is attributable and recoverable in a durable
  history, not just a general-purpose audit-trail line.

**Non-Goals:**
- Config fields other than AI budget (pipeline/gate policy, integration
  defaults, Slice 5's completion policy) — confirmed out of scope with
  the user; the `configuration-center` capability's mechanics (effective
  value, impact preview, reset-to-inherited, version history) are
  designed to extend to a second field later without a breaking change,
  but nothing else is wired up in this slice.
- Repository- and Work-Item-level config scopes — no existing
  inheritance-target concept for either; confirmed out of scope with the
  user.
- Snapshotting a budget threshold per in-flight pipeline the way
  `stageSequence`/`constitutionVersion` are snapshotted (Slice 2). A
  budget is checked live at draft time today (`checkBudget` reads current
  `Client`/`Project`/`Organization` rows), and this slice keeps that —
  raising or lowering a budget takes effect on the very next draft
  attempt, which is the entire point of a spending *limit*. "Config
  versioning" here means an inspectable change history, not a per-run
  frozen value; the source's "running processes reference the version
  they started under" language describes structural pipeline config
  (already solved), not this field.
- A generic/pluggable config-value framework. `ConfigChange` and the
  Configuration Center UI are written concretely against the AI budget
  field now; generalizing to arbitrary fields is deferred until a second
  field actually needs this treatment, per this project's own
  no-speculative-abstraction convention.

## Decisions

### 1. `Organization.aiBudgetUsd` extends the existing nullable-Decimal, unset-means-inherit pattern
Adding a third `Decimal?` column at the top of the chain, rather than a
new table, keeps `checkBudget`'s resolution a straight linear walk
(Project → Client → Organization → unbounded) matching its existing
two-level logic exactly, just one more `??`-style fallback.
**Alternative considered**: a generic `ConfigValue` table keyed by
`(scope, scopeId, field)` from the start. Rejected per the Non-Goals
above — three concrete nullable columns are simpler to query, index, and
reason about for one field, and migrating to a generic table later (if a
second field needs it) is additive, not a rewrite of this one.

### 2. `ConfigChange` is a dedicated append-only table, not folded into `AuditEvent`
`AuditEvent`'s optional FKs are `projectId`/`pipelineId`/`stageId`/
`workItemId` — no `clientId` or `organizationId`, so an Organization- or
Client-scoped budget change has nowhere clean to attach today (Slice 3's
`approveBudgetOverride` already works around this by leaving `projectId`
null and putting `clientId` in `detail` JSON, which is queryable only by
scanning JSON). `ConfigChange` gets typed `scope` (`ORGANIZATION`/
`CLIENT`/`PROJECT`) and `scopeId` columns instead, indexed, so "this
scope's history" is a direct query. `recordAuditEvent` is still called
alongside it (same transaction) for the general trail, exactly like every
other domain command — `ConfigChange` is additive, not a replacement for
the audit trail's own record of the same event.
**Alternative considered**: extend `AuditEvent` with nullable `clientId`/
`organizationId` columns instead. Rejected — `AuditEvent` intentionally
traces to Project/Pipeline/Stage/WorkItem (delivery-scoped things); adding
tenancy-scoped FKs blurs what it's for, and a dedicated small table is a
smaller, more reversible change.

### 3. Impact preview is a same-transaction read, not a separate confirm-token step
`previewBudgetImpact(scope, scopeId)` runs the same descendant-count query
the UI shows before saving, and `setBudget` is a normal write endpoint the
UI calls only after the user confirms — no server-side "pending change"
row or confirmation token. The UI's own confirm step (not the server) is
what stands between preview and save.
**Alternative considered**: a two-phase `proposeChange`/`confirmChange`
API with a server-held pending state (guards against a stale preview if
someone else changes descendants mid-confirm). Rejected as
over-engineered for a same-user, single-request UI flow with no
multi-step wizard elsewhere in the app; a race here (another admin adds a
project between preview and confirm) is a rare, low-stakes edge case — the
new project simply reflects the just-set value like every other
unoverridden descendant, not a incorrect outcome.

### 4. Project-scope changes skip the preview screen entirely, not just show "0 affected"
A project has no descendant scope this field cascades to, so
`setBudget` at project scope is called directly from the same form that
shows the effective value — no preview step, matching how `BudgetForm`
already behaves today. This keeps the common case (most budget-setting
happens at the project a person is actually looking at) exactly as fast
as it is now.
**Alternative considered**: always show a preview screen, even a trivial
"affects 1 project (this one)" one, for UI consistency across scopes.
Rejected — the source's own example ("this affects 5 clients, 12
projects, 94 work items") is explicitly about cascading blast radius;
a scope with none doesn't need the extra click.

### 5. `requireOrgAdmin` gates the Organization scope; existing `requireClientRole(WRITE_ROLES)` gates Client/Project
No new authz primitive — `requireOrgAdmin` already exists
(`src/domain/shared/authz.ts`) and is reused as-is; Client/Project budget
commands keep using `requireClientRole(ctx, clientId, WRITE_ROLES)`
exactly as `configureConnector`/`updateWorkItemStatus`/etc. already do.
**Alternative considered**: a new `ORG_ADMIN`-flavored role entry in the
`Role` enum. Rejected — `isOrgAdmin` is a `User`-level boolean, not a
per-client membership row, and conflating the two would be a real schema
change for zero behavioral gain.

## Risks / Trade-offs

- **A newly-set Organization budget can retroactively bound a client that
  previously had none** (the internal breaking change proposal.md names)
  → mitigated by the impact preview itself: an org admin sees exactly how
  many clients/projects this affects before confirming, so it's never a
  surprise to the person making the change (though it may still surprise
  a client-side user who didn't make it — same as any budget change
  today).
- **`ConfigChange` grows unbounded** (one row per budget edit, forever) →
  acceptable for this slice's scale (budget edits are rare, deliberate
  actions, not a high-frequency write path); no retention/archival policy
  is built now.
- **Replacing the inline `BudgetForm` changes an existing UI surface** →
  `BudgetForm.tsx` itself is not deleted in this slice at the component
  level so much as superseded on the pages that used it; the two call
  sites (`src/app/page.tsx`, `src/app/projects/[id]/constitution/page.tsx`)
  are updated to link into the new Configuration Center flow instead of
  rendering the bare form inline.

## Migration Plan

Additive-only: new `Organization.aiBudgetUsd` column (default null — no
existing organization becomes newly bounded), new `ConfigChange` table.
No backfill needed — `ConfigChange`'s history starts empty; past budget
edits (Slice 3) are not retroactively reconstructed into it, since the
old and new values before this slice weren't recorded anywhere queryable.
Rollback is a straight migration `down` (drop the column and table); no
other table's data is touched.
