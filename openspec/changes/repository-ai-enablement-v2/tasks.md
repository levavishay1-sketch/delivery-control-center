# Repository AI Enablement v2 — tasks, verdicts, evidence, validation

## 1. Verdict on every v1 stage (16 → 9)

| v1 stage | Verdict | Where it lives now |
|---|---|---|
| 01 workspace_setup | merge | `scan` (worktree + baseline; deterministic) |
| 02 repository_scan | merge | `scan` (profile; `stats.topLevel` added) |
| 03 classification | merge | `scan` — one no-tool call over the scan signals only |
| 04 security_permissions | remain, extend | `boundaries` gate: + existing-config policy (keep/merge/replace), + classification correction, + notes |
| 05 knowledge_coverage | merge | `discovery` — first step of the same read-only pass |
| 06 targeted_discovery | remain, absorb | `discovery` — one budgeted call: coverage + model + UNKNOWNs + questions |
| 07 human_enrichment | remain | `confirm` — auto-skips when there are no questions |
| 08 knowledge_generation | remove | no `docs/ai/*.md` encyclopedia; knowledge that is only sometimes needed becomes an on-demand skill decided in `plan` |
| 09 claude_md_generation | merge | `generate` — content from the model, file from DCC, ≤120 lines, `@AGENTS.md` first when AGENTS.md exists |
| 10 scoped_rules | merge | `plan` (justify; rules only with `paths:`) + `generate` |
| 11 skills_evaluation | merge | `plan` + `generate` (knowledge skills; workflow skills only with evidence they recur) |
| 12 guardrails | automate | catalog applicability decided in `plan`, scripts written by DCC in `generate`, exercised with sample inputs in `validate`; no separate gate |
| 13 ai_doctor | remain, extend | `validate` — deterministic checks + one AI review + one automatic fix loop |
| 14 user_review | remain, extend | `review` — full per-file diff, drop files, request changes with a note |
| 15 github_pull_request | remain | `deliver` — push + PR (gh when present, compare link otherwise) |
| 16 ai_ready | merge | `deliver` re-entry — merge detection is readiness |
| — | new | `plan` — the artifact plan as a human gate before any file is written |

## 2. Artifacts — the ten questions, answered per kind

| Artifact | Loading | Problem it solves / consumer | Already elsewhere? | Source of truth · staleness |
|---|---|---|---|---|
| `CLAUDE.md` (≤120 lines) | every session | commands Claude cannot guess, hard constraints, pointers; every lifecycle stage | points at README/AGENTS.md instead of copying | code + team decisions · watched by refresh (length, hash, paths) |
| knowledge skill | on demand (description only at startup) | repository map / integrations / verified human answers; planning, implementation, testing, review | only when discovery found it is MISSING/PARTIAL | discovery evidence + team answers · `watched_paths` |
| rule with `paths:` | when matching files are touched | area-bound conventions (generated code, migrations) | only if not already in AGENTS.md/CLAUDE.md | code · glob still matches files |
| nested CLAUDE.md | when files there are read | a genuinely separate subsystem's conventions | rarely justified in a single-app repo | code |
| agent | on invocation | a concrete recurring isolated task | almost never at onboarding | — |
| `.claude/settings.json` | never (client-enforced) | deny reads of build output/vendored code/secrets; profile axes; hook wiring | merged into an existing file, nothing removed | boundaries decision |
| guardrail hooks | never | deterministic blocks (secrets, dangerous git, generated/protected paths) | only when discovery found protected areas | DCC catalog templates |
| DCC hooks + `.dcc.json` | never | session/git capture on the DCC timeline ("no silent actions") | — | DCC `hooks/` |
| **not created** | — | `docs/ai/*` encyclopedia, workflow skills without recurrence evidence, agents, rules without paths, an AI-component catalog | derivable from code or already documented | — |

## 3. DCC vs. the repository

DCC keeps: runs, stages, decisions, executions (prompt version, model,
cost, tokens, denials), the artifact ledger (justification, consumers,
watched paths, hashes), refresh checks, cost telemetry. The repository
keeps: the artifacts themselves — the only copy Claude Code reads; DCC
never rewrites a file whose hash moved without a run a person reviews.

## 4. Implementation

- [x] 4.1 `types.ts` — nine `STAGES` with the Hebrew before-it-runs copy; automation presets + `normalizePolicy`; `PlannedArtifact`.
- [x] 4.2 `state-machine.ts` — driver loop, gates + auto-resolvers, `resetTo`, `AwaitingExternal`, reset-to-stage, stop execution, run view, per-file diff, boot-time recovery of interrupted runs.
- [x] 4.3 `runner.ts` / `ai-assist.ts` — `--restricted --strict-mcp-config --tools` (fallback `--allowed-tools --setting-sources user`), `--permission-prompts none`, `--json-schema`, `--max-budget-usd`, `--no-session-persistence`; tool-call counts, cache tokens, denials; `stopAllFlowRuns` on shutdown.
- [x] 4.4 Stages `scan`, `boundaries`, `discovery`, `confirm`, `plan`, `generate`, `validate`, `review`, `deliver`; `inventory.ts`, `artifacts.ts`, `schemas.ts`, `dcc-hooks.ts`, `settings-adapter.ts` (merge, never remove), `guardrails.ts`.
- [x] 4.5 `refresh.ts` — deterministic signals → one AI judgement → refresh run with carry-over.
- [x] 4.6 Schema `0032_repo_onboarding_v2.sql` — run `mode`/`previous_run_id`/`automation`/`review_note`, live-run index incl. `AwaitingExternal`, `repository_ai_artifact` (+RLS).
- [x] 4.7 Prompts `onboarding.v2.*` (`seed-prompts.ts`, `SEED_REPLACE=key|all` to roll out an edited seed); routing capabilities `onboarding_*`.
- [x] 4.8 API routes under `/repos/:id/onboarding/*` (+ `GET /onboarding/stages`); core errors surface as 409 with their message.
- [x] 4.9 Web: `RepoOnboardingPanel.tsx` + `screens/onboarding/{shared,stageViews,types}` + `theme.css` `.ob-*`; `Repositories.tsx` statuses; `AiComponents` screen removed.
- [x] 4.10 Removed `packages/core/src/repo-ai/*` (except `events.ts`, moved) and the repo-AI prompt block in assess/breakdown/implement.

