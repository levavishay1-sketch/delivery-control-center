# Repository AI Enablement

Status: **All 6 phases implemented, full replace of
`repository-ai-management`** — its UI (`RepoAiPanel.tsx`) was deleted
outright, not just superseded; see `tasks.md` for exactly what shipped
per phase, including every real bug live verification found and fixed.

## Why

`repository-ai-management` (2026-09-14/15) shipped a real, working core
loop — deterministic scan, `Read` deny rules, `/init`, a knowledge
baseline — but it was itself already a deliberate scope-down of an
18-section spec, and further hands-on use surfaced real limits: `/init`
alone doesn't produce durable, adaptive, per-repo-shaped knowledge; there
was no formal onboarding state machine (just three flat timestamp
columns); nothing pushed results anywhere for review (everything stayed
as local, unpushed commits); and every Claude call went through
one-off inline CLI-flag construction rather than one stable interface.

On 2026-09-16 the user supplied a third, much larger 36-section "Full
Implementation Specification": a 16-stage, GitHub-PR-based onboarding
pipeline with a `ClaudeCodeRunner` abstraction, prompt versioning,
adaptive per-repo artifact generation (not a fixed template every repo
gets), human knowledge enrichment, scoped rules/Skills/guardrails
evaluation, AI-Doctor validation, and incremental refresh. Confirmed with
the user: this **fully replaces** the 3-step flow, including reversing
the earlier decision to treat `/init` as CLAUDE.md's authoritative
source.

## What changed (Phase 1 — core infrastructure only)

A new, independent module (`packages/core/src/repo-onboarding/`, separate
from the old `repo-ai/`) implements the infrastructure every later stage
plugs into, without yet implementing any of the 16 stages' own logic
beyond two purely deterministic ones:

- **Isolated Git workspace per run** — `git worktree` off the existing
  shared clone (not a fresh clone per run), pinned to a baseline commit
  SHA, on its own `ai/repository-onboarding/<run-id>` branch.
- **A resumable, persisted state machine** — `repository_onboarding_run`
  + `repository_onboarding_stage` (one row per (run, stage), updated in
  place on retry — re-entering a failed run always resumes at "the first
  stage not yet terminal," never re-running earlier ones).
- **`ClaudeCodeRunner`** — the one abstraction in the app allowed to know
  Claude Code CLI flag details; wraps the existing `runClaudeRaw`/
  cancellation machinery (`stopFlowRun`/`sendRunMessage`) and persists a
  `repository_onboarding_claude_execution` row per call.
- **Prompt versioning** — `onboarding_prompt_template`, immutable
  per-version rows (an execution always resolves to the exact text it
  ran, even after a later edit) — a new table, not the existing mutable
  `prompt_template`, since that table's in-place-edit semantics serve a
  different, still-needed use case (assess/breakdown/retro) that must
  not change.
- **The deterministic repository scanner** — `scanRepository()`:
  languages, build systems (`.sln`/`.csproj`/`package.json`/…), test/CI/
  framework signals (light, bounded content-sniffing — `package.json`
  deps, `.csproj` package refs — never full comprehension), folding in
  the same junk-directory/extension detection the old flow's step 2 used.
- Two registered stages exercising the whole pipeline end to end:
  `workspace_setup`, `repository_scan`.
- 4 debug-level routes (`/repos/:id/onboarding/runs...`) — not yet wired
  into any screen; only 2 of 16 stages exist.

**Bundled alongside** (small, self-contained, same "real person behind
every action" principle): fixed `runImplement`'s git commit author,
previously hardcoded as `DCC <dcc@local>` regardless of who actually
triggered the run — now resolves the acting user's real name/email
(`resolveCommitIdentity`, `ai-assist.ts`).

## Decisions carried over from the user (2026-09-16)

1. **Full replace**, not additive — the old 3-step flow's *process* is
   superseded; `/init` is no longer treated as CLAUDE.md's authoritative
   generator (a future stage generates it from curated, multi-stage
   inputs instead).
2. **GitHub push/PR must be attributable to the actual DCC operator's own
   identity** — investigated live: `pushTask`'s existing `git push`
   already relies on ambient local git/gh credentials, which is correct
   given DCC's actual deployment model (one operator per local instance);
   no separate stored-credential design was introduced.
3. **Old data (`repo_ai_profile` etc., e.g. Altshuler Trade's completed
   run) is left alone for now** — no backfill/migration/drop this pass;
   explicitly deferred.
4. **The existing step-rail UX/interaction pattern is being kept, not
   redesigned** — a future onboarding screen extends `StepRail` (already
   built and reused this session) to more steps with the same
   explanatory style; what changes is the pipeline's *content*, not the
   UI paradigm.
5. Implementation proceeds in the user's own stated 6-phase order (core
   infra → analysis → artifact generation → safety → validation/delivery
   → optimization) — **this change covers Phase 1 only.**

## Explicitly out of scope this pass

- Stages 3–16 (classification, knowledge coverage, targeted discovery,
  human enrichment, artifact generation, CLAUDE.md generation, scoped
  rules/Skills/guardrails, AI Doctor, user review, GitHub PR, AI Ready,
  incremental refresh) — Phase 2+.
- Any UI for the new pipeline (the debug routes are exercised directly).
- Migrating, backfilling, or dropping any `repo_ai_*` table.
- Deleting `RepoAiPanel.tsx` or its routes — both still fully functional.
- Automatic workspace cleanup/GC (a workspace is released explicitly,
  never on a timer).

## Impact

- `packages/db` — 5 new tables, migration `0031`.
- `packages/core/src/repo-onboarding/*` — new module (types, workspace,
  runner, scanner, prompts, state-machine, two stage handlers, a
  standalone `smoke.ts`).
- `packages/core/src/ai-assist.ts` — `resolveCommitIdentity` export +
  fix to `runImplement`'s commit author.
- `apps/api/src/server.ts` — 4 new debug routes.
- `openspec/changes/repository-ai-management/` — left untouched; its
  documented scope-down decisions (esp. §0.5 on `/init`) are the ones
  this change's decision #1 explicitly reverses.

## Exit gate (Phase 1)

A real repository (verified: Altshuler Trade, a large, complex, genuinely
messy .NET/Dynamics 365 codebase) can be run through `workspace_setup` →
`repository_scan` to completion, producing an isolated Git workspace and
an accurate structural profile, resumably (a killed/failed run picks back
up at the right stage, never repeating earlier ones), without blocking
any other concurrent use of the app — and `ClaudeCodeRunner` is proven
end-to-end independent of the state machine (a real `claude -p` call,
persisted, cancellable-registry-safe) even though neither of Phase 1's
own stages calls it yet.
