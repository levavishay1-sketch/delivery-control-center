# Checks lifecycle — a task's verification is not the task

Status: **done** — all 24 tasks complete (see `tasks.md`).

## Why

A task's own prompt could always say "run the tests" in prose, but
nothing structured happened with the result — Claude's report about
whether verification passed lived nowhere but the free-text summary.
Two concrete gaps followed from that:

- A task could be marked "הושלם" the moment a human clicked the button,
  whether or not the checks the breakdown itself defined ever ran.
- There was no way to tell, later, whether a check's "passed" came from
  Claude's own report or from a human who looked at a failure and
  decided to proceed anyway — those are different kinds of trust and
  the system was recording them identically.

Session-long discussion (2026-09-12) worked through the shape task by
task; this proposal is that discussion turned into a change record
instead of chat scrollback.

## What Changes

- **NEW** `task.checkResult` / `task.checkResolvedBy` / `task.checkResolvedAt`
  — a check's pass/fail is a fact Claude reports, kept separate from
  whether a human ever overrode it.
- **NEW** `task_state` value `failed_checks` — development finished, at
  least one check did not pass; distinct from `blocked` (waiting on
  something external) and from silently landing on `done`.
- **MODIFIED** `approveTask()` — approving a task cascades to its check
  children, and immediately materializes to TFS (no separate manual
  "הקם ב-TFS" step for an already-approved item). Status before real TFS
  creation: "ממתין לאישור הקמת משימה". After: "מוכן להתחלה" — driven by
  `linkedAdoId`, never by `approvedAt` alone.
- **MODIFIED** `buildImplementPrompt()` — when the task has checks, their
  prompts are woven into the same run, each labeled by its `seq`.
  `ImplementResult` gains `checks: [{seq, passed, detail, likelyCause}]`;
  the response is parsed back onto the matching check rows by `seq`.
- **NEW** check-kind runs are read-only (`Read, Grep, Glob, Bash` — never
  `Edit`/`Write`) and, when run independently of their parent, operate on
  the parent's already-existing branch rather than a fresh clone from
  base.
- **NEW** completion gate — a task cannot move to `done` while any check
  is not `passed`, unless a human explicitly overrides (setting
  `checkResolvedBy`).
- **MODIFIED** `TaskDetail` — the exact prompt and expected files are a
  permanent, readable section on the task's own page, not only inside
  the pre-send modal. Same approve action ("אישור הקמת משימה") reachable
  from the task's own page, not only from the Flow's floating detail.
  Checklist entries expand inline; each also links to its own task page,
  which links back to its parent with one click.
- **MODIFIED** `TaskGraph`'s `Detail` popup and `toneOf()` — "ready to
  start" tone now reads real TFS linkage, not the `approved` flag alone
  (a correction to the redesign from earlier this session).

## Explicitly out of scope

- Automatic gap-raising from inside a check run — considered and
  rejected in discussion: a check surfacing an ambiguity means an
  earlier stage (assess/gaps/breakdown) under-specified something, and
  the fix belongs there, not in a new gap opened downstream of already-
  written code. A check's failure carries a `likelyCause` hint instead,
  so a human recognizes the pattern without the system auto-acting on it.
- Any write access for checks. If a check needs to change code, it isn't
  a check — it should have been modeled as its own small task.

## Impact

- Affected code: `packages/db/src/schema/{enums,workitem}.ts` (+
  migration), `packages/core/src/{tasks,ai-assist,task-ado-sync}.ts`,
  `apps/api/src/server.ts`, `apps/web/src/screens/{TaskDetail,TaskGraph,
  WorkflowTab}.tsx`.
- No new external dependency; reuses the existing flow-run / prompt-
  preview machinery built earlier this session.

## Exit gate

Approve a task with two checks on it → it materializes to TFS on its
own, link included. Run it → the combined prompt visibly includes both
check prompts, and the result view shows a pass/fail per check with the
right `seq` match, not a single blob. Try to mark it done with a check
still failing → blocked, with the manual-override path available and
visibly distinct from an AI-reported pass.
