# Task/checks polish — round 2 feedback

## Why

Live feedback after the `checks-lifecycle` change shipped, from actually
using the app: the approve CTA is buried, prompts can't be copied, "waiting
for approval" is ambiguous on a check, a check has no way back to its
requirement, the dev-steps rail shows even on an unapproved task, and —
the substantive one — a check has no active/inactive toggle, so there is
no way to drop a check from a task's prompt (or bring it back) without
losing its history, and no consistency rule tying the task's own status to
its checks' status when that happens.

## What changes

- **NEW** `task.active` (boolean, default true) — a check can be toggled
  inactive without deleting it; `buildImplementPrompt`'s checks query and
  `progressTask`'s completion gate both filter to `active = true`.
- **NEW** `task.wasDone` (boolean, default false) — records "this task was
  `done` before an active check reopened it," so resolving that check
  again restores `done` automatically instead of leaving it in
  `failed_checks` forever.
- **NEW** a shared `syncTaskStateAfterCheckChange()` in `@dcc/core`, called
  after every check add/remove/pass/fail — not just inside `runImplement`
  (today only a bundled task+checks run updates the parent's state; an
  independently re-run check does not, which is the actual bug behind the
  user's "status must always stay consistent" note).
- **NEW** `task.compiledComponents` (text[], nullable) — parallel to
  `affectedPaths`, populated by the breakdown prompt: for each expected
  file, which compiled projects/plugins reference it. Shown as a second
  labeled list ("רכיבים מתקמפלים") everywhere `affectedPaths` is shown.
- **MODIFIED** `TaskDetail`, `TaskGraph` Detail popup, `PromptPreviewModal`,
  `WorkflowTab`'s per-node prompt editor: approve/materialize CTA moves to
  the very top of the task page (bold, above the fold); every prompt
  display gets a copy button next to each of the Hebrew/English toggle
  labels; the dev-steps rail (StepRail + "תן ל-Claude לפתח") is not
  rendered at all until the task is approved (today it renders with a
  disabled-looking callout); a check now shows an explicit approve
  button (its status pill is relabeled "ממתין לאישור הקמה" to disambiguate
  from the review/done steps) reachable from both the task's checklist row
  and the check's own page; a check's own page gets two explicit nav
  buttons — to its parent task and to the requirement — not just one
  crumb.

## Explicitly out of scope

- A manual "create a brand-new check from scratch" form. "Adding/removing
  a check" in the feedback maps to the active/inactive toggle on checks
  that already exist from a breakdown — not authoring one free-hand.
- Auto-triggering a Claude run the instant a check is reactivated. The
  reactivated check needs re-verification, so its `checkResult` is reset
  to unresolved — but *launching* that run stays the same explicit,
  previewed, one-click action every other run in this app already is
  (the check's own page already has this button, generically, for any
  task/check id).

## Impact

- `packages/db` — migration adding `task.active`, `task.wasDone`,
  `task.compiledComponents`.
- `packages/core` — `tasks.ts` (new sync function, gate + toggle
  endpoint), `ai-assist.ts` (checks query filters `active`, breakdown
  prompt asks for compiled components).
- `apps/api` — new `POST /tasks/:id/active` route.
- `apps/web` — `TaskDetail.tsx`, `TaskGraph.tsx`, `WorkflowTab.tsx`,
  `ui.tsx` (copy-button helper on the shared prompt display).

## Exit gate

Toggling a check off removes it from the next preview/run of its parent's
prompt; toggling it back on re-includes it and clears its prior result;
doing either to the one check that was blocking a previously-`done` task
correctly flips the task to `failed_checks` and back to `done`. Every
prompt display in the app has working copy buttons. A check page can
reach both its parent task and the requirement. An unapproved task shows
no dev-steps rail at all.
