# Checks lifecycle — tasks

Appetite: **standard**. Order matters — schema before the code that
reads it, backend before the screens that call it.

## 1. Database  ·  `@dcc/db`

- [x] 1.1 `task_state` gains `failed_checks`
- [x] 1.2 `task.checkResult` / `checkResolvedBy` / `checkResolvedAt`
- [x] 1.3 Migration `0025_check_results.sql` applied to local PGlite

## 2. Approval + materialization  ·  `@dcc/core`

- [x] 2.1 `approveTask()` cascades approval to child checks in the same
      transaction
- [x] 2.2 `approveTask()` calls `materializeTasksToAdo` immediately after
      approving (reuses the existing batch function — it already filters
      to approved+unsynced, so this needs no single-task variant).
      Non-fatal on failure (e.g. no ADO connection yet) — reported back
      via `materializeError`, surfaced in `WorkflowTab`'s `approve()`.
- [x] 2.3 Retire the "מאושר, טרם הוקם ב-TFS" status everywhere it's
      derived; "מוכן להתחלה" reads `linkedAdoId`, not `approved`
      (done together with task group 7 — same code path as the Flow
      tone fix)

## 3. Combined prompt + structured response  ·  `@dcc/core`

- [x] 3.1 `buildImplementPrompt()` appends a labeled section per check
      (`#seq: <prompt>`) when the task has any
- [x] 3.2 `ImplementResult` type + JSON schema instructions gain
      `checks: [{seq, passed, detail, likelyCause}]`
- [x] 3.3 Response parsing writes `checkResult` (+ `detail` as a note) to
      each matching check row by `seq`; no human resolver set on this
      path — this is the AI-report path from the design notes
- [x] 3.4 `previewImplementPrompt()` reflects the same combined prompt
      (unchanged code path — it calls the same `buildImplementPrompt`),
      so the mandatory preview shows exactly what will run

## 4. Check execution semantics  ·  `@dcc/core`

- [x] 4.1 A check-kind run gets `Read, Grep, Glob, Bash` only — the
      `write: true` tool grant never applies to `kind === "check"`
- [x] 4.2 Running a check independently (not bundled with its parent)
      checks out the parent's existing branch, not a fresh clone from
      base — errors clearly if that branch doesn't exist yet

## 5. Completion gate

- [x] 5.1 `progressTask(..., { to: "done" })` refuses when any check is
      not `passed`, unless an explicit override sets `checkResolvedBy`
- [x] 5.2 The override path is a real, visible action at the review
      step ("אשר ידנית למרות הכישלון") — not a silent flag (backend
      accepts `overrideChecks`; button lives at task 6.5's completion
      step in `TaskDetail`)

## 6. `TaskDetail` screen

- [x] 6.1 Permanent, formatted prompt + expected-files section on the
      main page (not only inside the pre-send modal, not only in edit
      mode)
- [x] 6.2 "אישור הקמת משימה" button on this page, gated the same way the
      Flow's floating detail already is
- [x] 6.3 TFS link shown once real (`linkedAdoId` present)
- [x] 6.4 Checklist: click expands the check inline; each check links to
      its own page; a check's own page has a prominent "⬅ חזרה למשימה"
      button back to its parent
- [x] 6.5 After a run that included checks, show pass/fail + detail +
      `likelyCause` per check, not just the task-level summary — plus
      the human-override button ("אשר ידנית למרות הכישלון") for the
      completion gate

## 7. `TaskGraph` floating detail + tone

- [x] 7.1 Same "אישור הקמת משימה" action reachable from the Detail popup
- [x] 7.2 `toneOf()` "ready" reads real TFS linkage, correcting the
      redesign from earlier this session which used `approved` alone

## 8. Verify end to end

- [x] 8.1 Approve a task with 2 checks → both approved, task
      materializes to TFS unprompted, link appears (verified live on
      REQ "מצב קיים כאשר נמצאים בהלבנת הון..." task #1 + its 4 checks —
      approval cascade confirmed via `checkResolvedBy`/`approvedAt`;
      materialize itself reported `materializeError` since no ADO
      connection exists in this dev environment, which is the designed
      non-fatal path, not a bug)
- [x] 8.2 Run it → combined prompt visibly contains both check prompts
      (checked via the mandatory preview) — confirmed live: the
      permanent prompt section on `TaskDetail` shows the task prompt
      followed by "בדיקות שירוצו גם כן: #2 ... #3 ... #4 ... #5 ...",
      exactly matching `buildImplementPrompt`'s checks block
- [x] 8.3 Simulate one check failing → task lands on `failed_checks`,
      "mark done" is blocked, override path works and is visibly
      distinct from a passed check — verified against the live API:
      `POST /tasks/:id/progress {to:"done"}` with unresolved checks
      correctly rejects with a 409 naming the checks; `overrideChecks:
      true` succeeds and stamps `checkResolvedBy` on each unresolved
      check, distinct from an AI-reported `checkResult`. Found and
      fixed a real bug in the process: the API's default error handler
      flattened any plain `Error` to an opaque `{"error":"internal"}`
      500, silently destroying the gate's Hebrew message before it
      ever reached the UI. Fixed by giving the gate its own
      `ChecksNotPassed` error class (`packages/core/src/tasks.ts`),
      caught explicitly in the route to return 409 with the real
      message — the same pattern already used for
      `DeleteNeedsConfirmation`. All test data reverted after
      verification (task state + `checkResolvedBy` reset to original).
