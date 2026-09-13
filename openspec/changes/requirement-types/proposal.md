# Requirement types: research / development / testing

Status: **done, except the Flow small-card polish.** The lifecycle
questions this file originally left open were delegated to this
session's judgment on 2026-09-12 and built + verified live the same
day, including a real Azure DevOps materialization round-trip. See
`tasks.md` for exactly what was built vs. deliberately deferred (2.1/2.2,
the small-card Flow rendering — a real layout-math risk, not a decision
gap).

## Why

DCC currently has exactly one shape of requirement: it gets assessed,
broken into development tasks, implemented, reviewed, done. Not every
piece of work headed into DCC is actually a development requirement —
some exist purely to investigate current behavior, or purely to verify
something already works. Forcing those through the development flow
(propose dev tasks, materialize to TFS as Task/User Story/etc.) doesn't
match what they actually are.

## What changes

Three requirement types:

- **דרישת תחקור (research)** — investigates what happens in some
  situation/code path. No development tasks are opened. All the work
  happens directly under the requirement itself. The end result is
  understanding / findings / conclusions about existing behavior, not
  code.
- **דרישת פיתוח (development)** — the existing behavior today: a
  requirement meant to end in development, breakable into work/dev/test
  tasks.
- **דרישת בדיקות (testing)** — verifies that something works correctly.
  Like research: no separate development tasks, work happens under the
  requirement itself, the end result is the verification's outcome.

**Flow visualization consequence:** a research or testing requirement's
work is still a real, tracked TFS task (a sub-task under the relevant
Work Item, fully part of tracking/history) — but drawing it the same
size as a development task's card clutters the Flow. So:

- Development tasks render at the existing card size.
- Research/testing tasks render as a **small card — about a quarter the
  size** of a development task's card. Still interactive/clickable;
  opening it goes to the TFS item / sub-task, same as any other card.

## Explicitly out of scope

- Deciding the requirement type is not retroactively changeable once
  work exists under it (or is — this needs a design decision, not
  assumed).
- Whether research/testing requirements ever "graduate" into spawning a
  real development requirement (e.g. a research requirement concludes
  "yes, needs a fix" — does it produce a follow-up dev requirement
  automatically, or is that just a manual next step the user takes?).

## Decided (2026-09-12)

**A new field, separate from `workitem.type`.** Not a reuse or an
overload of the existing ADO-ladder `type` (epic/feature/story/bug/
task/spike) — that field's whole job is picking a TFS work-item type
for materialization, and **a requirement never syncs to ADO at all**
(architecture non-negotiable — only its TASKS do). "Requirement type"
(research/development/testing) is a purely DCC-internal flow-control
axis with zero ADO-mapping concern; a research requirement's `type`
(epic/feature/story/…) stays whatever it would otherwise be, orthogonal
to this new field.

## Impact

- `packages/db` — a new `requirement_type` column on `workitem`
  (`research | development | testing`), independent of `workitem.type`.
- `packages/core` — the breakdown flow branches: research/testing
  requirements never call `proposeTasks` toward development tasks; the
  work item lifecycle for these differs (see design).
- `apps/web` — `WorkflowTab.tsx` (a different, simpler flow for
  research/testing requirements — no breakdown/approve/materialize
  steps), `TaskGraph.tsx` (the small-card rendering for research/testing
  tasks).

## Exit gate

Creating a research or testing requirement skips straight to
work-happens-here, with no development-task breakdown step offered; its
tracked TFS sub-task(s) render as a quarter-size, still-clickable card
in the Flow, distinct from development task cards.
