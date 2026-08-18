## Roadmap Source

Implements a re-scoped **Slice 15** (`docs/ROADMAP.md`, "Slices 11–21 — Product Vision & Flow
Blueprint"). The old blueprint scoped Slice 15 as "AI recommends which of a client's
already-discovered repositories/sources are relevant to a new Project/Task." Per
`docs/roadmap-sources/2026-08-17-core-product-definition-gap-analysis.md` Part 3:

> **15** — `repository-relevance-recommendation` ... **Needs re-scoping** — now that Requirement
> placement is resolved (Part 2, Decision 3: standalone or optionally linked to a Project), its
> trigger point likely moves from "creating a Project/Task" to "Requirement Triage," with the
> Project-linked case as one path through it.

This change builds the Requirement entity itself first — the prerequisite the old Slice 15 (and
several others) assumed already existed. Scope is drawn from
`docs/roadmap-sources/2026-08-17-core-product-definition.md` §14-27 and the gap-analysis's own
Part 1 assessment of that cluster:

> This entire cluster (§14-27) is **the single largest net-new area** — nothing above the
> Project/WorkItem level exists today ... a new entity and a new pre-SDD lifecycle stage that the
> current 21-slice roadmap has never scoped at all.

and Part 2, Decision 3 (resolved 2026-08-17):

> `Requirement` is a flexible intake item ... It can be **standalone**, or **optionally linked** to
> an existing Project — never *required* to belong to one.

## Why

Every future slice that touches "how work enters the system above a Project" (old Slices 15, 17,
18, 19, and the Requirement-scoped views in §78-82) currently has no entity to attach to —
`Requirement` doesn't exist anywhere in the codebase. Building it now, bounded to just the entity,
CRUD, and an explicit SDD-activation gate, gives those later slices the correct foundation instead
of continuing to build on the old blueprint's superseded "Project/Task is the entry point"
assumption.

## What Changes

- New `Requirement` model: client-owned, flexible `type` (reuses `WorkItemType`), optional
  `projectId` link (standalone by default), a minimal status (`OPEN` → `SDD_ACTIVE`, plus
  `DECLINED`), manual-entry only for now.
- Requirement CRUD domain commands (`createRequirement`, `updateRequirement`,
  `listRequirements`, `getRequirement`), client-write-permission gated, plus their API routes.
- A single explicit "Start SDD" action: materializes a Project (if the Requirement is standalone)
  or reuses the linked one, and creates a root `WorkItem` of the Requirement's type under it —
  reusing `createProject`/`createWorkItem` verbatim. Starting the WorkItem's Pipeline remains the
  existing, separate, Constitution-gated action (`StartPipelineButton`/`startPipeline`) already
  used for every other WorkItem — "Start SDD" does not call `startPipeline` itself, since a
  freshly created Project has no approved Constitution yet and `startPipeline` requires one.
- New UI: a Requirements list + detail view under the Clients hub, a "New Requirement" form
  (standalone or Project-linked), and the "Start SDD" action.
- Explicitly NOT built here (recorded in design.md as non-goals): Requirement Triage, Impact
  Discovery, Deep Requirement Analysis, AI Questions with evidence/options, generalized
  Pause-and-Resume, external-source intake, the richer multi-choice SDD Activation set
  (Continue-Without-SDD / Postpone / Return-to-Discovery), and Requirement revisioning (deferred
  per Decision 5).

## Capabilities

### New Capabilities
- `requirement-lifecycle`: the `Requirement` entity, its CRUD, and the explicit SDD Activation
  gate that materializes a Project/WorkItem/Pipeline from it.

### Modified Capabilities
(none — this change adds a new caller of the existing `startPipeline` command and `WorkItem`/
`Project` creation paths without altering their existing requirements)

## Impact

- `prisma/schema.prisma`: new `Requirement` model + `RequirementStatus` enum, new migration.
- New `src/domain/requirement/` module (commands.ts, queries.ts, tests).
- New `src/app/api/requirements/` routes (list/create) and
  `src/app/api/requirements/[id]/` routes (get/update/start-sdd).
- New `src/app/requirements/` pages (list, detail) and a `RequirementForm`/`StartSddButton`
  client component, linked from the Clients hub.
- No changes to `Project`, `WorkItem`, `Pipeline`, `createProject`, `createWorkItem`, or
  `startPipeline` behavior — reused as-is. Pipeline start stays a separate action the user takes
  from the created WorkItem's own page, same as any manually-created WorkItem today.
