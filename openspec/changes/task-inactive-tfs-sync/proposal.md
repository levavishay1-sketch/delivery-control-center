# Task-level inactive + bidirectional TFS "Removed" sync

Status: **done** — all 20 tasks complete (see `tasks.md`).

## Why

Deleting either side (DCC or TFS) was ruled out as the default: a DCC
delete never removes the real TFS item (deliberate, "hard lesson from an
earlier incident" — `packages/core/src/ai-assist.ts:1324`), and TFS-side
deletes are invisible to DCC today (no poll, no webhook — confirmed by
direct code search). The user's proposal: generalize the reversible
active/inactive toggle already built for **checks** this session up to
**tasks** — greyed out, still visible everywhere, excluded from the Flow
graph and from dependency computation, and mirrored to TFS's real
`System.State = "Removed"` (verified live against the connected server:
Task/User Story/Feature/Epic all carry this state, in ADO's own
`"Removed"` category — not a custom field, not a guess).

## What changes

- **MODIFIED** `task.active` (already exists from the checks-polish
  change) now also gets toggled for `kind = "task"` rows, not only
  checks.
- **NEW** `setTaskActive()`: deactivating cascades to every descendant
  (child tasks and checks, transitively) — a child under a removed
  parent can't stand alone. Reactivating does **not** cascade — a task
  reactivated on its own doesn't drag back children that may have been
  deactivated for their own reasons.
- **NEW** DCC → TFS: deactivating a linked task PATCHes its ADO
  `System.State` to `"Removed"`; reactivating restores a state derived
  from the task's own DCC `state` (new `TASK_STATE_TO_ADO_STATE` map,
  the task-level sibling of the existing `PHASE_TO_ADO_STATE`). Best
  effort — never blocks the DCC-side toggle.
- **NEW** TFS → DCC: an on-demand check (button on `TaskDetail`, plus a
  passive check on page load when a task is TFS-linked) reads the
  linked item's live `System.State`; if it reads `"Removed"` and DCC
  still shows the task active, DCC syncs itself down (same cascade,
  logged as system-detected rather than user-initiated).
- **MODIFIED** every place that computes the Flow graph or a
  dependency list (`taskFlowFor`, `taskDetail`'s `blockedBy`/`blocks`)
  excludes inactive tasks from edges/blocking computation — an inactive
  task still renders as a (greyed) card/row wherever it already
  appeared, exactly like inactive checks today, but stops being able to
  block or be blocked.

## Explicitly out of scope

- A background poller/webhook receiver for TFS state changes. No
  scheduler infrastructure exists anywhere in this codebase yet: adding
  one speculatively for a single field is a bigger, separate
  architectural decision. The on-demand check covers the real need
  (the person looking at the task finds out) without that lift.
- Forcing the owning **requirement's** phase automatically. The task's
  own state and its children cascade; the requirement is left to the
  human to read the (now-visibly-reduced) task tree and decide — same
  "system flags, human decides" principle already used for
  `ChecksNotPassed`/`overrideChecks`.
- Resolving ADO state **category** generically per custom process
  template. Verified directly against the one connected server that
  all four relevant types literally name the removed state `"Removed"`
  (not just categorize it that way) — hardcoding that string is honest
  for this pilot; a category-lookup (the `_apis/wit/workitemtypes/
  {type}/states?api-version=5.0-preview.1` endpoint, confirmed working)
  is the documented upgrade path if a second client's process template
  ever uses a different name.

## Impact

- `packages/db` — no migration; `task.active` already exists.
- `packages/core` — `tasks.ts` (`setTaskActive`, cascade, dependency
  filters), `ado-map.ts` (`TASK_STATE_TO_ADO_STATE`), `task-ado-sync.ts`
  (push `System.State`, pull-check), `flow.ts` (exclude inactive from
  edges).
- `apps/api` — `POST /tasks/:id/active` already exists (built for
  checks) — extend it to accept `kind: "task"` rows too; `POST
  /tasks/:id/ado-recheck` (new, on-demand pull).
- `apps/web` — `TaskDetail.tsx` (deactivate/reactivate control, TFS
  recheck button, grey banner), `TaskGraph.tsx` (grey tone, excluded
  edges), `WorkflowTab.tsx` (grey nodes in the Flow preview).

## Exit gate

Deactivating an approved, TFS-linked task greys it out everywhere it
already appeared, drops its edges from the Flow graph, cascades to its
own children, and flips the real TFS work item to `Removed` — visibly,
not silently. Reactivating restores DCC state and the TFS state without
pulling children along. Manually setting the TFS item to `Removed` and
hitting "recheck" on the DCC side reflects the same result back.
