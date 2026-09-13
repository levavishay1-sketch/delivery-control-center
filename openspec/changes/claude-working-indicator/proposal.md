# Visible "Claude is working" indicator

Status: **done** — shipped 2026-09-12. Turned into a bigger fix than
planned: the spinner CSS itself was silently broken app-wide (see
`tasks.md`), not just missing in specific spots.

## Why

While a run is in flight (assess/breakdown/implement/check), the user
needs an unambiguous, always-visible sign that DCC is actively working
— not stuck. Today the transcript view is the main signal; if a user
isn't looking directly at the live log, there's nothing telling them
work is in progress.

## What changes

A clear, consistent "working" indicator wherever a run can be in
flight — spinner and/or a "בעבודה…"-style label — shown at the point of
action (the button that triggered it, the step it belongs to), not only
buried inside the transcript.

## Explicitly out of scope

- A global, app-wide "something somewhere is running" indicator (e.g.
  in the top nav) — scope this to the screens where a run was actually
  started, matching how `running`/spinners already work in
  `WorkflowTab`/`TaskDetail` today; this proposal is about making sure
  every such spot has one, consistently, not introducing a new
  app-wide concept.

## Impact

- `apps/web/src/screens/WorkflowTab.tsx`, `TaskDetail.tsx` — audit every
  action that triggers a `claude -p` run and confirm each has a visible
  in-flight state, not just a disabled button.

## Exit gate

Every action that kicks off a Claude run shows a spinner and/or
"בעבודה…" label at the point of that action for its entire duration,
with no screen where a running job is silently invisible.
