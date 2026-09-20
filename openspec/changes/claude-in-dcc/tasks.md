# Claude in DCC — tasks

Appetite: **large**. Order: ledger → chat → actions → control center →
what moves to the chat → lifecycle. Every stage leaves the system whole.
Branches: `project/claude-in-dcc`, one `task/…` branch per stage.

## 0. Groundwork

- [x] 0.1 Requirement (`docs/claude-in-dcc.md`), current state, plan with prior-art research and eight screens; screens reviewed and reduced to three (one chat over every screen, one control center, the cost line as a component)
- [x] 0.2 Navigable mock (`claude-in-dcc-mock-v2.html`) approved: floating launcher bottom-left, floating / pinned chat, per-topic conversations, proposal / declared-cost / refusal cards, suggestions per screen

## 1. The ledger · `task/claude-ledger`

- [x] 1.1 `@dcc/db`: `claude_call` schema + migration `0035_claude.sql` (RLS, indexes, `source_ref` unique, `meta`); append-only triggers in `sql/guards.sql`; the cached spend column on `client_budget` dropped
- [x] 1.2 `@dcc/db`: `recordClaudeCall()` — the only writer — with input validation; `claude.call` thin event type; `claude_call` link rel
- [x] 1.3 `@dcc/core`: `runClaudeRaw` takes a required `ledger` context, calls `route()` for every call, records the row (outcome on error/timeout/stop/refused too); `runClaudeJson` and every caller updated; cache token buckets read from the CLI result; a call over the capability's input cap is refused before it runs
- [x] 1.4 `@dcc/core`: policy file gains `version` + `prices`; capabilities `chat`, `chat_code_read`, `conversation_summary`, `usage_insights`, `interactive_session`, `retro`, `client_letter` (the last two until stage 5); `brief` / `matching` / `narrative` / `review` removed; the routing audit event and its recorder, the timeline summariser that never summarised, and the `/workitems/:id/route` endpoint deleted; `routing.prove.ts` updated (15 checks green)
- [x] 1.5 `@dcc/core`: onboarding session recorded as ledger slices (stage complete, process exit, resume, cancel); run view's cost built from the ledger + the live unrecorded delta (shown as "not yet recorded"); the assistant's calls are ledger rows too, so its totals are no longer kept on the run (the assistant itself goes in stage 2)
- [x] 1.6 `@dcc/core`: hook sessions (`recordSession`) also write a ledger row; `requirementCostSummary` / `requirementCostDetail` / budgets / dashboard / clients read from the ledger, month to date
- [x] 1.7 `@dcc/db`: `dev:backfill-ledger` — historical session events and onboarding sessions into the ledger, idempotent by `source_ref`; `dev:prove` gains five checks for the ledger (RLS wall, append-only, the thin timeline event with no cost) — 14/14 green
- [x] 1.8 API: `GET /claude/overview`, `GET /claude/calls`, `GET /claude/calls/:id`, `GET /workitems/:id/calls`; the routing endpoint and the `dcc.mjs route` subcommand deleted (routing is inside every call)
- [x] 1.9 Web: `CostLine`, `CallsTable`, `claude/labels.ts` (one wording for model, effort, capability, outcome — the onboarding labels re-export it); "קלוד" in the sidebar; `ClaudeCenter` screen with סקירה and קריאות; `Record.tsx`'s cost detail, the onboarding `CostPanel` moved to the shared components
- [x] 1.10 Migration applied to the local database with the API stopped; typecheck (`tsc -b` + `apps/web`), `audit:stale`, `dev:prove` green; the control center, the requirement screen's cost detail, budgets and the dashboard checked live. Found on the way: a database rebuilt by `dev:setup` could not be migrated incrementally (`dev:setup` never recorded what it applied, and an old file cannot re-run once a later one dropped its column) — `dev:setup` now records, and `dev:adopt <file>` marks what an existing database already has
- [x] 1.11 The earlier cost-tracking OpenSpec change deleted (the ledger replaces it); its names on the retired list

## 2. The chat · `task/claude-chat`

