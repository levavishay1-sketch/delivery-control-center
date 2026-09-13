# Task/checks polish — tasks

Appetite: **standard**.

## 1. Database · `@dcc/db`

- [x] 1.1 `task.active` boolean not null default true
- [x] 1.2 `task.wasDone` boolean not null default false
- [x] 1.3 `task.compiledComponents` text[] nullable (stored as jsonb, matching `affectedPaths`)
- [x] 1.4 Migration applied to local PGlite (server stopped first)

## 2. Check active/inactive · `@dcc/core`

- [x] 2.1 `buildImplementPrompt`'s checks query filters `active = true`
- [x] 2.2 `progressTask`'s unresolved-checks gate query filters
      `active = true`
- [x] 2.3 `syncTaskStateAfterCheckChange(clientId, parentTaskId)`: recomputes
      the parent's `state` from its active checks' `checkResult`,
      including the `wasDone` round trip
- [x] 2.4 `runImplement`'s check-results loop calls it (replacing the
      inline `nextState` logic, and now also covering an independent
      check re-run, which today never touches its parent at all)
- [x] 2.5 `setCheckActive(clientId, checkId, active, by)`: flips the flag;
      reactivating clears `checkResult`/`checkResolvedBy`/`checkResolvedAt`
      (a reactivated check needs fresh verification); calls 2.3
- [x] 2.6 `POST /tasks/:id/active` route + web client function

## 3. Compiled components · `@dcc/core` + `@dcc/web`

- [x] 3.1 Breakdown prompt + JSON schema gain `compiledComponents` per
      task, stored on `proposeTasks`/`runBreakdown`
- [x] 3.2 Shown as a second labeled list next to "קבצים צפויים" in
      `TaskDetail`, `TaskGraph` Detail popup, `WorkflowTab`'s per-node
      card

## 4. `TaskDetail` polish

- [x] 4.1 Approve/materialize card moves to the top of the page, above
      the state-pill row — bold, not buried
- [x] 4.2 Dev-steps rail (StepRail + "תן ל-Claude לפתח") renders nothing
      at all until the task is approved — today it renders with a
      disabled-reading callout instead
- [x] 4.3 A check's status pill reads "ממתין לאישור הקמה" (not the bare,
      ambiguous "ממתין לאישור" — fixed everywhere this phrase appeared:
      `TaskDetail`, `WorkflowTab`, `AdoTasks`, `ClientDetail`); an
      explicit approve button appears on the check's own page when
      unapproved (the approve card now applies generically to both task
      and check kinds)
- [x] 4.4 Same explicit approve button reachable inline from the parent
      task's checklist row, per check
- [x] 4.5 Check page: two explicit nav buttons — to the parent task, and
      to the requirement — not just the one crumb
- [x] 4.6 The checklist row's toggle (☑/☐ click) becomes the
      active/inactive control (הפעל/השבת), separate from the existing
      inline-expand click target

## 5. Copy buttons — everywhere a prompt renders

- [x] 5.1 Shared `CopyBtn` in `ui.tsx`, next to the existing lang-toggle
      pattern
- [x] 5.2 Wired into `PromptPreviewModal`, `TaskDetail`'s permanent
      prompt card, `TaskGraph` Detail popup's prompt block, `WorkflowTab`'s
      assess/breakdown preview and per-node prompt editor

## 6. Verify end to end

- [x] 6.1 Deactivate one of an unresolved task's checks → next preview
      no longer contains it; reactivate → back in the preview, its prior
      result cleared (verified live, browser + network log, on the same
      pilot task used in the previous change's verification)
- [x] 6.2 Force a task to `done` (override), then reactivate/touch its
      checks → task flips to `failed_checks`, `wasDone: true`;
      deactivate the remaining unresolved checks → task returns to
      `done`, `wasDone: false`, with no button click (verified via the
      live API against real data, then fully reverted)
- [x] 6.3 `npm run typecheck` clean throughout

## Bug found and fixed during verification

`setCheckActive` originally logged its own toggle as a `task.progressed`
event, but that event type's schema (`packages/db/src/events/payloads.ts`)
requires `from`/`to` strings — a plain active/inactive flip has neither,
so every real toggle 400'd (though the DB write itself, which runs before
the event log call, had already committed — silently leaving the UI
showing a stale state after the error). Fixed by logging it as
`note.added` instead, which is what the flag flip actually is: a
human decision worth a note, not a state-machine transition.