## 5. Validation record (2026-09-18, fresh PGlite, fixture repo `orders-service`, Claude Code 2.1.277)

- Guided run through the browser forms: boundaries (notes + classification override) → discovery ($0.18, 26 turns, 24 tool calls, 17 evidence paths, 6 questions) → confirm (3/6 answered, 3 UNKNOWN) → plan (approve-as-proposed correctly rejected when CLAUDE.md was unchecked; approved with it) → generate → validate (READY_WITH_WARNING; hooks exercised; 524 always-loaded tokens, 31-line CLAUDE.md starting `@AGENTS.md`) → review (12-file diff viewer, approve) → deliver (local repo, `AwaitingExternal`) → merge by hand → "check again" → `CompletedWithWarnings`, readiness recorded. Total $0.905 / 7 calls.
- Automatic run (consent) on a second repo: all four gates auto-resolved and logged; the validate AI review caught a real defect (`npm run lint` cannot run — no ESLint config) and the one-shot fix loop regenerated CLAUDE.md; unattended to `AwaitingExternal`. Total $0.75 / 8 calls; 612 always-loaded tokens.
- Recovery: API killed mid-`plan` → boot marks the stage Failed with a clear reason, the orphaned execution Failed, and "retry" resumes the automatic policy.
- Lifecycle: refresh check right after the merge → no signals; after a watched-path change and a manual `CLAUDE.md` edit → `watched_path_changed` + `artifact_edited_outside_dcc`, AI judgement names the one artifact to update with evidence lines.
- Fixed while validating: directory artifact hashing (EISDIR), deliver reading git stderr as a remote/base, model skipping CLAUDE.md "because AGENTS.md", blank 500s on user-facing errors, the `.env.*` deny hiding `.env.example` (now conventional variants + files actually present), orphaned claude processes on shutdown.
- `npx tsc -b` clean; `apps/web` tsc clean except the pre-existing `WorkflowTab.tsx:253` error (untouched).

## 6. Follow-on fix (2026-09-18, discovered dogfooding a real client repo)

Real run on an internal .NET/CRM repository surfaced a gap: `validate`'s AI
review caught CLAUDE.md citing a pre-existing `docs/ai/architecture.md` (a
leftover from a prior, different onboarding pass) whose "secrets are never
hardcoded" claim was contradicted by two real leaked secrets found in the
code — but only after a paid `generate` retry had already written the bad
citation. Root cause: `discovery`'s `existing_instructions_assessment` (the
field that judges keep/merge/outdated/conflicting for existing AI artifacts)
was scoped only to CLAUDE.md/AGENTS.md/rules and its output was never read
by `plan` — computed and discarded. A pre-existing artifact that merely
*existed and was topically relevant* was treated as "already covered",
regardless of whether its content was still accurate — the same blind spot
for any repository carrying AI configuration from a previous process.

Fix (no new stage, no new gate, no DB schema change):
- `discovery`'s prompt now spot-checks concrete claims in EVERY existing
  AI-facing artifact from the inventory (settings, rules, skills, agents,
  and any doc a CLAUDE.md/rule/skill already cites), not just
  CLAUDE.md/AGENTS.md/rules — `outdated`/`conflicting` require the actual
  mismatched evidence, not a guess from the filename.
- `plan.ts` now reads that assessment and carries every `outdated`/
  `conflicting` entry forward as `PlanResult.staleArtifactWarnings` —
  computed deterministically, not by AI judgement, so it can't be silently
  dropped by a model choosing not to mention it.
- The plan gate's "approve" is refused server-side until every warning is
  acknowledged (a plain per-item checkbox in the UI) — mirrors the existing
  CLAUDE.md-must-be-checked guard, same enforcement point, same pattern.
  `automatic` policy auto-acknowledges, consistent with the explicit
  `consent: true` it already requires for every other auto-resolved gate.
- Verified end-to-end against a fabricated `WaitingForUser` plan stage
  (bypassing the paid AI call, since the guard sits in the resume path):
  approve without acknowledging → rejected naming the unacknowledged
  path(s); partial acknowledgment → rejected naming what's left; full
  acknowledgment → succeeds and advances to `generate`. `npx tsc -b` clean.
- Requires `SEED_REPLACE=onboarding.v2.discover` on rollout to register the
  broadened prompt as a new version.

## 7. Open questions / not verified here

- A repository with a real remote and `gh`: push + PR creation code path not exercised in this sandbox (no remote, no `gh`).
- The legacy-v1 live-run notice on the pre-start screen: no v1 rows existed to exercise it.
- Windows paths (`core.longpaths`, shell spawning) untested this session; `scc` was absent (fallback path exercised).
- Empirical papers are cited from secondary summaries (UNVERIFIED).
- FABLE: UNKNOWN — see the proposal.
