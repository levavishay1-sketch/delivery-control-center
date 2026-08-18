## Context

See proposal.md - Why for motivation. Relevant current state:

- `WorkItem.parentId` (self-relation, `prisma/schema.prisma`) is the hierarchy field;
  `parentId: null` means top-level. `listWorkItems`'s existing `ListWorkItemsFilters.parentId`
  (`src/domain/work-item/queries.ts`) already supports this filter, but that function is
  Project-scoped (`ListWorkItemsFilters.projectId`), not Client-scoped, and this feature needs to
  span every project under a client.
- `getHighRiskWorkItems`/`getUpcomingDeadlines` (`src/domain/work-item/queries.ts`) already use
  `status: { notIn: ["COMPLETED", "CLOSED"] }` for "open" — the established convention this change
  reuses rather than inventing a new one.
- `WorkItemType` is `PROJECT | TASK | BUG | CHANGE` (`workItemTypeSchema`,
  `src/domain/work-item/commands.ts`) — `PROJECT` is a real, reachable value: `createWorkItem`
  accepts it directly, and Slice 15's `startSddForRequirement` materializes a root WorkItem this
  way when a standalone Requirement starts SDD. So a top-level `WorkItem` of type `PROJECT` is not
  a theoretical case.
- `getClientDetail` (`src/domain/client/queries.ts`) already returns `{ client, projects,
  repositories, connectors }` for the Client detail page, scoped via `Project.clientId`/
  `Repository.clientId`/`Connector.clientId`. This feature needs the same client-scoping but
  through `WorkItem.project.clientId` (WorkItem has no direct `clientId`).
- `src/app/clients/[id]/page.tsx` renders four `Panel`s today, each with its own `RowList`/`Row`
  markup following `src/components/ui/` primitives; `StatusBadge` is already used on the
  Requirements panel's rows.

## Goals / Non-Goals

**Goals:**
- One query, scoped by client, returning every top-level open WorkItem regardless of type.
- A new Panel that reads consistently with the page's existing four panels (same components, same
  empty-state discipline).

**Non-Goals:**
- No change to `Requirement` (a separate, already-shipped intake concept — Slice 15 — not what
  "REQUIRED" turned out to mean per the resolved clarification) or to the existing Projects panel.
- No pagination/virtualization for this slice — the client's top-level open work is expected to be
  a bounded, human-scannable list, consistent with how the existing Requirements/Repositories
  panels render their full lists today without pagination.
- No new WorkItem-hierarchy visualization (that's the Planner, Slice 16, already built) — this is
  a flat list of top-level items only, not a tree.

## Decisions

**1. Query placement: `src/domain/client/queries.ts`, folded into `getClientDetail`'s existing
result shape.** Adding a `topLevelOpenWorkItems` field to `getClientDetail`'s return value
(alongside its existing `projects`/`repositories`/`connectors`) keeps one query call per page load
consistent with the page's current single-fetch pattern, rather than a second, separate query call
from the page component.
*Alternative considered*: a new standalone `getClientTopLevelOpenWorkItems(ctx, clientId)`
function, called separately from the page. Rejected — every other panel's data already arrives
via `getClientDetail`'s one call; a second round-trip for this one panel would be an unnecessary
inconsistency with no benefit, since this is a single page render, not a lazily-loaded tab.

**2. Query shape**: `db.workItem.findMany({ where: { parentId: null, status: { notIn:
["COMPLETED", "CLOSED"] }, project: { clientId } }, orderBy: { updatedAt: "desc" } })`, selecting
`id`, `title`, `type`, `status`, `projectId` (for the Quick View/360° Record link). Matches the
established `getHighRiskWorkItems`/`getUpcomingDeadlines` open-status convention exactly (Decision
above), and reuses the existing `parentId` field with no schema change.

**3. Panel placement: between the existing Requirements and Repositories panels.** Requirements
(intake) → Tasks (what's actually in flight) → Repositories/Connectors (supporting
infrastructure) reads as a natural top-to-bottom flow: what's been asked for, what's being worked
on, what it runs against. Not a hard technical constraint — a purely presentational choice, easy
to reorder later if it reads better differently in practice.

**4. Row content and link target**: title, a small type label (reusing
`src/lib/colors/workItemType.ts`'s existing type-color/label mapping, already used elsewhere for
WorkItem type presentation), `StatusBadge` for status, linking to the WorkItem's 360° Record
(`/work-items/[id]/360`) — matching the Requirements panel's existing row-link pattern exactly,
not inventing a new link target or a Quick View trigger for this list.

## Risks / Trade-offs

- [A client with many top-level open WorkItems produces a long, unpaginated list] → Accepted for
  this slice (see Non-Goals); consistent with how every other panel on this page already handles
  volume (no panel here paginates today). Revisit if it becomes a real problem in practice.
- ["REQUIRED" was resolved via user clarification rather than an unambiguous existing codebase
  term] → Mitigated by recording the exact Q&A verbatim in the roadmap source and this proposal,
  so the interpretation is auditable and correctable if wrong.
