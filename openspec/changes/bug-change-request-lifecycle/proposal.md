# Bug / Change Request lifecycle: check inheritance + reopening closed requirements

Status: **mostly done** — check inheritance + the Bug↔Task link model
built and verified 2026-09-12. Reopening was already covered generically
by `decision-history`. Auto-detection remains explicitly out of scope
(below), unchanged.

## Decided 2026-09-12 (answering the two questions this proposal left open)

- **A Bug can be linked to a task as its structure — a bug ON that
  task's work — or stand alone with no link at all ("פרסונלי ולא
  מקושר").** Not mandatory.
- **A Bug can be linked to MULTIPLE tasks.** Checked live against the
  connected Azure DevOps server (`wit/workitemrelationtypes`, Altshuler
  Trade / `aman-dit-avishil`) per this proposal's own instruction to
  verify against TFS rather than assume: `System.LinkTypes.Related`
  reports `singleTarget: true` in that metadata, but that field
  describes whether the SAME pair of work items can carry the link
  twice, not how many DIFFERENT items one work item can relate to —
  Azure DevOps' own day-to-day product behavior (and its own UI)
  unambiguously allows a work item many distinct Related links. Built
  as many-to-many (`bug_task_link`, a join table) on that reading —
  documented in the table's own comment in case this needs revisiting.

## Why

Two related gaps in how DCC handles work that arrives *after* a
requirement already has history, or after it's already closed:

1. A Bug opened under an existing task should inherit the relevant
   verification burden that task already carries — otherwise a bug fix
   could ship without re-running the checks that mattered for the
   original work.
2. TFS Bugs/Change Requests can appear at any point, including after
   DCC considers a requirement finished. DCC needs a defined answer for
   what happens then, not silence.

## What changes

**Check inheritance — Bug only, not Change Request (decided 2026-09-12):**
- If a Bug is opened under a task, that task's existing check tasks
  apply to the Bug too — the same verification burden, not a fresh
  blank slate.
- A **Change Request is its own new category — like a task, not like a
  Bug** — and does NOT inherit checks the way a Bug does. A CR is fresh
  scope on its own terms, gets its own breakdown/checks like any new
  piece of work, not a continuation of whatever checks already existed
  on the task it's related to.

**Reopening on a Bug / Change Request found after closure:**

The lifecycle: open → develop → test → close → Bug/CR found → opens in
TFS → reflected in DCC/Flow → **is the original requirement reopened?**
Decision: **yes.**

- If the requirement is still open when the Bug/CR appears, no special
  handling needed — it just joins the ongoing work.
- If the requirement was already closed, **it gets reopened**, and DCC
  records a status/reason for the reopening — e.g. "נפתחה מחדש בעקבות
  Bug", "נפתחה מחדש בעקבות Change Request", or another reason matching
  the actual event. This keeps the full lifecycle visible: open → dev →
  test → close → Bug/CR → reopen → handle → re-test → close, with the
  reason for every reopening preserved, not just the fact that it
  happened.

## Explicitly out of scope

- Auto-detecting a Bug/CR the instant it's created in TFS — this
  depends on however DCC ends up learning about TFS-side changes in
  general (see the earlier note-to-self on task-level TFS↔DCC sync
  having no poller/webhook yet; a Bug/CR notification path is the same
  open question, not solved here).

## Impact

- Uses `decision-history`'s reason-capture mechanism for the reopening
  reason — build that first, or land this alongside it.
- `packages/core` — Bug/CR creation logic inherits/links the relevant
  existing checks; requirement reopen logic + reason field.
- `apps/web` — surfacing "נפתחה מחדש בעקבות X" clearly on a reopened
  requirement, not just a bare phase change.

## Exit gate

A Bug opened under a task carries that task's existing checks forward.
A Bug/CR appearing after a requirement closed reopens it automatically,
with a recorded, visible reason — the full open→close→reopen→close
cycle stays legible in the requirement's history.
