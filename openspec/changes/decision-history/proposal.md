# Decision history — record the "why" behind course changes

Status: **backlog** — captured for planning, not started.

## Why

DCC already records *what* happened (the append-only event log) but not
consistently *why* a course-changing decision was made. When a task
gets re-broken-down, closed, reopened, or a requirement changes
direction, the reasoning behind that choice isn't captured anywhere —
so looking back later, it's possible to see that something happened but
not why, which blocks the learning goal — the end-of-work
recommendations the one chat gives on a requirement (`claude-in-dcc`).

## What changes

Whenever a decision changes the course of work, record the reason.
Named examples from the spec:
- A task was broken into sub-tasks, then broken again.
- Tasks were closed.
- A task was reopened.
- Direction changed.
- A requirement was reopened.

The reason becomes part of the requirement's history and its final
summary — so, looking back, it's possible to reconstruct: what was
done, why, what it cost, where tokens/time were spent, and which
decisions caused extra work.

## Explicitly out of scope

- A rigid, closed taxonomy of decision reasons. The examples above are
  the anchor cases; the mechanism should accept freeform reasoning text
  attached to the triggering event, not force every decision into a
  fixed enum.
- This proposal is about *capturing* the reason at the moment of
  decision — analyzing the captured reasons for patterns/recommendations
  is the chat's recommendations on the requirement (`claude-in-dcc`).

## Impact

- `packages/core` — every course-changing action (re-breakdown, task
  close/reopen, requirement reopen, direction change) gains a required
  or strongly-prompted reason field, recorded via the existing
  `appendEvent`/`note.added` pattern rather than a new mechanism.
- `apps/web` — the action UI for each of these prompts for the reason
  (not a silent action); the requirement's timeline/history view
  surfaces these reasons prominently, not buried in generic notes.

## Exit gate

Re-breaking-down a task, closing/reopening a task, changing direction,
or reopening a requirement each capture a reason at the moment of the
decision, and that reason is visible in the requirement's history and
in its final summary — not just inferable from the fact that the state
changed.
