## Context

See proposal.md - Why / Roadmap Source for motivation and sourcing.

Relevant existing shape, verified in code:
- `Project.clientId` required, `Project` has no Constitution at creation — `Constitution` rows are
  drafted/approved later via the existing Slice 2 flow (`src/domain/constitution/`).
- `WorkItem.projectId` required (`schema.prisma:434-435`); `createWorkItem`
  (`src/domain/work-item/commands.ts:71`) already supports creating a root WorkItem (no
  `parentId`) with a caller-supplied `type`, `title`, `description` — reused verbatim.
- `Pipeline.workItemId` is `@unique` (`schema.prisma:534`); `startPipeline`
  (`src/domain/pipeline/commands.ts:38`) throws `ValidationError` if the WorkItem's project has no
  approved Constitution yet. The UI already treats "WorkItem exists, Pipeline not started" as a
  normal, separate state: `StartPipelineButton` renders whenever `!item.pipeline`
  (`src/app/page.tsx:338`, `src/components/OverviewTab.tsx:322`) and is a distinct user action from
  WorkItem creation.
- `createProject` (`src/domain/project/commands.ts:23`) already creates a `Project` plus its
  default `MANUAL` `Connector` in one transaction — reused verbatim for the standalone-Requirement
  case.
- `requireClientRole(ctx, clientId, WRITE_ROLES)` (`src/domain/shared/authz.ts`) is the existing
  write-gate pattern used by `createProject`, `createWorkItem`, and Slice 12/13/14's client-scoped
  commands — reused here for every Requirement command.

## Goals / Non-Goals

**Goals:**
- Give a client a Requirement entity that can exist before, or entirely without, a Project.
- Provide one explicit, human-triggered transition from "Requirement" to "a real WorkItem exists
  and can now go through SDD," without inventing a second execution or approval path.

**Non-Goals** (in addition to proposal.md's non-goals list):
- Guaranteeing the created WorkItem's Pipeline actually starts as part of "Start SDD" — that stays
  gated on an approved Constitution, exactly as it is for every other WorkItem today. "Start SDD"
  only has to get the Requirement to the point where the existing `StartPipelineButton` flow
  applies.
- Any new Constitution-bootstrapping behavior (e.g., auto-drafting a Constitution for a freshly
  created Project). Out of scope; the human uses the existing Project Settings → Constitution flow
  at their own pace, same as creating a Project any other way today.

## Decisions

**1. `Requirement.type` reuses the `WorkItemType` enum directly, not a new `RequirementType`.**
Decision 3 (gap-analysis) describes exactly the same four categories (Project/Task/Bug/Change).
Introducing a parallel enum with identical values would be pure duplication with no behavioral
difference; reusing `WorkItemType` also means the value carries over unchanged into
`createWorkItem`'s `type` field at SDD Activation, with no mapping table needed.

**2. "Start SDD" does not call `startPipeline`.**
Originally scoped (proposal draft) to call `startPipeline` as part of activation, but
`startPipeline` throws when the resolved Project has no approved Constitution — which is always
true for a Project just created from a standalone Requirement, and often true for an
already-linked Project too. Rather than adding new error-swallowing/partial-success handling to
`startPipeline`'s caller, "Start SDD" stops at creating the Project (if needed) + WorkItem, and
reuses the product's existing decoupled "WorkItem exists, Pipeline start is a separate action"
pattern. This is less new surface area, not more: zero changes to `startPipeline`'s contract, and
the created WorkItem shows up with a `StartPipelineButton` exactly like any manually-created one.

**3. `Requirement.projectId` is a plain nullable FK, not a join table.**
A Requirement links to at most one Project (per Decision 3: "optionally linked to an existing
Project" — singular). This is a 1:1-at-most relationship, unlike `ProjectRepository`'s deliberate
many-to-many (a Repository can serve several Projects). No join table needed.

**4. Requirement status is a 3-value enum (`OPEN`, `SDD_ACTIVE`, `DECLINED`), not the full
§25-27 state machine.**
The source spec's richer set (Discovery Gate recommendation, Continue-Without-SDD, Postpone,
Return-to-Discovery) depends on Requirement Triage and Impact Discovery existing to produce a real
recommendation — neither exists yet (explicit non-goals, proposal.md). Building a 6+ value enum
now with only one real transition implemented would leave dead states. `SDD_ACTIVE` is intentionally
a coarse "has a WorkItem" signal, not a Pipeline-progress indicator — that detail lives on the
linked WorkItem itself, which is already fully observable via existing UI (360° Record, Dashboard).

**5. Requirement CRUD and SDD Activation live in a new `src/domain/requirement/` module.**
Mirrors every prior slice's domain-layer boundary convention (`src/domain/client/`,
`src/domain/repository-discovery/`, etc. — see `openspec/specs/domain-layer-boundary/spec.md`).
`startSddForRequirement` orchestrates `createProject`/`createWorkItem` by calling them directly
(same module boundary the codebase already crosses elsewhere, e.g. `pipeline/commands.ts` calling
`syncAgentRegistry` from the `agent` module) rather than duplicating their logic.

## Risks / Trade-offs

- [Risk] A user might expect "Start SDD" to fully start the Pipeline, given the name, and be
  confused it didn't. → Mitigation: the Requirement detail page surfaces the created WorkItem's
  own `StartPipelineButton` (or its "needs an approved Constitution first" state) directly, so the
  next step is one click away, not a separate navigation.
- [Risk] `Requirement.status` may need more values once Triage/Impact Discovery/the richer
  Activation choices are built in a later slice. → Mitigation: `RequirementStatus` is its own
  Prisma enum (not reused from `WorkStatus` or hardcoded strings), so extending it is an additive
  migration, consistent with how `WorkStatus` itself has grown slice-by-slice.

## Migration Plan

Additive only: new `Requirement` model + `RequirementStatus` enum, one migration, no backfill
(no prior data to migrate — the entity is new). No existing table or enum is altered.