- [ ] 2.1 `@dcc/db`: `conversation`, `conversation_message` (in `0035_claude.sql`), RLS, indexes
- [ ] 2.2 `@dcc/core` `chat/`: topic keys, conversation store, prompt assembly (stable prefix / delta), lean CLI call with `--session-id` / `--resume`, cumulative-cost delta, fresh session when the old one is gone, input-token cap
- [ ] 2.3 `@dcc/core` `glossary/`: registries for requirement, task, pull request, onboarding run, control center, dashboard/lists; step-zero matcher (glossary + fact templates)
- [ ] 2.4 `@dcc/core`: "did this help" (explicit + re-asked within a minute); `unanswered` detection
- [ ] 2.5 API: `GET /claude/conversations`, `GET /claude/conversations/:id`, `POST /claude/ask` (topic + context + question), `POST /claude/messages/:id/helpful`, internal client resolution for `app`
- [ ] 2.6 Web: `useClaudeContext`, `ClaudeChat` (launcher, floating / pinned, topic bar, chips, cost line, helpful), `GlossaryHint` (`?`), mounted once in `App.tsx`; context registered on requirement, task, pull request, onboarding, control center, dashboard
- [ ] 2.7 Web: שיחות tab; a row opens the chat on that conversation
- [ ] 2.8 Onboarding assistant deleted: `assistant.ts`, `Assistant.tsx`, its API routes, `assistant.json`, the capability, and its OpenSpec change; `digestTranscript` feeds the `run:<id>` topic's facts
- [ ] 2.9 Verified live: a question answered from the glossary at zero cost, one from facts, one by the model with a ledger row; switching screens switches the conversation and the old one is found again

## 3. Actions · `task/claude-actions`

- [ ] 3.1 `@dcc/core` `actions/`: the registry; `assess`, `breakdown`, `implement`, `send_gap_question`, `send_to_session`, `update_branch` registered; buttons routed through it
- [ ] 3.2 Chat: `<action>` block parsed, validated (exists, allowed, recordable), stored as a `proposal` message; `POST /claude/proposals/:id/run` executes through the registry in the person's name; refusal sentence for a block that fails
- [ ] 3.3 Expensive question: `<needs_code>` → `declared_cost` message → `POST /claude/messages/:id/run-code` as `chat_code_read` with `parent_call_id`
- [ ] 3.4 Web: `ProposalCard` (approve / show what will be sent → `PromptPreviewModal` / cancel), declared-cost card, refusal card
- [ ] 3.5 Verified live: an action requested in the chat, approved, run and recorded; a code question declared, run and recorded under the asking call

## 4. Insights and policy · `task/claude-insights-policy`

- [ ] 4.1 `@dcc/core`: question clustering (SQL, normalised text × screen); `usage_insights` as a named action; "open an improvement task" on the internal client; unanswered / unhelpful / failed / escalated lists
- [ ] 4.2 `@dcc/core`: policy read/write with version bump and `policy.changed` event; per-client retention override
- [ ] 4.3 API: `GET /claude/insights`, `POST /claude/insights/analyse`, `POST /claude/insights/:cluster/task`, `GET /claude/policy`, `PUT /claude/policy`
- [ ] 4.4 Web: מסקנות and מדיניות ושמירה tabs
- [ ] 4.5 Verified live: a policy edit changes the model of the next call and shows in its row

## 5. What moves to the chat · `task/claude-chat-topics`

- [ ] 5.1 Chips "נסח מכתב ללקוח" and "המלצות לייעול" in the requirement's conversation; the letter as a message to copy from
- [ ] 5.2 Deleted: `runRetro`, `getRetroRunView`, `composeClientLetter`, `getRecentClientLetters`, `client_letter.composed`, the `retro` / `gap-letter` routes and web calls, `RetroModal`, the letter modals in `Record.tsx`; capabilities `retro` / `client_letter` removed from the policy; the retro's and the letter's OpenSpec changes removed
- [ ] 5.3 Sweep (`grep -rIn --exclude-dir=node_modules,dist,.git,.pgdata`) for every retired name; names added to `scripts/audit-stale.mjs`; `audit:stale` green

## 6. Lifecycle and measurement · `task/claude-lifecycle`

- [ ] 6.1 Roll-over on tokens / age with a recorded summary; the continuation shown in the chat and in שיחות
- [ ] 6.2 Retention: daily job, per-client override, session files deleted with the conversation
- [ ] 6.3 The measurements of `docs/claude-in-dcc-plan.md` §6 available in the control center (answered-without-model rate, cache share, tokens per turn, cost per question, escalations, roll-overs)
- [ ] 6.4 Project branch current with `master`; typecheck, `audit:stale`, `dev:prove` green; pull request `project/claude-in-dcc → master`
