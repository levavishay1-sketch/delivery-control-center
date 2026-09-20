# Claude in DCC — one chat, one ledger, one control center

Status: **in progress** — see `tasks.md`.

Appetite: **large**.

The requirement is [docs/claude-in-dcc.md](../../../docs/claude-in-dcc.md) (Hebrew,
principles only). Two design records live in `docs/history/`: what the code
did before this change (`claude-in-dcc-current-state.md`) and the plan this
change was written from, with the prior-art research and the approved
screens (`claude-in-dcc-plan.md`). This proposal is the short, binding version.

## Goal

Claude becomes part of the system rather than a set of separate features
bolted next to it. Three things change for the person using DCC:

1. **One chat, everywhere.** A single Claude chat opens from every screen
   (a floating button, `Ctrl K`). It knows which screen and which record
   the person is looking at, explains every button and term in plain
   Hebrew, answers from what the screen already shows, and can request any
   action the screen offers — as a proposal that a person approves.
2. **One record for every call.** Every call to Claude, from any route, is
   one row in one ledger: who, for which client, on what, which capability,
   which model and effort, tokens, cost, duration, outcome. Every cost
   number anywhere in DCC is a slice of that ledger.
3. **One place to look at all of it.** A "קלוד" screen: where the money
   goes, every call, every conversation, what did not help, what needed a
   stronger model, and the routing policy — edited there, applied to real
   calls.

## What this change does

- Adds the `claude_call` ledger and `recordClaudeCall()` as its only writer,
  wired into `runClaudeRaw` (the one place that runs the CLI) through a
  **required** ledger context — a call without a declared capability does
  not compile. The routing policy is consulted on every call and its
  decision is recorded on the row.
- Adds `conversation` / `conversation_message`, the chat itself, screen
  context (`facts`, `glossary`, `actions`, `suggestions`) registered by each
  screen, a step-zero answer path that never reaches a model when the
  answer is certain, "did this help" on every answer, roll-over of long or
  cold conversations, and content retention.
- Adds an action registry that both the screen's buttons and the chat call;
  the chat proposes, the existing `PromptPreviewModal` gate stays the only
  door to Claude.
- Adds the "קלוד" screen with five tabs, and moves the routing policy to a
  versioned document edited from it.
- Folds the onboarding assistant into the one chat; turns the retro and the
  client letter into chat topics; replaces the four cost displays with one
  `CostLine`.

## Principles this follows

Every design decision in `design.md` cites the section of
`docs/claude-in-dcc.md` it implements. The five foundational decisions of
`openspec/project.md` hold: the ledger and the conversations carry
`client_id` and RLS; every row names a real person; only the named writers
write; the event log stays the spine (a call on a work item also leaves a
thin `claude.call` event that links to the ledger row and carries no cost).

## Out of scope

Permissions on who may read which conversations (the columns are there;
the rules come later — §10.3), a client-level policy layer beyond the
retention override, and the SDK-based multi-step tool loop (`canUseTool`)
— the proposal-as-text path covers every action today and the registry is
what the SDK path would call if it is ever needed.

## Replaces

The earlier change that tracked run cost as events (the ledger is the cost
record now) and the earlier change that put a Hebrew assistant next to the
onboarding terminal (the one chat is that assistant now). Both are deleted
by this change; git history is the record.
