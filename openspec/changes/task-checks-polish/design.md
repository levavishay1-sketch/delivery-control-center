# Design notes

## The Context Brief question — decided, not built

Asked directly: should the aggregated Context Brief (assess → gaps →
breakdown) also back the implement/check prompts, all the way to done?

**No — keep the current split.** It's already two mechanisms for two
different consumers, not an oversight:

- The Brief is what a `SessionStart` hook prints for a *human* opening an
  interactive Claude Code session directly in a client repo (the
  dogfooding path, `hooks/session-start.mjs`). That's a real persistent
  conversation, and a persistent conversation is exactly what benefits
  from a standing "here's where things are" memory document.
- `buildBreakdownPrompt`/`buildImplementPrompt` never call `briefFor()` —
  they hand-assemble a narrow, self-contained prompt per call, because
  each `runClaudeJson()` invocation is a **stateless, one-shot `claude -p`
  call**, not a continuing session. There is no persistent context window
  being managed across these calls the way an interactive session manages
  compaction — so "how do we manage context like normal Claude Code does"
  doesn't actually transfer to this path. The real lever is prompt
  construction, and it's already scoped correctly: exactly what this one
  task or check needs (its own instruction + the requirement's resolved
  gap answers), not the whole requirement's history.
- Routing implement/check prompts through the Brief would inject the
  state of every *other* task in the requirement into a narrow
  single-task execution — noise, not help, and it would cost real tokens
  on every run for no benefit.
- The specific worry — a check re-run independently after the task
  already shipped code "loses context" of what that run did — is already
  solved structurally, not by a text summary: an independent check run
  checks out the *parent's actual branch* (`runImplement`'s `isCheck`
  path), so it reads the real committed result directly instead of being
  told about it. No Brief-style injection needed there either.

## Check active/inactive: what actually needs to change together

Three things move in lockstep, and today only one of them does:

1. **The prompt.** `buildImplementPrompt`'s checks query already filters
   `state <> 'dropped'` — add `active = true`. An inactive check simply
   stops appearing in the next preview or run, with no other code path
   involved.
2. **The gate.** `progressTask`'s unresolved-checks query gets the same
   `active = true` filter — an inactive check can never block completion.
3. **The parent's own state.** This is the actual bug this change fixes.
   `runImplement` today only updates the *parent's* `state` field when
   the parent itself is the thing that just ran (`if (!isCheck)`). An
   independently re-run check writes its own `checkResult` but never
   looks at its parent — so a check that fails on its own re-run leaves
   the parent looking healthy, and a check that finally passes on its own
   re-run never clears a `failed_checks` parent. Toggling active/inactive
   has the identical problem: flipping the one check that was blocking
   completion needs to re-evaluate the parent, and nothing currently
   does. Fix: pull that evaluation out into `syncTaskStateAfterCheckChange
   (clientId, parentTaskId)`, called from three places — the check-results
   loop in `runImplement` (replacing today's `nextState` inline logic),
   and the new check-active toggle endpoint.

## The done ↔ failed_checks round trip

The one state transition the feedback spells out explicitly: a task can
be `done`, then a check gets added back into play (reactivated, or a
previously-passing check starts failing on re-verification), and the task
must visibly leave `done` — then, if that same check is deactivated again
(taken back out of play), the task must return to `done` **without** the
user re-clicking the completion button, because from the user's
perspective they never actually un-decided that this task was finished —
the interruption was procedural, not a reversal of their decision.

That needs one bit of memory: `task.wasDone`. Set `true` exactly when a
check-driven state change moves a task out of `done`; checked (and
cleared) exactly when `syncTaskStateAfterCheckChange` finds no more
unresolved active checks. Every other transition in or out of
`failed_checks` (a task that was merely `in_progress`, never `done`) needs
no memory — `in_progress` is already the correct resting state once its
checks clear, and that's what a normal implement run already sets.

## `compiledComponents` — where it gets populated

Discovered once, at breakdown time, not re-derived on every render.
`buildBreakdownPrompt`'s response schema gains a `compiledComponents:
string[]` field per task, asked for the same way `affectedPaths` already
is: "for each file you expect to touch, name the projects that compile it
in — build/plugin projects that reference or include it, not files that
merely call into it at runtime (that's `affectedConsumers`, a different,
already-existing field populated after a real run)." Stored alongside
`affectedPaths` on the task row, shown as a second labeled list wherever
`affectedPaths` already renders (`TaskDetail`, `TaskGraph` Detail popup,
`WorkflowTab`'s per-node card) — never computed client-side, since only
Claude reading the actual repo can answer "who compiles this file in."
