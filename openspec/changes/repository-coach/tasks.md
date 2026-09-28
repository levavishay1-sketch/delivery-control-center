# Repository onboarding as a coach — tasks

Appetite: **large**. Order: data → engine → API → screen → spec and sweep →
verification. Every task ticked landed in one change.

## 1. Data  ·  `@dcc/db`

- [x] 1.1 Migration `0054_onboarding_as_a_coach.sql`: run table recreated (kind, current step, level), step table, `repo_profile`, `onboarding_process`, `onboarding_trial`, `onboarding_component`, `repo_coach_proposal` (tenant-scoped, RLS), `marketplace_source` (org-shared); seven prompt rows; the file-notes prompt deleted
- [x] 1.2 Drizzle schema rewritten; `repo_ai_event` kept as the one event stream
- [x] 1.3 Applied to local PGlite (API stopped first); `dev:prove` green

## 2. Engine  ·  `@dcc/core/src/repo-onboarding`

- [x] 2.1 `types.ts` — seven steps with Hebrew copy, automation levels, profile, processes and the agent test, trials and failure kinds, components, readiness, the draft session
- [x] 2.2 `diagnose.ts` — the deterministic diagnosis, byte-identical to the research script on this repository and on Trade (git worktrees, NuGet-cache skip, PR template and CODEOWNERS added); unit test on a synthetic repository
- [x] 2.3 `rules.json` + `rules.ts` — 32 rules with 69 component cards; corrections hold rules back; unit test: eleven research diagnoses → eleven distinct sets, Trade's thirteen rules exactly, every card filled
- [x] 2.4 `profile.ts` — facts for the screen with the path a correction names, the summary for the prompts, the facts for the judge
- [x] 2.5 `processes.ts` + `interview.json` — evidence, at most four questions with defaults, the model's answer parsed, the agent test decided by code, a no-model fallback; tests
- [x] 2.6 `trials.ts` + `trial-tasks.json` — tasks from the profile and the processes, the code as judge, the judge's verdict parsed, failure → kind, the delta; tests
- [x] 2.7 `components.ts` — cards from every source, groups by risk and level, merge, build order, the readiness gate, the honesty card, the pull-request report; tests
- [x] 2.8 `marketplace.ts` — the open search's answer parsed, trust graded by code (vendor namespaces, official marketplace, licence, activity, injection scan), the memory and its reuse; tests
- [x] 2.9 `catalog/` — 32 parameterised templates (hooks that really block, deny normalisation, scripts, skills, agents, docs, MCP), executed in tests
- [x] 2.10 `build.ts` — install by family, shared files merged, the author injected; `verify.ts` — validation by kind and the joint check
- [x] 2.11 `runs.ts` — the seven steps, gates by level, decisions on cards, requests from the chat, replan after a correction, the run view, chat facts, recovery; `draft.ts` — the `/init` session inside the plan step; `coach.ts` — signals, health, proposals, coach runs, weekly re-check, numbers across repositories
- [x] 2.12 `deliver.ts` stages only the approved files by name; the actions registry gains `request_component`; capabilities `onboarding_processes/trial/judge/marketplace/author/review` in `routing.ts` and `config/model-policy.json` (v8), the file-notes capability removed; a `tools` override on `runClaudeRaw` for the search

## 3. API  ·  `apps/api`

- [x] 3.1 The fourteen routes of the previous design replaced by the run lifecycle (steps, corrections, interview, trial, decisions, requests, build, delivery, draft session, automation, files) and the coach (view, decisions, re-check); the terminal socket kept; `CoachError` → 409
- [x] 3.2 Boot recovery kept; the weekly coach re-check scheduled beside retention

## 4. Screen  ·  `apps/web`

- [x] 4.1 `screens/repo/` — the dossier: pre-start with the level, the stepper, one card per step, the three card groups with approve / ask / decline / set / request, readiness and honesty, the draft terminal, the build table and before/after, the delivery report, the rail (level, cost, log, previous runs, the coach)
- [x] 4.2 `api.ts` section rewritten; `errText` moved to `api.ts`; the old screen folder deleted; the route in `App.tsx`; the repositories list shows a coach run
- [x] 4.3 Glossary: 97 concepts for the screen in `concepts/onboarding.ts`, the page and screen lines; `info:drift` run

## 5. Spec and sweep

