# Repository onboarding as a coach — a fixed process, a different result for every repository

Status: **done** — implemented, verified by unit tests, the proof script and a live run on this repository, 2026-09-27 (see `tasks.md`).

Appetite: **large** (user-directed: replace the whole onboarding, engine and
screen, in one pass, no leftovers).

## Goal

Every repository of every client becomes the place where the AI works best,
and keeps getting better. Onboarding is a relationship, not an event: the
process is deterministic and the same for every repository, and the set of
components a repository receives is different for each one — every component
carries the evidence that justified it ("שמתי X כי ראיתי Y"), the person can
ask about it and decides, nothing is written in silence, and after the run
the coach keeps proposing from what real sessions show.

This replaces the four stages around one `/init` session. `/init` stays as
one draft generator inside the plan step; it is not the process. The research
that led here: `docs/research/repo-onboarding-recommendation.md`, proven on
eleven deliberately different repositories (eleven different sets).

## What changes

**Seven steps, one run** (`packages/core/src/repo-onboarding/`):

0. **חיבור** — an isolated worktree on `ai/onboarding/<run>`, a recorded
   baseline, the automation level (הפיך = עושה ומדווח / הכול באישור / נעול).
1. **אבחון** — `diagnose.ts`, deterministic, no model, free: languages,
   build, tests, lint, CI, monorepo, generated code, secrets as locations
   only, external systems, existing AI config, docs, environment, history
   (hot spots, repeated change shapes). The profile is a row; the person can
   mark a fact "זה לא נכון", and the rules that read it stay silent.
2. **תהליכים וראיון** — evidence the code gathers (history shapes, CI,
   CONTRIBUTING, PR template, docs, tracker), at most four interview
   questions with defaults (unanswered = recorded assumption), one model call
   that breaks each process into steps, and the **agent test** per step —
   five questions the code decides from: any yes → an agent named for the
   step; a recurring procedure → a skill; else nothing.
3. **ריצת ניסיון** — three to five tasks derived from the profile and the
   processes, run with no components, read-only; the code judges where it
   can, a model other than the executor judges where it cannot; every
   failure is one of five kinds, each pointing at a kind of component.
4. **תוכנית הרכיבים** — cards from every source: the decision rules
   (`rules.json`, 32 rules, data not code), the trial's failures, the
   process steps, the open marketplace search (a model with web search by the
   stack tags the profile derived, the CODE grading trust — official /
   known community / unverified, injection scan of tool descriptions —
   remembered for the next repository with the same stack), the separate
   reviewer ("what is missing, what is redundant"), and the person's own
   requests ("תכין skill לתהליך X", up to three questions). Three groups:
   נעשה ודווח / מחכה לאישורך / לא מומלץ כאן ולמה. Approve, ask (the chat
   answers from the card), decline with a reason, or approve as a set. The
   readiness gate and the honesty card say what is done and what cannot be
   verified here. The `/init` draft session is a window inside this step.
5. **בנייה ואימות** — approved cards become files by family in dependency
   order (safety → verification → knowledge → connections → skills → agents
   → enforcement), from the operator catalog's parameterised templates
   (`catalog/`), with a model writing only the text that must be written from
   the repository; each component validated its own way (a hook against a
   forbidden action, a permission file parsed, a skill's frontmatter, a doc's
   paths, a script run); a joint check for duplicates, contradictions and
   the always-loaded context; then the trial again → before/after.
6. **מסירה** — only the approved, verified files, committed by name in the
   person's identity, a pull request whose report is generated from the
   cards, plus the readiness and honesty card.

**The coach** (`coach.ts`) continues from real work with relative
thresholds: a check failing on two or more tasks, tasks needing a second
run, cost per task rising against the repository's own earlier average,
sources that changed in the world (weekly re-check). Every proposal carries
its evidence and the measure it will be judged by; approving one starts a
short coach run that applies it on its own branch and delivers a pull
request. Across repositories the coach learns from numbers only.

**Data** — the run table is recreated for the new shape; steps, the profile,
processes, trials, component cards and coach proposals are rows of their own;
`marketplace_source` is org-shared memory. `repo_ai_event` stays the one
event stream. Seven prompts join the library; the file-notes prompt is gone.

**Screen** — the repository's dossier (`apps/web/src/screens/repo/`): the
seven steps, the profile with "זה לא נכון", the processes with the agent
test, the trial, the cards in three groups, the build's validation table and
before/after, the delivery's report, the coach's health score and proposals.
Every title, card and figure has its "i".

**What stays** — the isolated branch, delivery in the person's identity, the
event log, the terminal channel for the draft session, the code map.
