## Roadmap Source

Implements Slice 22 of `docs/ROADMAP.md` ("Client 'Tasks' section (top-level open work items)"),
sourced from `docs/roadmap-sources/2026-08-18-client-tasks-section.md` — a standalone, ad hoc user
request, not part of the Slices 11–21 Product Vision & Flow Blueprint sequence:

> "When I enter a CLIENT, I want to see the following: Tasks Section. There should be a section
> called 'Tasks'. Under this section, display all opened REQUIRED items. A Project should be
> displayed, but the tasks underneath it should not be displayed. A Task should only be displayed
> if it is at the highest level and there is no parent item above it. The same rule should apply
> to a Bug or any other type of work item. In other words: Display only top-level items. If an
> item has a parent, do not display it in this section. A Project can be displayed as a top-level
> item, but its child tasks should not also appear. The same hierarchy rule applies to Tasks,
> Bugs, and any other work-item type."

Two material ambiguities were resolved with the user before scoping (full exchange recorded in
the source file):

> Q: "What does 'REQUIRED' mean here? There's no existing 'required' field or status anywhere in
> the codebase." A: "REQUIRED is a new request that has been submitted. It can be any type of
> request, such as: A specification, A task, A bug, A change, Or any other type of request"

> Q: "When you say 'A Project should be displayed' as a top-level item — which 'Project' do you
> mean?" A: "A WorkItem of type PROJECT"

## Why

The Client detail page (`clients-hub` capability) currently shows a client's Projects,
Requirements, Repositories, and Connectors, but nothing surfaces the client's actual open work at
a glance — a manager has to open each Project individually to see what's outstanding. This adds
that missing top-level view: every open, top-level (parentless) WorkItem across the client's
projects, of any type, in one place.

## What Changes

- New "Tasks" panel on the Client detail page, listing every `WorkItem` across the client's
  projects where `parentId IS NULL` and `status` is open (not `COMPLETED`/`CLOSED`) — spanning
  every `WorkItemType` (`PROJECT`/`TASK`/`BUG`/`CHANGE`).
- A WorkItem with a parent is excluded from this list even when its top-level ancestor is shown
  (e.g. a Task materialized under a PROJECT-type WorkItem does not get its own row once its parent
  already appears).
- Each row shows the WorkItem's title, type, and status (via the existing `StatusBadge`
  component), and links to its Quick View or 360° Record, matching the existing Requirements
  panel's row-link pattern.
- Read-only: no new domain command, no new mutation, no schema/migration change. A new query
  function computes the list; the panel follows the page's existing `Panel`/`RowList` design-system
  pattern.

**Explicitly out of scope**: any change to how WorkItems are created, assigned, or materialized;
any change to the existing Projects panel (the separate `Project` model's own list is unaffected —
"Project" in this feature's rule means a `WorkItem` of `type: PROJECT`, not that model); a new
"required" concept or field (per the resolved clarification, none is needed).

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `clients-hub`: adds a requirement that the client detail view also shows the client's top-level,
  open work items across all types, complementing (not replacing) the existing projects/
  repositories/connectors requirement.

## Impact

- **Domain layer**: a new read-only query (e.g. `getClientTopLevelOpenWorkItems` or folded into
  `getClientDetail`) in `src/domain/client/queries.ts` or `src/domain/work-item/queries.ts` —
  final placement decided in design.md.
- **UI**: a new "Tasks" `Panel` added to `src/app/clients/[id]/page.tsx`'s existing panel list.
- **No schema/migration change**: `WorkItem.parentId` and `status` are existing fields.