- [x] 5.1 The previous onboarding change (the four stages around one `/init` session) deleted from `openspec/changes/` with `git rm -r`; this change written
- [x] 5.2 Retired names added to `scripts/audit-stale.mjs`; `docs/research/` exempted as dated research records
- [x] 5.3 `CLAUDE.md`: the onboarding paragraph and the `prove:onboarding` command
- [x] 5.4 Swept with `grep -rIn --exclude-dir=node_modules,dist,.git,.pgdata` for every name of the previous design: the old change's name, the file-notes prompt and module and its capability, the stage vocabulary (the stage catalogue, the stage runner, the stage key types), the review functions (refresh, approve, resume), the model-choices column, the init-finished detector and its event, the review intro component, the note helpers. Every one of them is on the retired list of `scripts/audit-stale.mjs`, which is what holds the sweep. Zero hits outside `docs/history/`, `docs/research/` and the two dated research documents in `docs/` (all exempted as records), applied migrations and `CLAUDE.md`'s example list. Kept deliberately: `docs/history/repository-onboarding-v2.md` (the record the user asked for), the ledger backfill for runs made before the ledger, and `session.ts` / `transcript.ts` / `statusline.mjs` / `workspace.ts` / `changes.ts` / `change-diff.ts` / `deliver.ts` (reused as they were)

## 6. Verification

- [x] 6.1 `npm run typecheck`, `npm run lint`, `npm test` (unit tests of every pure module), `npm run audit:stale`, `npm run info:drift`, `npx tsc -p apps/web --noEmit`, `npm run -w @dcc/web build`
- [x] 6.2 `npm run -w @dcc/db dev:prove`, `npm run -w @dcc/api smoke`
- [x] 6.3 `npm run -w @dcc/core prove:onboarding` — the whole run on the proof kit's repository against a bare git host with a Claude stand-in: diagnosis, rules, interview, trial with the code as judge, cards in three groups, decisions, build with real hook validation, the trial again, delivery of only the approved files, the report
- [x] 6.4 A live run on this repository through the API with the real Claude: connect, diagnosis (16 facts, no model), the interview and the process breakdown, a trial of five tasks, the plan (rules, open search, reviewer), the build with the trial again — the run stopped at the delivery gate on purpose, since this repository's branches are not pushed from a run; total cost about $2.19. The Trade clone: connected, diagnosed, its processes mapped, stopped at the trial's cost gate (about $0.13), no delivery. What the live run taught, fixed in the same change: `packages/**` in a .NET repository is not a package cache (the detector now needs a versioned folder or a `.nupkg`); the model says "yes" to the agent test too often (one agent per process, four per run, and the prompt says most steps get five no's); a marketplace MCP whose only address is a repository page is deferred rather than validated as a server; the claims check reads only the text a component appended, never the repository's existing CLAUDE.md, and skips branch-name patterns
- [x] 6.5 The dossier screen driven in Chromium against a scratch database on this repository: the pre-start page, start, connect, diagnosis, a fact marked wrong with a note and its undo, the interview, the automation editor in the rail — no page errors, no console errors
- [x] 6.6 A test of a pure module must not open the database: `marketplace.test.ts` imported `marketplace.ts`, which imports `@dcc/db`, and it ran while the API held the local PGlite — the directory was corrupted and reset. The pure half (parsing, trust grading, the card) now lives in `marketplace-sources.ts`, database-free, and the test imports that

## 7. The scan of the `/init` draft (2026-09-28)

- [x] 7.1 `init-scan.ts` — which files are the draft, the draft for the prompt, the editor's answer read defensively, items to cards (the path check, the whole-file limits, the same key for the same text), the note on a card of ours; `transcript.ts` — the files a session wrote; unit tests in `init-scan.test.ts`
- [x] 7.2 The prompt `onboarding.init_scan` (migration `0055`, only adds the row), its contract, the capability `onboarding_init_scan` on the strongest tier
- [x] 7.3 `runs.ts` — the scan in the background with its state on the plan step, the cards always waiting for a person, the note on ours, the draft set aside at the start of the build, the scan's state recovered after a restart, the scan in the chat's facts; `build.ts` — our AGENTS.md as the build would write it, sections and files from the draft written as approved, after ours
- [x] 7.4 Screen: "סרוק מה ש-/init עשה" in the draft card, the scan's result (verdict, per topic, cards, redundant, left out, cost), the exact text on a card from the draft, the log lines; seven concepts in `concepts/onboarding.ts`, two reworded
- [x] 7.5 `prove:onboarding` — a draft left in the copy is scanned: what is taken waits for a person with its exact text, a permission is a question, a path the code lacks is not recommended, a settings file is refused, a redundant card of ours is noted, a second scan keeps the decisions; the build sets the draft aside and writes only what was approved, after ours
- [x] 7.6 `docs/onboarding-spec.html` updated (step 6 takes the draft and the scan's prompt from the side, step 7 sets the draft aside) and its artifact republished
