# Claude in DCC — design

Section numbers in parentheses refer to `docs/claude-in-dcc.md`.

## 1. The ledger — `claude_call` (§8)

One row per call to Claude, identical for every route. Column names follow
the OpenTelemetry GenAI conventions where one exists, so the table can be
exported without a mapping layer.

| Group | Columns |
| --- | --- |
| identity & scope | `id`, `client_id`, `user_id`, `entity_kind` (`workitem` / `task` / `pull_request` / `onboarding_run` / `conversation` / `none`), `entity_id`, `workitem_id`, `screen`, `capability`, `trigger` (`button` / `chat` / `rollover` / `insights` / `session` / `hook`), `conversation_id`, `message_id`, `parent_call_id`, `label` |
| request | `started_at`, `finished_at`, `duration_ms`, `model_requested`, `model_used`, `effort`, `policy_version`, `policy_rule`, `num_turns` |
| usage | `input_tokens`, `cache_read_tokens`, `cache_write_tokens`, `output_tokens` |
| cost | `cost_usd`, `price_list_version` |
| outcome | `outcome` (`ok` / `error` / `timeout` / `stopped` / `refused`), `error_text`, `unanswered` |
| provenance | `source_ref` (unique; `event:<id>` or `run:<id>` for back-filled rows) |

- Tenant-scoped (`client_id` + RLS) like every table. Append-only through
  the same trigger family as `event_log` (`sql/guards.sql`): a cost record
  is money and is never edited or deleted — not even by retention.
- **`recordClaudeCall()` in `@dcc/db` is the only writer** (like
  `appendEvent()`). `runClaudeRaw` calls it through a **required**
  `ledger` option that names client, person, capability, entity, screen and
  trigger. The compiler finds every caller; a call without a capability
  cannot be written.
- `route(capability, signals, …, choice)` runs on every call inside
  `runClaudeRaw`; the row stores the policy version and the rule that fired
  (`default sonnet for decomposition; escalated (openGaps)`), which is how
  "needed a stronger model" becomes a number (§9.6).
- The CLI's `result` line supplies `total_cost_usd`, `usage` (including the
  cache buckets), `duration_ms`, `num_turns`. A resumed conversation
  reports cumulative cost; the writer stores the difference from the
  previous row of the same conversation.
- A call that belongs to a work item also appends a thin `claude.call`
  event on that timeline with `links: [{rel: "claude_call", ref: <id>}]`
  and **no cost fields** — the timeline stays complete (decision 01), the
  money is counted once (§8.2).
- Every cost read — the requirement's "עלות AI בפועל", budgets, the
  dashboard tile, the onboarding rail, the control center — is a query on
  this table. The cached spend column on `client_budget` is dropped; the
  month's spend is a sum over the ledger.
- The onboarding session is a live process, not a call. It is recorded as
  **slices**: a slice starts when a stage starts or a process starts, and a
  row is written when the stage completes, the process exits, or the run is
  cancelled — capability `onboarding_init`, trigger `session`, entity the
  run, `label` the stage. The sum of the slices is the session's cost; the
  slice cursor lives in the run's `session` JSON as bookkeeping, never as a
  second total.
- Interactive Claude Code sessions reported by the SessionEnd hook are
  recorded too (capability `interactive_session`, trigger `hook`), so the
  ledger is every call, not only DCC's own.
- Back-fill: a one-off script copies each historical `claude.session`
  event and each onboarding run's session totals into the ledger, keyed by
  `source_ref` so it can never double-count.

## 2. Conversations (§4, §6.4–6.5, §9.10, §10)

`conversation`: `id`, `client_id`, `topic_key`, `topic_kind`, `topic_id`,
`topic_title`, `created_by`, `status` (`active` / `rolled` / `archived`),
`continued_from`, `continues_as`, `cli_session_id`, `last_message_at`,
`retain_until`, `visibility` (reserved, §10.3).

`conversation_message`: `id`, `conversation_id`, `client_id`, `role`,
`kind` (`answer` / `proposal` / `declared_cost` / `refusal` / `system_note`),
`text`, `source` (`model` / `system`), `call_id`, `payload` (the proposal or
the declared cost, as data), `helpful`, `helpful_note`, `created_at`.

