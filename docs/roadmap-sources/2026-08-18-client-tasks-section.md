# Client "Tasks" section — user request (verbatim, 2026-08-18)

Saved per AGENTS.md's "Durable inputs" rule — a same-turn, verbatim record of
the user's request and the two clarifying exchanges that resolved its
material ambiguities, before any OpenSpec proposal is written against it.

## Original request

> When I enter a CLIENT, I want to see the following:
> Tasks Section
> There should be a section called "Tasks".
> Under this section, display all opened REQUIRED items.
> A Project should be displayed, but the tasks underneath it should not be
> displayed.
> A Task should only be displayed if it is at the highest level and there is
> no parent item above it.
> The same rule should apply to a Bug or any other type of work item.
> In other words:
>
> * Display only top-level items.
> * If an item has a parent, do not display it in this section.
> * A Project can be displayed as a top-level item, but its child tasks
>   should not also appear.
> * The same hierarchy rule applies to Tasks, Bugs, and any other
>   work-item type.

## Clarification 1 — what does "REQUIRED" mean?

Asked because no `required`/`isRequired`/`mandatory` field or `REQUIRED`
status/enum value exists anywhere in the codebase (verified by direct
research — see the reconciliation section below).

Question asked: *"What does 'REQUIRED' mean here? There's no existing
'required' field or status anywhere in the codebase."* Options offered: (a)
it's redundant with "opened" — no new field needed; (b) it's a genuinely new
required-vs-optional concept needing its own field.

> **User's verbatim answer:** "REQUIRED is a new request that has been
> submitted. It can be any type of request, such as: A specification, A
> task, A bug, A change, Or any other type of request"

## Clarification 2 — which "Project"?

Asked because `WorkItemType` has a `PROJECT` value distinct from the
separate top-level `Project` model (every `WorkItem` belongs to one via
`WorkItem.projectId`) — the request's "a Project should be displayed" is
ambiguous between the two.

Question asked: *"When you say 'A Project should be displayed' as a
top-level item — which 'Project' do you mean?"* Options offered: (a) a
`WorkItem` of type `PROJECT`; (b) the Client's actual `Project` entities
(already shown in a separate "Projects" panel on this page).

> **User's verbatim answer:** "A WorkItem of type PROJECT"

## Reconciliation against the codebase (research findings, for traceability)

- No `required`/`isRequired`/`mandatory` field exists on `WorkItem` or
  `Project` (`prisma/schema.prisma`). No literal `REQUIRED` value exists in
  any enum — `WorkStatus` is `DRAFT, OPEN, IN_PROGRESS, DECISION_REQUIRED,
  BLOCKED, REVIEW, APPROVED, COMPLETED, CLOSED`.
- `WorkItem.parentId` (self-relation) is the hierarchy field; `parentId:
  null` means top-level. `listWorkItems`'s existing `parentId` filter
  already supports querying on it directly.
- `WorkItemType` is `PROJECT, TASK, BUG, CHANGE` — a closed enum. `PROJECT`
  as a `WorkItem.type` value is distinct from the separate `Project` model
  every `WorkItem` belongs to via `projectId`.
- The Client detail page (`src/app/clients/[id]/page.tsx`,
  `getClientDetail`) currently renders, in order: Client details
  (admin-only), Projects, Requirements, Repositories, Connectors — each as
  a `Panel`/`RowList` following this project's shared design-system
  primitives.
- No prior mention of a "Tasks" section or a "required work items" concept
  exists in `docs/ROADMAP.md` or any other `docs/roadmap-sources/*.md` file
  — this is a genuinely new, standalone feature request, not part of the
  Slices 11–21 Product Vision & Flow Blueprint sequence.

**Working interpretation carried into the OpenSpec proposal** (stated here
so it's auditable, not silently assumed): the user's answer to
Clarification 1 describes "REQUIRED" as the general nature of *any*
top-level work item — something that was requested/submitted, spanning
every `WorkItemType` value (a superset including their example
"specification," which has no literal `WorkItemType` match, read as "any
kind of ask" rather than a new closed enum member) — not a new database
field. Combined with Clarification 2's answer, the section's filter is: every
`WorkItem` across the client's projects where `parentId IS NULL` (top-level
— Clarification 2/2) and `status` is open (not `COMPLETED`/`CLOSED` — the
existing "opened" convention this codebase already uses elsewhere, e.g.
`getHighRiskWorkItems`/`getUpcomingDeadlines`), with no restriction on
`type` (`PROJECT`/`TASK`/`BUG`/`CHANGE` all included, matching "the same
rule applies to Tasks, Bugs, and any other work-item type").
