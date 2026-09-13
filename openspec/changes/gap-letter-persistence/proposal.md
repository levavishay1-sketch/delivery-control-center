# Client letters: persist + surface as history

Status: **done** — user-reported bug, fixed and verified live the same
session.

## Why

A user composed a client letter via "✉ נסח פערים ללקוח", navigated away
before copying it, and lost it — the AI call that produced it had to be
paid for again just to get the same text back. The letter existed only
in React component state, nowhere durable.

## What changed

- Every composed letter is now saved as its own `client_letter.composed`
  event (`packages/db/src/events/payloads.ts`) the moment it's
  generated — subject, body, gap count, and (per `run-cost-tracking`)
  its own cost/model/tokens.
- A "📄 מכתבים אחרונים (N)" list replaces the old single "last letter"
  link — every letter ever composed for the requirement, newest first,
  in a floating window; picking one opens it full, with its own detailed
  cost.
- `composeClientLetter` gained a `by: Dev` param and is now cost-tracked
  like every other AI run (`run-cost-tracking`'s own gap: see that
  change's notes) — the two features shipped together since the same
  user report touched both at once.

## Impact

- `packages/db` — new `client_letter.composed` event type.
- `packages/core` — `composeClientLetter` persists + returns cost;
  new `getRecentClientLetters()`.
- `apps/api` — `GET /workitems/:id/gap-letters` (new), `POST
  /workitems/:id/gap-letter` now requires `by`.
- `apps/web` — `Record.tsx`'s gaps panel: letter history list +
  per-letter detail modal, replacing the single-letter local state.

## Exit gate

Compose a letter, navigate away without copying it, come back — it's
still there, in the history list, with no new AI call needed to see it
again.
