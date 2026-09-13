# Per-run cost/usage tracking + requirement-level rollup

Status: **done** — shipped 2026-09-12. Not yet verified against a real
run's actual dollar figure (didn't trigger one purely to test this) —
the pipeline is confirmed working end to end (route → summary → UI), a
real run will show real numbers the next time one happens.

## Why

Every `claude -p` run DCC triggers (assess/breakdown/implement/check)
has a real cost today that isn't recorded anywhere. Without per-run
records, there's no way to answer "how much did this requirement
actually cost," which the user wants both per-action and as a running
total across a requirement's whole life — including cost already spent
on work that was later abandoned (checks lifecycle's `dropped`/
`active=false`, rolled-back implements, re-breakdowns).

## What changes

**Per run**, record independently:
- Which model was used.
- Which effort level was used.
- How long the run took (wall clock).
- How many tokens were consumed.
- How much it cost — computed from Anthropic's actual pricing model if
  the run's own output doesn't already report a cost. Needs a real
  check against Anthropic's docs/API for exactly how cost is computed
  (input/output/cache tokens likely priced differently per model) — not
  a guessed formula.
- Every run is its own cost record, even multiple runs on the same task
  or requirement — never merged or averaged.

**Per requirement**, a cumulative final accounting on top of the
per-run records:
- Sums every Claude run's cost across the requirement's whole life.
- Explicitly includes cost already sunk into work that was later
  changed course on: tasks opened and later closed without shipping,
  tasks reopened, breakdowns redone, implementation done and then
  rolled back/discarded. None of that disappears from the total just
  because the work itself didn't survive — the money was still spent.
  If new tasks get broken down afterward, their cost adds to the same
  running total, not a fresh one.
- The end goal: at any point (and definitively once the requirement is
  done), answer "how much did this requirement actually cost, start to
  finish, and what made up that cost."

## Explicitly out of scope

- Budget alerts/limits enforcement (DCC already has a budget concept on
  clients/requirements — this proposal is about accurate cost
  *recording*, not about gating spend).
- Historical backfill for runs that already happened before this ships
  — starts recording from when it ships.

## Impact

- `packages/core/src/ai-assist.ts` — `runClaudeJson()` (the shared
  low-level runner, ~line 215) already parses the final `{"type":
  "result", ...}` NDJSON line from `claude -p --output-format
  stream-json` (~line 279) but only extracts `result` (the answer
  text) and discards the rest of that object. The Claude Code CLI's
  own result event carries `total_cost_usd`, token `usage`, and
  duration directly — worth checking first (before building any
  separate Anthropic-pricing table) whether that's already
  sufficient, since it may mean most of "get the data" is free: the
  numbers are already flowing through this exact function today, just
  thrown away.
- `packages/db` — a cost-record table, one row per run, linked to the
  task/requirement it belongs to.
- `apps/web` — surfaced per-run (already have a natural home: the run
  result views in `TaskDetail`/`WorkflowTab`) and as the requirement's
  running total (see `requirement-retro-recommendations` and the
  existing budget UI for where a cumulative number would show).

## Exit gate

Every Claude run DCC triggers leaves behind its own cost record with
model/effort/duration/tokens/cost. A requirement's cumulative total
reflects every run ever made against it, including runs behind work
that was later discarded, and stays accurate as further work (including
re-breakdowns) continues to add to it.
