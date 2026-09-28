# Onboarding proves itself — tasks

Appetite: **large**. Order: the runner → the measurement engine and the
TRADE baseline → diagnosis and templates → build and verification → the run
(plan phases, envelope, arms, data) → screens, glossary, spec, sweep → one
API restart → proof on TRADE, five public repositories and DCC.

## 0. Change and branch

- [x] 0.1 This change; `project/onboarding-proves-itself` off `origin/master` (the user's GO on the plan)
- [x] 0.2 `proposal.md` and `design.md` record D1–D14

## 1. The CLI runner · `ai-assist.ts`, `routing.ts`, `config/model-policy.json`

- [x] 1.1 `isolate` (`--setting-sources project --strict-mcp-config [--mcp-config]`) and `maxBudgetUsd` on the non-lean branch; every onboarding call carries its cap
- [x] 1.2 The raw stream-json events returned beside text/meta (`keepEvents`)
- [x] 1.3 Capability `onboarding_eval`; `onboarding_judge` → Sonnet with tools, cap $0.5; policy v10 with the comment rewritten

## 2. The measurement engine · `repo-onboarding/eval/`

- [x] 2.1 `tasks.json` (9 knowledge + 12 action tasks) + `tasks.ts` (pure) + `tasks.test.ts` (the eleven research diagnoses; Trade with the layout block → 17)
- [x] 2.2 `graders.ts` (pure) + `graders.test.ts`
- [x] 2.3 `report.ts` (pure) + `report.test.ts`
- [x] 2.4 `judge.ts` — lean, Read/Grep/Glob, the copy as an added folder
- [x] 2.5 `workspace.ts` — two detached worktrees, reset between runs, the deliverable set copied without `enabledPlugins`, removed at the end
- [x] 2.6 `run.ts` — task × arm × run, interleaved, the cap with paired partial data, a second pass of the tasks whose arms disagreed
- [x] 2.7 `eval.run.ts` + `eval:onboarding` (tsx, a scratch database set before core loads)
- [ ] 2.8 The TRADE baseline (the 33 files the old process would deliver) → `docs/research/2026-09-onboarding-eval-trade-before.{json,md}`

## 3. Diagnosis, rules, templates

- [x] 3.1 `diagnose.ts`: tools on the host, test projects from git, sensitive files uncapped + patterns, packages uncapped, hot dirs only from ≥ 20 commits, a large generated file, external systems corrected, `packages_committed`, the `layout` block; tests
- [x] 3.2 `rules.json`: R06, R10, R11, R12, R17, R21, R25; tests
- [x] 3.3 `catalog/`: local-gate from the tools present, agents-md conditional sections and a layout map, per-area with the exact folder, which-package all-or-nothing, hooks covering PowerShell and `git add … && git commit`, deny by pattern, `.gitattributes` without `-diff`, `.gitignore` keeping a committed package folder; tests

## 4. Build and verification

- [x] 4.1 `verify.ts`: no `null` for text kinds, `configured` for connections, commands and relative paths checked, tolerance 0, a rule checks its own line, numbered checklists, hooks routed in settings; tests
- [x] 4.2 `build.ts`: preamble stripped, one fix attempt, shared files composed from the cards that passed, failed cards' files deleted, names from stable keys, `.dcc/onboarding.json`; tests
- [x] 4.3 `components.ts`: key collision suffixed, readiness ("same" not ok, always-loaded ≤ 3,000), the PR report with the with/without table, `deliverable`; tests
- [x] 4.4 `deliver.ts`: `git add` by name with its exit code, no `-A`
- [x] 4.5 `configured` everywhere a status is enumerated (types, web api, labels, build screen, coach, verify)

## 5. The run · `runs.ts`, `draft.ts`, `session.ts`, `types.ts`

- [x] 5.1 Plan phases (`draft` → `aside` → `scan` → `decide`); the draft only while the plan waits; `skipDraft`; `afterDraft` on session end
- [x] 5.2 The scan's "drop ours" applied as undoable declines; the reviewer's `processKey/stepKey/slug`; the author lean with the copy as an added folder and `FIX`
- [x] 5.3 The draft session's caps (`Automation.draftCapUsd/Minutes`, the monitor closes it, `--max-budget-usd` as a backstop); slices on exit, restart, build, delivery and cancel
- [x] 5.4 Step 4 = the "without" arm; the build = the "with" arm on the deliverable set; `Component.delta` written; `deliverableFiles` = verified | configured + `.dcc/onboarding.json`
- [x] 5.5 The envelope: the measurement's estimate and cap before step 4; `buildEstimateUsd` on the plan
- [x] 5.6 `removeBuiltComponent` + `POST …/components/:key/remove`; `POST …/draft/skip`
- [x] 5.7 Events: `trial.task` with arm/runIndex/turns/graders, `trial.stopped_at_cap`, `build.removed`, `component.removed`, `session.capped`, `draft.scan_applied`, `plan.phase`
- [x] 5.8 Screen copy in `types.ts` (`what_he`/`cost_he` of the trial, plan and build steps)

## 6. Data · `packages/db`

- [x] 6.1 Migration `0056`: `onboarding_trial` + `run_index`, `num_turns`, `graders`, `exercises`; the prompts `onboarding.trial`, `onboarding.judge`, `onboarding.review`, `onboarding.author` updated where no person edited them
- [x] 6.2 Schema; prompt contract (`EDITS`, `CLAIMS`, `COPY_DIR`, `EXPECT`, `FIX`)
- [x] 6.3 The one restart: API stopped → `dev:migrate` → `dev:prove` → API started (no watch)

## 7. Screens, glossary, spec, sweep

- [x] 7.1 `build.tsx`, `steps.tsx`, `plan.tsx`, `RepoDossier.tsx`, `cards.tsx`: the with/without table, the per-card delta and "מוצע להסרה", the envelope, the plan's phases, the draft caps in the rail — every element with an "i"
- [x] 7.2 Concepts: new keys and rewordings; `info:drift`
- [x] 7.3 `docs/onboarding-spec.html` (8 steps) and the artifact republished
- [x] 7.4 `scripts/audit-stale.mjs` retired names; `repository-coach/tasks.md` 2.6; `CLAUDE.md`; the sweep
- [x] 7.5 `prove-kit.ts` stand-in emitting tool events; `onboarding.prove.ts` extended

## 8. Proof

- [ ] 8.1 `typecheck`, `lint`, `test`, `audit:stale`, `info:drift`, `tsc -p apps/web`, `dev:prove`, `smoke`, `prove:onboarding`
- [ ] 8.2 A new TRADE run through the API (≤ $8/$11, ≤ 12 files, ≤ 3,000 always-loaded tokens, no `undefined`, no overwrite, deny complete)
- [ ] 8.3 `eval:onboarding` on the new set against 2.8 → `docs/research/2026-09-onboarding-eval-trade-after.*`; removals before delivery
- [ ] 8.4 Five public repositories (.NET with CI, TypeScript monorepo, Python with generated code, Java/Kotlin Gradle, Go/Rust with rich docs) to step 6, two of them also on the old process; DCC itself; the fix loop until the criterion holds
- [ ] 8.5 One PR to `master`; TRADE's delivery is the user's click
