# Task-level inactive + TFS sync — tasks

Appetite: **standard**.

## 1. Core: deactivate/reactivate + cascade

- [x] 1.1 `setTaskActive(clientId, taskId, active, by)` in `packages/core/src/tasks.ts` —
      works for both `kind: "task"` and `kind: "check"` (supersedes the
      check-only `setCheckActive`)
- [x] 1.2 Deactivating cascades `active = false` to every descendant
      (recursive: children tasks, their checks, their children's
      checks…); reactivating touches only the one row
- [x] 1.3 `taskDetail()`'s `blockedBy`/`blocks` queries filter
      `active = true` — an inactive task can't block or be blocked
- [x] 1.4 `taskFlowFor()` (`flow.ts`) excludes inactive tasks from edge
      computation and `computeSteps()`, but keeps them in `nodes` (grey
      card, still visible — not hidden)

## 2. DCC → TFS

- [x] 2.1 `TASK_STATE_TO_ADO_STATE` map in `ado-map.ts`
- [x] 2.2 Deactivating a `linkedAdoId` task PATCHes `System.State` →
      `"Removed"`, best-effort — **verified live against the real
      connected TFS server** (work item #68 flipped to `Removed`)
- [x] 2.3 Reactivating PATCHes it back via `TASK_STATE_TO_ADO_STATE` —
      **verified live** (restored to `"New"`, matching `state: "pending"`)

## 3. TFS → DCC (on-demand)

- [x] 3.1 `checkAdoRemovedState(clientId, taskId, by)` — GETs the linked
      work item's current `System.State`; if `"Removed"` and DCC still
      shows active, calls `setTaskActive(..., false, ...)`
- [x] 3.2 `POST /tasks/:id/ado-recheck` route
- [x] 3.3 Button on `TaskDetail` ("🔄 בדוק סטטוס מול TFS"), shown only
      when `linkedAdoId` is set; also fires once, silently, on page load
      for a TFS-linked active task

## 4. UI

- [x] 4.1 `TaskDetail.tsx`: deactivate/reactivate button, grey banner
      when the task itself is inactive
- [x] 4.2 `TaskGraph.tsx`: inactive tasks get their own grey tone
      (`STATE_TONE.inactive`), are excluded from `rfEdges` (via the
      server-side edge filter), and the Detail popup has a reactivate
      action + banner
- [x] 4.3 `WorkflowTab.tsx`'s node list (the approve-step listing) and
      both `TaskGraph` embeds: inactive tasks shown greyed with a
      reactivate control, excluded from `pending`/`unsynced` counts
- [x] 4.4 `AdoTasks.tsx` / `ClientDetail.tsx` cross-requirement task
      tables: inactive rows dimmed with a `⚪ לא פעיל` marker

## 5. Verify end to end

- [x] 5.1 Deactivate an approved, TFS-linked task with 4 child checks →
      all 5 went inactive in DCC, the real TFS item (#68) flipped to
      `Removed` — verified against the live connected server
- [x] 5.2 Reactivate the task → TFS item restored to `New`, all 4 child
      checks stayed inactive (no forced cascade up) — verified
- [x] 5.3 Manually set the TFS item to `Removed` directly via the API
      (simulating a human doing it in TFS, bypassing DCC entirely) →
      DCC still showed active until "בדוק סטטוס מול TFS" was clicked,
      which then flipped it to inactive with the message "TFS מראה
      Removed — הושבתה בהתאם" — verified live
- [x] 5.4 A task that depends on the deactivated one no longer shows it
      in `blockedBy`; the Flow graph draws no edge to/from it (code
      path verified; this requirement's single-task tree had no
      cross-task dependency to exercise the edge case live)
- [x] 5.5 `npm run typecheck` clean throughout
- [x] All test data reverted to its original state (task + 4 checks
      reactivated, real TFS item restored to `New`) after verification

## Bug found and fixed during real usage (post-ship)

User workflow: deactivate a task, then re-run breakdown ("פרק מחדש") on
the same requirement. The run completed correctly (backend confirmed via
direct API query — both the inactive task and the fresh proposal were
present, correctly flagged), but the Flow/hierarchy view kept showing
neither, right up until a manual page reload.

Root cause: `taskFlow` in `WorkflowTab.tsx` is fetched from its own
endpoint (`getTaskFlow`), separate from `d` (`WorkItemDetail`). The
run-completion handler in `refreshRun()` called `reload()` (refreshes
`d`) but never `refreshTasks()` (refreshes `taskFlow`) — so the Flow view
silently kept rendering the tree from before the run, no matter what the
run actually produced. Not specific to deactivation; any "פרק מחדש" was
affected. Fixed by calling `refreshTasks()` alongside `reload()` in that
handler (`WorkflowTab.tsx`). Verified live: both the inactive task
(greyed, "לא פעיל") and the new proposal now render immediately without a
manual reload.