- **The topic is the place, never a choice (§4.3).** `topic_key` is derived
  from the screen: `wi:<id>`, `task:<id>`, `pr:<repo>/<n>`, `run:<id>`, and
  `app` for the screens with no entity. The `app` topic belongs to the
  internal client (`.dcc.json`'s `clientId`). One conversation per topic
  and person.
- **Transcript ≠ context (§4.5).** Messages are what the person sees, kept
  until retention deletes their text. The model's context is the CLI
  session (`--session-id` / `--resume`); a roll-over starts a new session
  and never touches what is shown.
- **Roll-over (§6.5)** happens before a question when the last call's input
  tokens passed the threshold, the conversation has been cold longer than
  the threshold, or the chat's rules (its system prompt) changed since the
  session began — a session's history holds answers given under the old
  rules, and it would keep steering by them. Then: a `conversation_summary`
  call (Haiku, trigger `rollover`, recorded like any call), a new
  conversation with `continued_from`, the summary as its first
  `system_note`. The two thresholds are policy values; the rules are
  identified by a hash kept in the conversation's baseline. DCC rolls over
  well below the CLI's own compaction point so the summary is always
  DCC's — named, recorded, costed (§9.8).
- **Retention (§9.10):** `retain_until = last_message_at + retention days`
  (policy default, per-client override). `archiveExpiredConversations`
  archives what is past its period — every message becomes one fixed
  sentence with no payload and no note, `status = archived`, the session
  id, the context hash and the CLI session folder go — active and rolled
  conversations alike; a second pass finds nothing. It runs inside the API
  process (`scheduleRetention`: once shortly after start, then daily —
  never a second process on the database) and on demand through
  `POST /claude/retention/run`. Ledger rows are never touched.
  `prove:retention` proves all of it against a scratch database.

## 3. Screen context: facts, glossary, actions, suggestions (§6.1, §6.2, §7)

Each screen registers itself with one hook:

```ts
useClaudeContext({
  screen: "requirement",
  topic: { kind: "wi", id, title },
  facts: { phase, openGaps, owner, aiCostUsd, nextStep, … },
  actions: ["breakdown", "assess"],
  suggestions: ["מה זה פער?", "מה השלב הבא?"],
});
```

- The **glossary** is a static registry per screen in
  `packages/core/src/glossary/`: for every button and term a Hebrew name, a
  one-sentence explanation and "what happens if you press it". It serves
  the `?` hint next to the control, the chat, and the docs — one wording
  (§11.4). `audit:stale` fails on a screen registered without a glossary.
- **Step zero** runs before any model call: a question about a button or
  term is matched against the glossary; a fact question ("what is the next
  step", "how much has it cost") against `facts` through a small set of
  templates. A certain match answers with `source = system`, cost zero,
  and still carries "did this help". No match, or an uncertain one, goes to
  the model with the facts.
- The prompt is stable prefix first (system prompt + the screen's
  glossary), volatile last (facts, question). Each question sends only what
  changed since the previous one (hash of the screen's context), as the
  onboarding assistant already did.
- A model answer of "I do not have that on this screen" is stored as
  `unanswered = true` on the ledger row and surfaces in insights as a
  candidate fact (§7.2).
- Suggestions come from the screen (`actions` filtered by permission, plus
  the screen's own list) — never from a model call. Claude never speaks
  unprompted (§9.8).

## 4. Actions through the chat (§5)

One registry in `packages/core/src/actions/`:

```ts
{ key, title_he, consequential, describe(p), allowed(user, entity), estimate(p), run(p, by) }
```

- The screen's button and the chat both call `run` — a second door, not a
  second implementation (§5.1).
- The chat receives the actions the current screen allows (name,
  description, parameter schema) and proposes with a structured block
  `<action key="…">{…}</action>`, exactly as the onboarding assistant proposed
  `<send>`. DCC validates — exists, allowed for this person (§5.5),
  recordable with a capability and a cost (§5.4) — and only then renders a
  proposal card: what, on what, in whose name, model and estimated cost,
  what will be recorded (§5.3). "אשר והרץ" is the person's click; "הצג את מה
  שיישלח" opens the existing `PromptPreviewModal`.
- A block that fails validation becomes a sentence from the system ("לא
  אפשרי מכאן: …"), never a button. A host action (merging a pull request)
  stays where it is; the chat links to it and says why.
- An expensive question (§6.6): the ordinary chat has no repository tools.
  When the model answers `<needs_code>`, or the estimate passes the policy
  threshold, a declared-cost card shows what would be read, the model and a
  cost range; on approval the question runs as `chat_code_read` (Sonnet,
  `Read,Grep,Glob` only, `--add-dir` on the isolated copy), with
  `parent_call_id` pointing at the call that asked.

## 5. The routing policy, for real (§6.3, §8.3, §9.9)

`config/model-policy.json` stays config-as-code and gains `version` and a
`prices` table (per model: input, cache write, cache read, output per
million tokens). Capabilities after this change: `gap_detection`,
`decomposition`, `execution`, `onboarding_init`, `chat`, `chat_code_read`,
`conversation_summary`, `usage_insights`, `interactive_session` (recorded,
not routed). Removed: `brief`, `matching`, `narrative`, `review`, and the
onboarding reading aid's own capability — a capability nothing calls is a
statement, not a policy.

The editor in the control center writes the same file through the API,
bumps `version`, and appends a `policy.changed` event on the internal
client in the person's name (from → to version, the changed paths with
their old and new values). Every ledger row carries the version it was
routed under, so a cost change can be tied to a policy edit. The editor
changes values only — a capability is never added or removed from it, and
an unknown one is refused. The file is written back in its own layout
(sections indented, entries on one line), so a saved change reads as the
changed lines in git. A client's own retention period is the same kind of
change: `client.chat_retention_days`, recorded as `policy.changed` on that
client, and the chat's `retain_until` uses it when it is set.

## 6. The control center — `#/claude` (§9)

| Tab | Answers |
| --- | --- |
| סקירה | where the money goes — by client, person, screen, capability, model; answered without a model; "did not help"; what failed |
| קריאות | the ledger, filtered, one row expandable |
| שיחות | every conversation by topic and time, with cost; opens the chat on it |
| מסקנות | repeated questions per screen → finding + recommendation + "open an improvement task"; unhelpful answers; failures; escalations |
| מדיניות ושמירה | the policy editor, prices, roll-over and retention thresholds, the expensive-question threshold, caps |

- "Did not help" (§9.7) = marked by the person, **or** the same normalised
  question asked again in the same conversation within a minute. Both
  are shown, separately.
- Insights are a named action (§9.8): "נתח שאלות" runs on a click. The
  clustering (same normalised question on the same screen, two repeats or
  more) is SQL, no model; `usage_insights` (Sonnet) only writes the finding
  and the recommendation for clusters above the threshold that have none
  yet or grew since, in one call for all of them. A worded cluster is a
  `claude_insight` row (tenant-scoped, unique per client × screen ×
  question): count, first and last asked, finding, recommendation, the
  analysing call, `status` (`open` / `task_opened` / `dismissed`) and the
  task it became. "פתח משימת שיפור" creates a requirement on the internal
  client in the person's name, with the finding and the recommendation as
  its first note; a second press returns the same task. Conclusions are
  editable — a conclusion is not money.

## 7. What is a button, what is the chat (§3)

- A **named process** — the readiness check, the breakdown, the
  development of a task, the onboarding `/init` — is a button on its
  screen and an entry in the action registry; the chat can propose it and
  the person runs it (§3.1–3.3). Its cost is ledger rows (the onboarding
  session as slices).
- **Read-only analysis and text a person edits** (§3.4) — the
  recommendations for a finished requirement, the message to the requester
  about its open questions — are answers of the chat: chips in the
  requirement's conversation, written from the facts the screen hands over,
  the message copied by the person and never sent by DCC. No separate run,
  no separate screen.
- **A conversation** (§4.1) is always the one chat: on an onboarding run it
  is the topic `run:<id>`, and "send to session" is a registry action.

## 8. Shared components (§4.7, §6.7, §11.4)

`apps/web/src/claude/`: `ClaudeChat` (mounted once in `App.tsx`; floating
button bottom-left; floating or pinned beside the screen, the person's
choice remembered; pinning unavailable under 1100 px), `CostLine` (model ·
effort · tokens · cost, the same everywhere, also the zero-cost variant),
`CallsTable`, `ProposalCard`, `HelpfulToggle`, `GlossaryHint`. The four
cost displays that existed are replaced by `CostLine` / `CallsTable`.

## 9. Token economics, as built (§6)

The control center's overview carries the numbers the thresholds are tuned
by (§6.8), all from the ledger and the conversations: cost per question
(chat cost over questions asked, system answers included), tokens per turn
(input plus cache, per chat call), roll-overs and what their summaries
cost, conversations removed by retention, per screen the share answered
without a model and the share marked unhelpful, and per capability the
share of calls escalated — a capability at 30% or more has a disguised
default. After a month of numbers the roll-over thresholds, the expensive
question threshold and the defaults are set again from this table, not
from estimates.

In order of effect on the chat: (a) step zero answers without a model;
(b) tokens per turn are bounded by topic separation, delta-only context and
roll-over; (c) Haiku by default, no thinking, short answers; (d) code
reading is always declared first; (e) the stable prefix is sent first so
the CLI can cache it — measured through `cache_read_tokens`, not assumed.
The CLI's own baggage (its system prompt, `CLAUDE.md`, skills, MCP servers,
slash commands) is switched off by the existing `lean` mode of
`runClaudeRaw` — measured in this repository at ~1,900 input tokens
instead of ~31,000. DCC rolls over before the CLI compacts, deletes session
files with the conversation, and does not use a model-managed memory: the
system is the memory (§11.2). A chat call whose input passes a cap is
refused and recorded as `outcome = refused`.
