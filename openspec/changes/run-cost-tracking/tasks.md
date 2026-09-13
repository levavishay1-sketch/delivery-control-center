# Run cost tracking — tasks

Appetite: **standard**.

## 0. Research (do first)

- [x] 0.1 Confirmed: the CLI's own `{"type":"result",...}` NDJSON line
      already reports `total_cost_usd`, `usage.input_tokens`/
      `output_tokens`, `duration_ms`, and `num_turns` — no separate
      Anthropic pricing table needed, this is a direct read of what
      `runClaudeJson` was already parsing and discarding
- [x] 0.2 N/A — 0.1 resolved this

## 1. Capture

- [x] 1.1 `runClaudeJson()` gains an `onMeta` callback (not a return-type
      change, to avoid touching every downstream destructure) that
      fires with `{model, costUsd, inputTokens, outputTokens,
      durationMs, numTurns}` once the result line is parsed
      (`packages/core/src/ai-assist.ts`)
- [x] 1.2 Reused, not built: the `claude.session` event payload already
      existed in `packages/db/src/events/payloads.ts` (built for the
      interactive SessionEnd hook, `capture.ts`) but nothing ever wrote
      real numbers into it. `recordRunCost()` is the first writer that
      does, from DCC's own headless runs.
- [x] 1.3 Wired into all 5 `runClaudeJson` call sites: `runAssess`,
      `runBreakdown`, `runImplement` (both task and independent-check
      paths, labeled distinctly), `runRetro`, and — closing the gap
      this file originally left open — `composeClientLetter`, once a
      user hit that exact gap live (a composed client letter neither
      persisted nor showed up in cost): gave it a `by: Dev` param,
      wired `recordRunCost`, and additionally persisted the letter
      itself as a `client_letter.composed` event (design notes,
      `gap-letter-persistence`, tracked as its own change since the
      persistence half isn't cost-tracking).
- [x] 1.4 `durationMs`/`numTurns` added to the `claude.session` payload
      schema and to every `recordRunCost()` call — the CLI's result
      line always carried these (0.1 above), but nothing persisted them
      until the cost-detail view (3.3) needed to show them. Rows
      written before this field existed validate fine (optional field)
      and simply show "—" for duration — real historical data, not a
      bug.

## 2. Rollup

- [x] 2.1 `requirementCostSummary(clientId, workitemId)` — sums every
      `claude.session` event's `costUsd`/tokens for a workitem, plus a
      per-kind breakdown (assess/breakdown/implement/check), via a
      plain query over `event_log` — no new table
- [x] 2.2 Never filtered by whether the triggering task still exists or
      is still active — dropped/deactivated work's cost stays counted;
      a re-breakdown only adds new records, never resets the sum

## 3. UI

- [x] 3.1 Per-run cost is on the `claude.session` event itself (visible
      via the timeline/audit trail like any other event) — a dedicated
      per-run display inside the run-result views was not added this
      pass (see follow-ups)
- [x] 3.2 Requirement's running total: new "עלות AI בפועל" metric tile
      on `Record.tsx`'s Overview tab, next to the existing "AI budget"
      tile, refreshed on load and whenever a run just finished
- [x] 3.3 A user asked, live, why the total tile had nothing behind it
      explaining what it was made of ("אני לא רואה ממה זה מורכב").
      Added: the tile is now clickable (🔍), opening a `CostDetailModal`
      with the existing byKind summary at top and a full per-run table
      below — date, what it was, model, duration, agent turns, tokens
      in/out, cost — one row per `claude.session` event, newest first.
      New `requirementCostDetail()` (core) / `GET
      /workitems/:id/cost-detail` (API) / `getCostDetail` (web) behind
      it.

## 4. Verify end to end

- [x] 4.1 `npm run typecheck` clean throughout
- [x] 4.2 Verified live against REAL pilot data (Altshuler Trade,
      WI without a key, "כאשר לקוח נמצא בבקרת הלבנת הון..."): opened the
      cost-detail breakdown on a requirement with 3 real gap-letter
      runs, confirmed all 3 rows render with correct model/cost/tokens,
      and that the 2 runs composed after the `durationMs` field existed
      show a real duration (15.1s, 22.6s) while the older one correctly
      shows "—" (predates the field). No pilot data modified — view
      only.

## Bugs found + fixed after initial ship (both live, both user-reported)

- **Stale cost-detail cache**: `CostDetailModal`'s trigger only fetched
  once (`if (!costDetail) fetch(...)`) then reused that cached list on
  every later open — a user composed a 2nd (then 3rd) letter after the
  first look and the list kept showing only what existed at the first
  open, even though the aggregate summary above it (fetched by a
  different, un-cached call) correctly counted all of them. Fixed by
  always re-fetching on open (`Record.tsx`'s `openCostDetail`) — it's a
  light read, no reason to cache it stale. Verified live against the
  same real requirement above: reopening the modal now shows the true,
  current list every time.
- **Missing duration was the same bug in disguise**: once the cache fix
  landed, the "empty duration" a user reported turned out to be exactly
  the pre-`durationMs`-field historical row described in 4.2, correctly
  showing "—" — not a second bug.

## Known gaps / follow-ups (not silently dropped)

- No per-run cost display inside `TaskDetail`/`WorkflowTab`'s own run
  result views yet — the data exists (on the event, and now in the
  cost-detail modal) but isn't specifically surfaced inline there too.
- `requirement-retro-recommendations` (blocked on this + `decision-
  history`) can now build on real data — both have shipped.
