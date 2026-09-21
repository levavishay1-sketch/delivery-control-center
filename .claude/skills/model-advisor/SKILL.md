---
name: model-advisor
description: Recommend which Claude model and which effort level to use for a task, what it will roughly cost, and how to group a large change into model phases. Use when the user asks which model or effort to pick, whether to switch model or raise effort, how much a task will cost, or says things like "באיזה מודל", "איזה מאמץ", "כמה זה יעלה", "שווה לעבור ל-Opus", "זה מסובך מדי ל-Sonnet". Also use before starting a large OpenSpec change, to plan its model phases up front.
---

# model-advisor

Recommends a model and an effort level, and groups a large change into
phases. **Answer in Hebrew**, in the fixed shape at the bottom.

Read `references/models.md` before answering. Never quote a price, a
context window or an effort level from memory — that file carries the
date it was last checked against Anthropic's documentation, and it is the
only place numbers live.

## The one rule everything else follows

**Model** answers *how much does it need to know*.
**Effort** answers *how hard does it need to try*.

When a run went badly, name which one was missing:

- It skipped files, did not run the tests, gave up half way → **raise
  effort**, not the model.
- It had the whole context, genuinely worked at it, and still did not
  understand the problem → **raise the model**.

Anthropic's own guidance is that tuning effort is often a better lever
than switching models. Prefer the smaller move; say so when you do.

## The table

Start from **Opus 5 at `high`**. That is the documented default for most
work, and `high` is the default effort on every model that accepts one.
Leave this starting point only for a reason on the table.

| The task | Model | Effort |
|---|---|---|
| Mechanical — a rename, a rewording, a change you can state exactly | Sonnet 5 | `low` |
| Routine build — a defined change, a screen in a pattern that exists | Sonnet 5 | `high` |
| The same, and cost matters | Sonnet 5 | `medium` |
| A subtle bug, an unfamiliar domain, an architecture decision | Opus 5 | `high` |
| Large agentic coding of a shape you recognise; a long run | Opus 5 | `xhigh` |
| Work you would otherwise break into pieces; an open root-cause hunt; a run of hours; research ending in a document | Fable 5.1 | `high` |
| A short question, a classification, high volume | Haiku 4.5 | — |

Three things this table will not do on its own:

- **Haiku takes no effort parameter at all**, and its context window is
  a fifth of the others'. Never recommend an effort level with it, and
  never hand it a large repository read.
- **Do not reach for `max` as "the best one".** It is documented to
  overthink and to give diminishing returns. It is the most expensive
  setting, not the strongest one.
- **The gap between Fable 5.1 and Opus 5 is not constant** — a few
  points on ordinary agentic coding, and many times that on
  long-horizon work. Pay double only where the gap is real. The
  measured numbers are in `references/models.md`.

## Batch size — how much to hand one run

This is a separate decision from the model, and it is where most of the
quality is won or lost.

| Model | Hand it, in one run | How to phrase it |
|---|---|---|
| Sonnet 5 | One task | Describe the steps precisely |
| Opus 5 | A related group of tasks | Describe the goal and the constraints |
| Fable 5.1 | A whole section | Describe **the outcome only** — it plans the path itself, and adding verification reminders makes it worse |

## This does not compete with OpenSpec

OpenSpec answers *what are we building, in what order, and what is
recorded*. Batch size answers *how much goes into one prompt*. Both hold
at once: the same `tasks.md`, the same boxes ticked one at a time, only
the prompt grows.

When a change was split, ask why it was split:

- **Split for meaning** — separate deliverables, separate acceptance,
  separate review points, a real dependency. That split stays, always.
- **Split so a weaker model would not lose the thread** — that split is
  an artefact of the tool. Fable does not need it, and saying so is part
  of the recommendation.

## Grouping a large change

Read the change's `tasks.md`, mark a model per task, then **group
consecutive tasks into as few phases as the dependency order allows**.
Three or four phases, not thirty switches.

The reason is cost, not tidiness: every model switch makes the next
request re-read the whole conversation with no cache hits, and so does
every effort change (Fable 5.1 is the exception). A cascade of switches
costs more than it saves.

Two things worth offering instead:

- **`/model opusplan`** — Opus while planning, Sonnet while executing,
  with no switching by hand. Offer it whenever the change is
  plan-then-build.
- **Subagents.** A subagent keeps its own cache and leaves the parent's
  intact, so choosing a model per subagent is genuinely free. A model
  per task in one session is not.

## When not to recommend splitting at all

Say so plainly; a one-line "one model for the whole thing" is a good
answer.

- The tasks are all the same kind of work.
- The work fits one context window and is one dependent chain.
- The single-model effort sweep has not been tried yet. Anthropic's
  measurement is that delegating costs 10 to 12 accuracy points, and
  that a multi-model setup is worth it only when one model at varying
  effort leaves a measured gap.

## Before a long autonomous run in this repository

Two cautions that belong in the recommendation itself, not after the
fact — the longer the run, the smaller the chance anyone sees it happen:

- **Stop the API** before a run that may touch migrations or any script
  importing `@dcc/db`. A second process on the same PGlite directory
  corrupts it; it has cost two full resets already (see `CLAUDE.md`).
- **Do not hand one run both a migration and screens.** Split by risk,
  even when the model could hold both.

## The answer shape

Always these three parts, in this order. The third is the one that keeps
the user from getting stuck, so never drop it.

```
┌─ המלצה ────────────────────────────────┐
│  מודל   Sonnet 5                        │
│  מאמץ   high  (ברירת המחדל)             │
└─────────────────────────────────────────┘

למה: <one or two sentences, in plain Hebrew>

סימני החלפה תוך כדי:
  דילג על קבצים / לא הריץ בדיקות  →  /effort xhigh
  באמת לא הבין את הבעיה            →  /model opus

מה להריץ:  /model sonnet
```

For a whole change, replace the box with the phases — each phase its
model, its effort and the tasks under it — and end with the number of
model switches it costs.

Give a cost estimate only when the size of the input is actually known,
and say it is an estimate. A made-up number is worse than none.

## Keeping this current

`references/models.md` carries a "checked on" date. When a new model is
released, or that date is more than a few months old, say so in the
answer rather than quietly using stale numbers, and offer to re-check.

This skill deliberately does **not** pin a `model:` or an `effort:` in
its own frontmatter. Doing so would make every invocation a model switch
— the whole conversation re-read uncached, twice, to save a few hundred
output tokens. It costs more than it saves.
