## Roadmap Source

Implements `docs/ROADMAP.md`'s Slice 19 stub, scoped from
`docs/roadmap-sources/2026-08-16-product-vision-blueprint.md` §5.6:

> "Any Project/Task/Subtask is assignable to a developer or AI at any time, and reassignable
> again later by whoever currently holds it — not a one-shot decision. Project-level reassignment
> must never silently overwrite a task's **explicit** assignment: the system detects the conflict
> and surfaces it to the owner with full context and every option (move existing tasks to the new
> assignee, or keep their explicit assignments and apply the new one only to the Project and
> unassigned tasks) — **no default pre-selected** (Appendix Q5). Cascades automatically only over
> tasks without an explicit override. Needs `assignmentSource` (§3) and a new conflict-detection
> flow, modeled UX-wise on Configuration Center's existing Preview→Confirm-impact pattern (§6.3)."

`docs/roadmap-sources/2026-08-17-core-product-definition-gap-analysis.md`'s Part 3 (row 19) flags
this slice as "Needs re-scoping — should likely be reframed as the general Responsibility
Transfer mechanism §23 describes, with cascading assignment as one instance of it." §23 of
`docs/roadmap-sources/2026-08-17-core-product-definition.md` reads in full:

> "Authorized users may transfer: Ownership, Decision Ownership — during the lifecycle of:
> Project, Initiative, Requirement, Feature, Bug, Task, Subtask, Change. Every transfer should be
> traceable."

§23 is a broad, one-paragraph principle spanning entity types this codebase doesn't have yet
(Initiative, Feature, Change) and a "Decision Ownership" concept with no current equivalent
(`WorkItem` has `ownerId`/`executorId`, no separate decision-owner field). The old blueprint's
§5.6 is the only source with concrete mechanism detail (the conflict-detection flow, the
no-default-pre-selected rule, the cascade-only-over-unoverridden-tasks rule) and its scope —
Project → Task (WorkItem) ownership/executor assignment — is a strict, buildable subset of §23's
broader "Responsibility Transfer." This change implements that subset now and is written so a
later slice can generalize it to Decision Ownership and the other entity types once they exist,
without redoing this slice's work — mirroring how Slice 16 deferred the Owner/Decision-Owner
graph overlay for the same reason (the underlying entity doesn't exist yet).

## Why

Today, `WorkItem.ownerId` and `WorkItem.executorType`/`executorId` are two different existing
concepts: `ownerId` is accountability and already always defaults to the creating user
(`createWorkItem` sets `ownerId: input.ownerId ?? ctx.userId` — never null) — unchanged by this
slice. `executorType`/`executorId` is who actually does the work, and defaults to
`executorType: "UNASSIGNED"` with no `executorId` — a real "nobody assigned yet" state. The old
blueprint's "assignable to a developer or AI" language is about this executor concept, not
`ownerId`. Today, setting a Project-level default executor has no effect on existing WorkItems and
no way to express "apply to future/unassigned items only" vs. "reassign everything." A project
lead changing who executes a project's work has no safe way to cascade that change without either
manually re-editing every WorkItem or silently overwriting explicit task-level executor
assignments other people made on purpose. This is real, common workflow friction — every later
slice that assumes "the project's default executor" is meaningful (recommendation logic, model
selection, dashboards) is building on a foundation that doesn't exist without this.

## What Changes

- `Project` gains a default executor (`defaultExecutorType`/`defaultExecutorId`) — the value
  WorkItems with no explicit executor of their own inherit. `ownerId` is untouched by this slice.
- `WorkItem` gains an `assignmentSource` field (`EXPLICIT` | `INHERITED`) recording whether its
  current `executorType`/`executorId` was deliberately set on the item itself or inherited from
  the Project's default. A WorkItem created or updated without an explicit executor inherits the
  Project's default as `INHERITED` (falling back to today's `UNASSIGNED` if the Project has no
  default set); explicitly setting a WorkItem's executor at any point marks it `EXPLICIT`.
- Changing a Project's default executor triggers conflict detection: WorkItems currently
  `INHERITED` follow automatically, `EXPLICIT` WorkItems don't — the system computes and shows
  every WorkItem the change would touch (the `INHERITED` ones) and every WorkItem it would NOT
  touch (the `EXPLICIT` ones, protected from silent overwrite) before anything is applied.
- A Preview → Confirm flow, modeled UX-wise on Configuration Center's existing
  Preview→Confirm-impact pattern (a design precedent, not shared code — Configuration Center's
  implementation is hardcoded to `aiBudgetUsd`), presents the owner two explicit options with
  **no default pre-selected**: (a) apply the new default only to the Project and currently
  `INHERITED`/unassigned WorkItems, leaving every `EXPLICIT` WorkItem untouched, or (b) also
  reassign every `EXPLICIT` WorkItem to the new default (an explicit override, not a silent one).
- Every assignment change (Project default set/changed, a WorkItem's executor
  cascaded/reassigned) is recorded via the existing `recordAuditEvent` audit-trail mechanism.

## Capabilities

### New Capabilities
- `cascading-assignment`: Project-level default executor assignment, the `EXPLICIT`/`INHERITED`
  distinction on a WorkItem's executor, and the conflict-detection Preview→Confirm flow for
  cascading a Project's default executor change without silently overwriting explicit task-level
  executor assignments.

### Modified Capabilities
(none — `work-item-model` gains a new field but its existing requirements are unchanged; no
delta needed there since this change doesn't alter any previously-specified WorkItem behavior,
only adds a new one under the new capability above)

## Impact

- `prisma/schema.prisma`: new `Project.defaultExecutorType`/`defaultExecutorId` columns, new
  `WorkItem.assignmentSource` enum column, migration.
- `src/domain/project/`: commands/queries for reading and changing a Project's default executor,
  including the conflict-preview computation.
- `src/domain/work-item/commands.ts`: WorkItem creation and executor-mutation paths set
  `assignmentSource` correctly.
- New UI: a Preview → Confirm flow on the Project Settings page for changing the default
  executor.
- `src/lib/audit.ts`: new audit event types for assignment changes (reusing the existing
  `recordAuditEvent` write path).
