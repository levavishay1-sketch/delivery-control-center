# End-of-requirement improvement recommendations

Status: **done** — all 5 tasks complete (implemented in `f9c5f4f`, the
"✦ המלצות לשיפור" action on a requirement's record screen). Originally
written as a backlog item that depended on the earlier cost-tracking change and
`decision-history`.

## Why

Tracking cost and decision history is only half the value — the other
half is actually learning from it. Without a deliberate retrospective
step, the data just accumulates without ever changing how the next
requirement is run.

## What changes

A "המלצות לשיפור" (recommendations for improvement) button, available
once a requirement is done. Clicking it has Claude analyze that
requirement's full history — its cost records (the earlier cost-tracking change) and
its decision history (`decision-history`) — and produce recommendations
such as:
- How to save tokens.
- How to save time.
- How to work more efficiently.
- Which actions turned out to be unnecessary.
- Which decisions caused rework.
- How the work could have been broken down better.
- Points to emphasize in future process.

The goal isn't only to measure cost — it's to learn and improve from
one requirement to the next.

## Explicitly out of scope

- Automatically applying any recommendation. This is an analysis/report
  action, not a mechanism that changes how future requirements are run
  by itself.
- Cross-requirement trend analysis (comparing many requirements against
  each other) — this proposal is per-requirement; aggregate learning
  across requirements is a natural but separate future step.

## Impact

- Depends on the earlier cost-tracking change (needs real per-run cost data) and
  `decision-history` (needs real captured reasons) — build those first.
- `packages/core` — a new analysis prompt that reads a requirement's
  full timeline + cost records + decision history and asks Claude to
  produce structured recommendations, same one-shot `claude -p` pattern
  as assess/breakdown.
- `apps/web` — the "המלצות לשיפור" button (shown once a requirement is
  done) + a view for the resulting recommendations.

## Exit gate

On a done requirement with real cost and decision history behind it,
clicking "המלצות לשיפור" produces a concrete, requirement-specific set
of recommendations grounded in what actually happened — not generic
advice.
