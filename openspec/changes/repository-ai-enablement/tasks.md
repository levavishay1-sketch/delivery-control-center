# Repository AI Enablement — tasks

Appetite: **large** — user-directed full implementation, 2026-09-16.
Phase 1 (core infrastructure), Phase 2 (analysis), Phase 3 (artifact
generation), Phase 4 (safety), Phase 5 (validation & delivery), and
Phase 6 (optimization) — all 6 of the user's own "Implementation Order".
See "Phase 2" through "Phase 6" below for each pass, and "UI Front Door
Replacement" at the very end for the 2026-09-16 follow-up that made the
new pipeline the sole UI, deleting the old flow's screen entirely.

## 0. Decisions (delegated/decided by the user, not this session)

- [x] 0.1 Full replace of the 3-step `repository-ai-management` flow,
      including reversing the earlier decision to use `/init` as
      CLAUDE.md's authoritative source.
- [x] 0.2 GitHub push/PR attribution — investigated the existing
      `pushTask`/`actingUser` mechanism live (see the session's own
      finding: `actingUser` is a documented "Phase 0... NOT production
      auth" shim, and `pushTask`'s `git push` relies on ambient local
      git/gh credentials with no per-user token lookup). Concluded this
      is *already correct* given DCC's real deployment model — no
      separate stored-credential design added this pass.
- [x] 0.3 Old data left alone — no backfill/migration/drop of
      `repo_ai_profile` or its siblings.
- [x] 0.4 Existing `StepRail`/rich-Hebrew-explanation UX pattern is kept
      for any future onboarding screen — not redesigned.
- [x] 0.5 Phased implementation order confirmed; this change covers
      Phase 1 only.

## 1. Schema + core (`packages/db`, `packages/core/src/repo-onboarding/`)

- [x] 1.1 5 new tables, migration `0031_repo_onboarding_phase1.sql`,
      applied incrementally (`dev:migrate`, preserving existing pilot
      data) to local PGlite. RLS on every client-scoped table
      (`repository_onboarding_run/stage/claude_execution`,
      `repository_profile`); `onboarding_prompt_template` is org-shared/
      no-RLS, same reasoning as `prompt_template`.
- [x] 1.2 `workspace.ts` — `ensureOnboardingWorkspace`/
      `releaseOnboardingWorkspace`, `git worktree` off the existing
      shared clone (`ensureCheckout`, reused as-is).
- [x] 1.3 `runner.ts` — `ClaudeCodeRunner`, wraps `runClaudeRaw` +
      persists `claude_execution` rows; reuses the existing
      `stopFlowRun`/`sendRunMessage` registry by passing its own
      `executionId` through as `runClaudeRaw`'s `opts.runId`.
- [x] 1.4 `prompts.ts` — `getActiveOnboardingPrompt`/
      `registerPromptVersion` against the new immutable-version table.
- [x] 1.5 `scanner.ts` — `scanRepository`: languages, build systems,
      test/CI/framework signals (bounded content-sniffing), folding in
      the junk-dir/extension detection `repo-ai/permissions.ts` uses for
      the old flow (deliberately duplicated, not shared-imported — the
      old flow stays untouched per decision 0.3).
- [x] 1.6 `state-machine.ts` — `registerStage`/`startOnboardingRun`/
      `advanceRun`/`cancelRun`/`getOnboardingRunView`; two stages
      registered (`workspace_setup`, `repository_scan`).
- [x] 1.7 `ai-assist.ts` — `resolveCommitIdentity` + fix to
      `runImplement`'s hardcoded `DCC <dcc@local>` commit author.

## 2. API

- [x] 2.1 `POST /repos/:id/onboarding/runs`,
      `POST .../runs/:runId/advance`, `GET .../runs/:runId`,
      `POST .../runs/:runId/cancel` (`apps/api/src/server.ts`) —
      debug-level, not yet wired into any screen.

## 3. Verify end to end — real bugs found and fixed live, not just typechecked

- [x] 3.1 **Transaction-holding bug (real, found live):** an early
      version of `advanceRun` ran a stage handler (which can do slow
      external I/O — git clone/worktree, a `claude -p` call) *inside* a
      `withTenant` transaction. `withTenant`'s own doc comment says
      PGlite is a single connection — confirmed live: starting a run
      hung `/repos`, `/dashboard`, and every other route for as long as
      the git workspace setup took (minutes), not just the one request.
      Fixed by splitting `advanceRun` into three separate `withTenant`
      calls, with the handler invocation between them, no transaction
      open.
- [x] 3.2 **Retry-blocking bug (real, found live):** `RUN_TERMINAL`
      (renamed `RUN_DONE`) included `"Failed"`, so `advanceRun` on a
      failed run silently no-op'd instead of re-entering the failed
      stage — defeating resumability entirely. Verified live: a retry
      call returned instantly with the *same* stale timestamps as the
      first failure, never re-attempting anything. Fixed by excluding
      `"Failed"` from the terminal set (only `Completed`/
      `CompletedWithWarnings`/`Cancelled` are truly done).
- [x] 3.3 **Windows long-path bug (real, found live):** `git worktree
      add` into a UUID-named directory failed with `fatal: Could not
      reset index file to revision 'HEAD'` after checking out 100% of
      Altshuler Trade's ~5700 files — reproduced manually outside the
      app (a short directory name succeeded, the same long UUID path
      failed identically), confirmed `-c core.longpaths=true` fixes it.
      Applied to every git invocation in `workspace.ts`.
- [x] 3.4 **Workspace non-idempotency (real, found live):** a retry
      re-entering `workspace_setup` for the same `runId` hit a stale,
      partially-checked-out directory and/or stale branch ref left by an
      earlier interrupted attempt (the API process being killed
      mid-checkout) — `git worktree add` isn't idempotent against either.
      Fixed with defensive cleanup (`worktree remove` + `rm -rf` the
      target dir, `branch -D` the target branch) before every attempt.
- [x] 3.5 Full real run, end to end, against Altshuler Trade (large,
      genuinely messy .NET/Dynamics 365 codebase, not a fixture):
      `workspace_setup` → `repository_scan` → run `Completed`. Scanner
      output verified accurate: 801 C#/59 JS/26 TS files, 68 real
      `.sln`/`.csproj`/`package.json` build-system entries, framework
      signals correctly detected (`Dynamics 365`, `.NET Framework`,
      `React` — via bounded `.csproj`/`package.json` content sniffing),
      correct junk-path detection (`bin`/`obj`/`build` dirs, `.dll`/
      `.exe`/`.pdb` extensions — matching this session's earlier manual
      finding), `maxDepthHit` correctly flagged as a warning
      (`CompletedWithWarnings`).
- [x] 3.6 Resumability proven, not just designed: the same run's
      `workspace_setup` stage failed twice (bugs 3.1–3.4 above, caught
      *during* this very verification) and succeeded on the third
      attempt — the persisted `history` array correctly captured both
      prior failures, `attempt` incremented correctly, and
      `repository_scan` never re-ran once already `Completed`.
- [x] 3.7 Concurrency proven: `/repos` and `/dashboard` confirmed
      responsive (curl, short timeout) *while* a multi-minute real
      checkout was in flight, directly verifying the fix in 3.1.
- [x] 3.8 `ClaudeCodeRunner` proven independent of the state machine
      (neither Phase 1 stage calls Claude): standalone `smoke.ts` — real
      `claude -p` call, `claude_execution` row persisted with the
      correct status/prompt-template linkage, `cancel()`/`sendMessage()`
      confirmed safe no-ops on an already-finished execution. 7/7 checks
      passed. (Also found and fixed a smaller bug here: the script
      initially didn't insert a `repository_onboarding_run` row for its
      own throwaway `runId`, tripping the real FK constraint on
      `claude_execution.run_id` — fixed by inserting one, marked
      `Cancelled` at the end so it doesn't block the one-live-run-per-repo
      guard.)
- [x] 3.9 Old flow confirmed untouched: `GET /repos/:id/ai` (the old
      3-step flow's route) still returns Altshuler Trade's real,
      previously-generated profile/knowledge/deny-rules correctly, byte
      for byte the same as before this change.
- [x] 3.10 `npm run typecheck` clean throughout every step above.

**Summary: Phase 1's infrastructure (isolated workspace, resumable state
machine, `ClaudeCodeRunner`, prompt versioning, deterministic scanner) is
implemented and was verified against a real, large, messy repository end
to end — not just typechecked. Live testing caught and fixed FOUR
genuine bugs (a transaction-holding app-wide freeze, a retry-blocking
terminal-status bug, a Windows long-path checkout failure, and workspace
non-idempotency on retry), each reproduced and confirmed fixed before
moving on. Stages 3–16, any new-pipeline UI, and the old-data migration
are deliberately deferred to later phases, not attempted speculatively.**

---

# Phase 2 — Analysis (2026-09-16)

Five new stages: Classification, Security & Permissions, Existing
Knowledge Coverage, Targeted Discovery, Human Knowledge Enrichment.
Confirmed with the user: a real minimal UI for the two `WaitingForUser`
stages (not just debug routes, unlike Phase 1's own maturity level).

## 0. Decisions

- [x] 0.1 Build a real minimal UI now for `security_permissions`/
      `human_enrichment` (the two genuinely interactive stages) —
      `RepoOnboardingPanel.tsx`, reusing `StepRail`. Stages 03/05/06 stay
      at step-rail-plus-advance-button, same as Phase 1.

## 1. Schema + core (`packages/core/src/repo-onboarding/`)

- [x] 1.1 `types.ts` — `StageContext.resumeInput?: unknown` (the resume
      mechanism every `WaitingForUser`-capable handler branches on);
      `STAGE_ORDER` extended to the 5 new stage keys.
- [x] 1.2 `json.ts` — `extractClaudeJson<T>`, the onboarding-side
      equivalent of `ai-assist.ts`'s inline JSON extraction (duplicated,
      not shared — `ClaudeCodeRunner.run()` returns only raw `text`).
- [x] 1.3 `state-machine.ts` — `submitStageInput` (the only way to
      resume a `WaitingForUser` stage) plus a `persistStageOutcome`
      helper factored out of `advanceRun` so both share one place that
      knows what each `StageOutcome.status` means for the run row.
- [x] 1.4 Five stage handlers (`stages/classification.ts`,
      `security-permissions.ts`, `knowledge-coverage.ts`,
      `targeted-discovery.ts`, `human-enrichment.ts`) — prompt bodies
      adapted near-verbatim from the user's own spec text.
- [x] 1.5 `seed-prompts.ts` — one-time idempotent seed for the 4 new
      `onboarding_prompt_template` rows (`security_permissions` needs
      none — it's deterministic, sourced from stage 02's own
      `repository_profile.ignoredPaths`, not a Claude call).
- [x] 1.6 `POST /repos/:id/onboarding/runs/:runId/stages/:stageKey/input`
      — one generic route, reused by both `WaitingForUser` stages.
- [x] 1.7 `RepoOnboardingPanel.tsx` + `api.ts` client functions — new
      screen, fully decoupled from `RepoAiPanel.tsx`.

## 2. Verify end to end — five real bugs found and fixed live

- [x] 2.1 **`WaitingForUser` never actually handled (real, found live,
      anticipated during design):** `advanceRun`'s outcome branch only
      distinguished `Failed` from everything else — a stage returning
      `WaitingForUser` was silently treated as "completed, advance to
      the next stage," and the run's own `status` column was never set
      to `"WaitingForUser"` at all. A second `advanceRun` call would
      then re-enter and WIPE the waiting stage's data via the retry
      path. Fixed before implementation (found while investigating
      Phase 1's code to design Phase 2, confirmed by direct code
      reading + grep) by short-circuiting `advanceRun` entirely when
      `run.status === "WaitingForUser"`, and adding a dedicated
      `WaitingForUser` branch in the persist step that sets the run
      status and leaves `currentStageKey` untouched.
- [x] 2.2 **`run.status` stuck at "WaitingForUser" after a successful
      resume (real, found live during actual verification):** the
      "advance to the next stage" branch updated `currentStageKey` but
      never reset `status` back to `"Running"` — harmless in
      `advanceRun`'s own prep phase (which always sets `status:
      "Running"` first), but `submitStageInput` never touches `status`
      at all, so after `security_permissions` was approved, the run
      correctly advanced its `currentStageKey` to `knowledge_coverage`
      while its `status` column stayed `"WaitingForUser"` forever —
      confirmed live via a driving script, then fixed by setting
      `status: "Running"` explicitly in that branch.
- [x] 2.3 **`--settings` inline JSON corrupted by Windows shell quoting
      (real, found live, root-caused in isolation):** `knowledge_coverage`
      failed with `Invalid JSON provided to --settings`. Reproduced with
      a bare `runClaudeRaw` call (no pipeline code involved, a single
      deny rule) — confirmed the identical JSON string works perfectly
      when `claude` is invoked directly, but is corrupted when Node
      spawns `claude.cmd` with `shell: true` (required on Windows) and
      the command is routed through `cmd.exe`. Fixed in `ai-assist.ts`
      by writing the settings JSON to a temp file and passing
      `--settings <path>` instead — `claude --help` confirms the flag
      accepts either form. This transparently also fixes the same
      latent risk in the OLD flow's `/init`/knowledge-generation calls,
      which share `runClaudeRaw`.
- [x] 2.4 **Local PGlite database corruption (real, operational, not a
      code bug):** while re-verifying 2.3, the dev database stopped
      starting entirely (`RuntimeError: Aborted()` inside Postgres's own
      WASM crash-recovery code), reproduced identically via this repo's
      own trusted `dev:migrate` script — not specific to any script of
      mine. Root cause: almost certainly an earlier `tsx watch` double-
      process race in this session (the exact failure mode `CLAUDE.md`'s
      own PGlite warning describes) left a torn/inconsistent write.
      Diagnosed thoroughly before taking any destructive action — ruled
      out disk space and memory, confirmed a stale `postmaster.pid`
      (removed, no effect), quarantined the most-recently-written WAL
      segment (no effect — confirmed the corruption is deeper than WAL
      replay, most likely `pg_control` itself), verified a web-search-
      suggested "fix" doesn't actually exist in the installed package
      before considering it. No `pg_resetwal`/`pg_waldump` ships with
      PGlite's embedded WASM build, so proper low-level repair wasn't
      possible. With explicit user approval: took a full backup, then
      `dev:reset` + `dev:setup` (all 32 migrations reapplied cleanly) +
      recreated the Altshuler Trade pilot client/repo via the existing
      `scenario-altshuler.ts` script + re-ran `seed-prompts.ts`. The
      Phase 1/2 test-run history from earlier in this session was lost;
      no code was at fault.
- [x] 2.5 **Full pipeline re-verified end to end on the fresh database**
      against the real Altshuler Trade repo: all 7 stages (workspace
      setup through human enrichment) reached `Completed`/
      `CompletedWithWarnings`. Output quality confirmed genuinely
      useful, not just structurally present — classification correctly
      identified "Enterprise line-of-business system: Microsoft
      Dynamics 365 (Dataverse) CRM customization", targeted discovery
      correctly mapped real execution flows and the ILMerge sandbox
      boundary (40 of 69 `.csproj` files), and human enrichment
      surfaced 9 genuinely high-value Hebrew questions — including,
      unprompted, a real security finding: a hardcoded password in a
      connection string in `Test/ParserTester/Program.cs`.
- [x] 2.6 Regression-verified the 2.1/2.2 fixes directly: started a
      fresh run, drove it to `security_permissions`'s `WaitingForUser`,
      then called `advanceRun` directly (not `submitStageInput`) and
      confirmed the stage row's `status`/`attempt`/`updatedAt` and the
      run's own `status` were all byte-for-byte unchanged — a true
      no-op, not just "returns the right value while quietly mutating
      state" (the exact shape of bug 2.1).
- [x] 2.7 `npm run typecheck` clean throughout every step above.

**Summary: Phase 2's five analysis stages are implemented and were
verified against a real, large, messy repository end to end — not just
typechecked. Live testing caught and fixed three genuine pipeline bugs
(`WaitingForUser` not handled at all, a stuck run-status after resume,
and Windows shell-quoting corruption of `--settings`) plus surfaced and
recovered from a serious, unrelated operational incident (local database
corruption, most likely from an earlier session mishap, not from this
phase's own code) — diagnosed carefully, backed up, and recovered only
with explicit user approval at each destructive step. The full pipeline
now runs a real repository through all 7 implemented stages producing
genuinely useful, evidence-grounded output. Stages 8–16, the GitHub
PR/branch lifecycle, and artifact generation remain for later phases.**

---

# Phase 3 — Artifact Generation (2026-09-16)

Three new stages — the pipeline's first file-writing stages: Repository
Knowledge Generation (`docs/ai/*.md`), CLAUDE.md Generation, and Scoped
Rules Evaluation. All real repo access, least-privilege (`Bash` explicitly
denied alongside the approved deny rules — none of these stages need a
shell).

## 0. Decisions

- [x] 0.1 Each of the 3 stages commits its own changes immediately after
      writing files (`commit.ts`'s `commitWorkspaceChanges`, reusing
      `ai-assist.ts`'s `resolveCommitIdentity` — never the old
      `repo-ai/bootstrap.ts`'s hardcoded `DCC <dcc@local>`) — mirrors
      `runImplement`'s existing "commit locally, never push" pattern and
      keeps the state machine's resumability guarantee intact. Low-stakes/
      reversible, not put to the user — a single squashed commit before
      the eventual PR (Phase 5) is easy regardless of how many commits
      land on the branch now.

## 1. Schema + core (`packages/core/src/repo-onboarding/`)

- [x] 1.1 `commit.ts` — `commitWorkspaceChanges(dir, userId, message)`:
      `add -A` → `diff --cached --name-only` → (if non-empty)
      `resolveCommitIdentity` → commit with the real acting user's
      name/email → short SHA. Returns `{commitSha: null, filesChanged:
      []}` when nothing changed (a valid outcome, not an error).
- [x] 1.2 `STAGE_ORDER` extended to the 3 new stage keys.
- [x] 1.3 `stages/knowledge-generation.ts` — `accept_edits`, writes
      `docs/ai/*.md`. Adaptive by design per the spec's own anti-goal
      ("do not implement a fixed template") — Claude decides which of
      the 4 possible files are justified, not this code.
- [x] 1.4 `stages/claude-md-generation.ts` — `accept_edits`, writes
      `CLAUDE.md`, reading stage 08's `docs/ai/*.md` output directly off
      disk (not handed as a prompt var) so it can genuinely choose to
      reference rather than duplicate it.
- [x] 1.5 `stages/scoped-rules.ts` — two Claude calls per candidate
      domain: one evaluation call (JSON `{candidates: [...]}`), then one
      generation call per approved candidate. See 2.2/2.3 below for why
      this stage's design changed twice during live verification.
- [x] 1.6 `seed-prompts.ts` — 4 more entries (`onboarding.
      knowledge_generation`, `onboarding.claude_md_generation`,
      `onboarding.scoped_rules_evaluate`, `onboarding.
      scoped_rules_generate`), same idempotent seed pattern as Phase 2.
- [x] 1.7 No new UI — stages 08–10 are non-interactive (no
      `WaitingForUser`); `RepoOnboardingPanel.tsx`'s existing generic
      status block already covers them, same as stages 03/05/06.

## 2. Verify end to end — three real bugs found and fixed live

- [x] 2.1 **Windows 8.3 short-name path silently blocking writes (real,
      found live):** `claude_md_generation` and `scoped_rules` both
      reported `status: "Completed"` with zero files written — no thrown
      error. Root-caused by reading the raw `resultText` off the
      `repository_onboarding_claude_execution` row directly, which
      contained Claude's own explanation: the write was blocked by a
      security check on the workspace path, which it flagged as
      suspicious. Confirmed `os.tmpdir()`/`process.env.TEMP`/`TMP` all
      resolve to the Windows short-name form (`C:\Users\AVISHA~1\...`) on
      this machine, while `os.homedir()`/`USERPROFILE` resolve correctly
      to the long form. Fixed by changing both `REPO_CACHE`
      (`ai-assist.ts`) and `ONBOARDING_CACHE` (`workspace.ts`) from
      `os.tmpdir()`-based paths to `os.homedir()`-based ones — benefits
      the old `/init`/`runImplement` flows too, since they share
      `REPO_CACHE`. Verified via a cheap isolated write test before
      committing to a full expensive pipeline re-run. Added defensive
      checks in both write-mode stages (fail on unexpected zero-file-
      writes for `claude_md_generation`; warn for `knowledge_generation`,
      where zero files is sometimes a legitimate adaptive outcome) as a
      safety net against similar future silent-failure modes.
- [x] 2.2 **`.claude/rules/` is a Claude Code "protected path" (real,
      found live on the second full run, after 2.1's fix resolved
      everything else):** one `scoped_rules` candidate still reported
      `status: "Completed"` with zero files written. The raw
      `resultText` for that execution showed Claude explicitly asking
      for approval to write inside `.claude/rules/` as a sensitive path.
      Confirmed via `WebFetch` of the official Claude Code permission-
      modes documentation: `.claude/` is one of Claude Code's own
      protected paths, "never auto-approved, except in `bypassPermissions`
      mode" — a mode whose own docs carry an explicit "only use in
      isolated environments... where Claude Code cannot damage your host
      system" warning, judged inappropriate to adopt for a routine
      onboarding stage running on the real DCC operator's machine.
      Fixed with a design change, not a permission-mode workaround:
      `scoped-rules.ts`'s generation call now runs in `read_only_plan`
      and returns the drafted rule content as data instead of attempting
      a Write — deferring the actual file creation to a human, which
      fits the spec's own later "User Review" stage (Phase 5) better
      than a direct write would have anyway.
- [x] 2.3 **Claude's own JSON output broke on an embedded, un-escaped
      quote (real, found live immediately after 2.2's fix):** the
      redesigned generation call asked Claude to return `{"content":
      string}`, where `content` is a full multi-paragraph Markdown
      document. One candidate's drafted rule contained an ordinary
      quoted phrase in its prose (`a job that "isn't processing"`) with
      the quotes left un-escaped, breaking `JSON.parse` partway through
      the string. Recognized this as a structural fragility, not a
      one-off Claude mistake — hand-escaping arbitrary long-form prose
      into a JSON string value is inherently error-prone regardless of
      model quality. Fixed by adding `extractFencedBlock` (`json.ts`)
      and switching the generation prompt to return the rule as a single
      fenced Markdown code block instead of JSON — no escaping required
      at all, sidestepping the failure mode structurally rather than
      just tightening the prompt wording and hoping it holds on the next
      repo.
- [x] 2.4 Re-verified `scoped_rules` against the real Altshuler Trade
      repository after 2.3's fix: `Completed`, zero warnings, zero
      errors. 8 of 9 candidate domains correctly judged `rule_needed:
      false` specifically because the content was already covered in the
      freshly-generated root `CLAUDE.md` (the adaptive/non-duplication
      principle working as designed, not merely asserted) — the one
      approved candidate (Service Bus "WebJobs" that aren't actually
      WebJobs-SDK-triggered) produced a genuinely repo-specific,
      non-generic drafted rule grounded in real files it had read.
- [x] 2.5 Found live, unrelated to this phase's own code: 7 orphaned
      `npm run -w @dcc/api dev` processes (plus a few leftover one-off
      script processes) accumulated across the session's various
      restarts, all still running and all capable of holding
      `packages/db/.pgdata` open concurrently — the same condition that
      caused the Phase 2 database-corruption incident. Found via process
      inspection before running any DB script; stopped all of them with
      explicit user approval before proceeding, avoiding a repeat
      incident.
- [x] 2.6 `npm run typecheck` clean after every step above.

**Summary: Phase 3's three artifact-generation stages are implemented
and verified end to end against the real Altshuler Trade repository —
`docs/ai/*.md`, `CLAUDE.md`, and a drafted scoped rule were all produced
with genuinely useful, non-generic, repo-grounded content, each commit
correctly attributed to the real acting user. Live testing caught and
fixed three real bugs in sequence, each only visible once the previous
one was fixed (a Windows path bug, a Claude Code protected-path
permission boundary, and a JSON-escaping fragility in how structured
output was requested) — the same discipline as Phase 2: verify against
real files on disk and real `git log`/`git diff` output, never trust a
reported "Completed" status alone. Stages 11–16 (Safety, Validation &
Delivery including the GitHub PR flow, and Optimization) remain for
later phases, not started without further direction.**

---

# Phase 4 — Safety (2026-09-16)

Three deliverables per the user's own spec §34 "Implementation Order":
**Security profiles**, a **Claude settings adapter**, and a **Guardrail
catalog** (spec §11 Stage 04 and §19 Stage 12). Stage 04
(`security_permissions`, already implemented in Phase 2) was enriched,
not rewritten; a new stage 11 (`guardrails`, spec stage 12 — spec stage
11 "Skills Evaluation" is Phase 6, deferred) does the pipeline's second
and final `.claude/` write. Fully deterministic — zero new Claude
prompts, a first for any phase so far.

## 0. Decisions

- [x] 0.1 `.claude/settings.json` is written by ONE stage only
      (`guardrails`, last), not split across `security_permissions` and
      `guardrails` — avoids a two-stage read-modify-write race on the
      same file. `security_permissions` only resolves and returns the
      Effective Policy as stage-result data.
- [x] 0.2 The resolved security profile affects only the generated
      `.claude/` artifact, not the pipeline's own internal Claude calls
      (stages 08–10 keep their existing independently-reasoned
      `[...approvedRules, "Bash"]` denyRules) — retrofitting profile-
      driven gating into already-verified stages was out of proportion
      for what the spec actually asks Phase 4 to build.
- [x] 0.3 Guardrail hook scripts are a small, pre-authored, reviewed
      catalog (4 entries) copied into the repo, not generated per-repo by
      Claude — matches the spec's own wording ("DCC should maintain a
      central catalog of reviewed guardrails," with Claude-generation
      explicitly framed as a fallback) and sidesteps Phase 3's
      `.claude/` protected-path bug entirely, since these writes go
      through plain Node `fs`, never Claude Code's own Write tool.

## 1. Schema + core (`packages/core/src/repo-onboarding/`, `config/`)

- [x] 1.1 `config/security-profiles.json` — 5 DCC-owned profiles
      (`STANDARD_DEVELOPMENT`, `RESTRICTED`, `READ_ONLY`, `SANDBOX`,
      `INFRASTRUCTURE`) over the spec's own axes (read/write/commands/
      network/mcp), same cached-flat-JSON-catalog pattern as
      `routing.ts`'s `loadPolicy()`/`config/model-policy.json` — no
      DB table or admin UI, since nothing in the spec asked for one and
      "DCC owns the policy."
- [x] 1.2 `security-profiles.ts` — `loadProfileCatalog()`,
      `resolveEffectivePolicy(profileId, deniedReadPaths)` (spec's
      "Organization Policy + Repository-specific Delta = Effective
      Policy"), `suggestSecurityProfile(classification)` — a small,
      explainable heuristic off `classification`'s `detected_domains`/
      `repository_type`, never inventing a new profile (spec §11:
      "Claude must not invent the organization's security policy").
- [x] 1.3 `settings-adapter.ts` — `buildClaudeSettings(policy,
      enabledGuardrails)`, the one other place (besides `ClaudeCodeRunner`)
      allowed to know Claude Code's on-disk config schema. Confirmed the
      real shape against two live sources before writing it: `ai-assist.ts`'s
      own `--settings` construction (`permissions.deny`) and this repo's
      own dogfooded `.claude/settings.json` (`hooks.<Event>` shape).
      `"ask"`-valued policy axes are deliberately NOT emitted as Claude
      Code `ask` rules — the onboarding pipeline itself has no concept of
      an interactive human to answer one; only the unambiguous
      `allow`/`deny` axes are baked into the committed artifact.
- [x] 1.4 `guardrails.ts` + `guardrail-templates/*.mjs` (4 files:
      `protect-secrets`, `prevent-dangerous-git`, `protect-generated-code`,
      `restrict-write-paths`) — the reviewed catalog, each a small,
      deterministic `PreToolUse` hook (no LLM, no network, exit 2 +
      stderr message to block, matching the real Claude Code hook
      protocol).
- [x] 1.5 `stages/security-permissions.ts` — enriched: suggests/approves
      a profile alongside the existing deny-rule list; embeds the full 5-
      profile catalog (label/description) in its own result so the UI
      never needs a second round-trip; resume input extends to
      `{approvedRules, approvedProfileId}`; result gains `effectivePolicy`.
      Still writes no files, as before.
- [x] 1.6 `stages/guardrails.ts` (new, `STAGE_ORDER`'s 11th entry) —
      `WaitingForUser`: suggests the applicable-by-heuristic subset of
      the 4 catalog guardrails (`protect-generated-code`/
      `restrict-write-paths` suggested only when `targeted_discovery`
      found real `generated_or_protected_areas`). On approval: builds
      `.claude/settings.json` (combining `security_permissions`'
      resolved policy + the approved guardrails' hook wiring in one
      shot), copies the hook template files into `.claude/hooks/`,
      commits via Phase 3's `commitWorkspaceChanges` — unchanged.

## 2. UI — `RepoOnboardingPanel.tsx`

- [x] 2.1 `security_permissions`'s existing approval block gains a
      5-option profile picker (radio, suggested option marked) above the
      existing rule-list editor.
- [x] 2.2 New `guardrails` approval block (checkbox list, suggested ones
      pre-checked) — same visual pattern as the other two `WaitingForUser`
      blocks.
- [x] 2.3 `STAGE_LABELS` backfilled with Phase 3's 3 stages (missed at
      the time) plus the new `guardrails` entry.

## 3. Verify end to end — one real bug found and fixed live

- [x] 3.1 Reused the proven "reset one stage row to `Pending` +
      `advanceRun`" driver pattern (Phase 3) against the existing
      completed Altshuler Trade run: reset `security_permissions`,
      re-suggested correctly, approved via `submitStageInput`. The very
      next `advanceRun` call jumped straight to `guardrails` in 0.0s,
      skipping stages 05–10 entirely without re-running any of them —
      live proof the state machine's resumability genuinely treats an
      inserted stage as "the first not-yet-terminal one," not a full
      re-run, exactly as designed back in Phase 1.
- [x] 3.2 Profile suggestion confirmed genuinely repo-appropriate, not
      just "a profile got picked": Altshuler Trade (Dynamics 365 CRM with
      a compliance-sensitive KYC/AML/Blacklist domain, per stage 03's own
      classification) correctly suggested `RESTRICTED`, not
      `STANDARD_DEVELOPMENT` or `SANDBOX`.
- [x] 3.3 **`generated_or_protected_areas` entries are free text, not a
      clean path field (real, found live):** `targeted_discovery` had
      written entries like `"Shared/.../Entities.cs (98,438 lines,
      auto-generated)"` and `"packages/ — vendored NuGet packages, not
      project code"` — one string mixing the real path with explanatory
      commentary. Passed through unmodified as a match fragment, the
      generated `protect-generated-code.mjs`/`restrict-write-paths.mjs`
      hooks' `path.includes(frag)` check would NEVER match a real
      Write-tool path (which never contains the trailing commentary) —
      the guardrail would have silently never fired despite `Completed`
      status and real-looking file content, the same "looks right, does
      nothing" failure shape as Phase 3's earlier bugs. Fixed by adding
      `cleanPathFragment()` (`stages/guardrails.ts`) — strips the
      trailing `" (...)"`/`" — ..."` commentary before using the
      fragment as a match target.
- [x] 3.4 Re-verified after the fix: reset only `guardrails`, re-ran.
      Confirmed the cleaned `PROTECTED_GLOBS` are bare paths. Then
      actually **exercised** all 4 hook scripts directly with real
      `PreToolUse`-shaped stdin JSON (not just inspected their source) —
      each one genuinely blocks (exit 2, clear stderr message) the case
      it should and passes (exit 0) the case it shouldn't: writing to a
      known-generated file, reading `.env`, and `git push --force` all
      blocked; writing to an unrelated business-logic file and a normal
      `git push` both passed.
- [x] 3.5 Confirmed on disk: `.claude/settings.json` has non-empty,
      profile-correct `permissions.deny` and all 4 `hooks.PreToolUse`
      entries; all 4 `.claude/hooks/*.mjs` files exist and pass
      `node --check`; a real commit (`git log`) exists, authored by the
      real acting user (`you <you@dcc.local>`), not a placeholder.
- [x] 3.6 Regression: stages 1–10's rows were never touched by this
      phase's driver script, and the run still completed end to end
      through them via the pre-existing `Completed` rows — the phase's
      own verification IS the regression proof, not a separate step.
- [x] 3.7 `npm run typecheck` clean after every file, including after
      the 3.3 fix.

**Summary: Phase 4's security-profile catalog, settings adapter, and
guardrail catalog are implemented and verified end to end against the
real Altshuler Trade repository — a correctly repo-appropriate
`RESTRICTED` profile and 4 working, individually-exercised guardrail
hooks were committed as a real `.claude/settings.json` +
`.claude/hooks/*.mjs`. Zero new Claude prompts needed, a first for any
phase. Live testing caught one real bug (free-text discovery output
silently defeating a path-match guardrail) that would otherwise have
shipped a guardrail that looked complete but never actually fired —
caught specifically because verification exercised the hooks with real
input rather than stopping at "the file exists and looks reasonable."
Stages 13–16 (Validation & Delivery including AI Doctor/User Review/
GitHub PR, and Optimization/Skills Evaluation) remain for later phases,
not started without further direction.**

---

# Phase 5 — Validation & Delivery (2026-09-16)

The last 4 stages before a repo is usable, per the user's own spec §34:
**AI Doctor** (§20 Stage 13), **User Review** (§21 Stage 14), **GitHub
Pull Request** (§22 Stage 15), and **AI Ready** (§23 Stage 16). The
first phase to touch a real external system (GitHub), not just DCC's
own DB/filesystem.

## 0. Decisions

- [x] 0.1 No `gh` CLI is installed on this dev machine (confirmed
      directly). Built assuming it as an ambient, already-authenticated
      CLI the deployment provides — same "ambient credentials, no stored
      token" model Phase 1's decision 0.2 already established for
      `pushTask` — with a graceful fallback (push succeeds, PR opened
      manually via a compare URL) rather than a hard failure when it's
      missing.
- [x] 0.2 **Confirmed with the user**: implement `github_pull_request`
      fully, but never execute a real `git push`/`gh pr create` against
      the real Altshuler Trade GitHub remote without asking first —
      verification this pass stopped at composing the PR text in
      isolation, never touching the real remote.
- [x] 0.3 `ai_doctor`'s build/test execution is attempted only for a
      confidently-detected simple case (an npm `build`/`test` script) —
      `not_attempted` otherwise, not a guessed command. Altshuler's
      large multi-project .NET solution has no single safe entrypoint
      DCC can infer.
- [x] 0.4 `user_review`'s "request changes" records the human's note for
      visibility only — no backward re-entry into an earlier stage (the
      state machine has none, and the spec doesn't elaborate the
      mechanics). "Cancel" already has a real escape hatch
      (`cancelRun`, already wired into the UI).
- [x] 0.5 No new `repo.aiReady` DB column — "AI_READY" is derived from
      "this repo's latest onboarding run completed through `ai_ready`,"
      matching every prior phase's preference for stage-result jsonb
      over new schema surface.

## 1. Schema + core (`packages/core/src/repo-onboarding/`)

- [x] 1.1 `onboarding-version.ts` — `ONBOARDING_METHODOLOGY_VERSION`
      constant (spec §27's "Did the repository use onboarding v2 or
      v4?"), distinct from per-prompt versions.
- [x] 1.2 `ai-assist.ts`'s `httpsRepoUrl` exported (was module-private)
      — reused by `github-pull-request.ts` for the compare-URL fallback,
      same helper `pushTask` already relies on internally.
- [x] 1.3 `stages/ai-doctor.ts` — materializes `scoped_rules`' still-
      only-drafted content into real `.claude/rules/*.md` (plain `fs`,
      the same technique Phase 4's `guardrails` proved sidesteps Claude
      Code's `.claude/` protected-path restriction — closing the gap
      Phase 3 deliberately left open for "the spec's own later User
      Review stage"). Runs deterministic existence/parse checks, then
      one Claude review call (`read_only_plan`) reading the final
      artifacts directly off disk. Maps `PASS/WARN/FAIL` to
      `Completed`/`CompletedWithWarnings`/`Failed` (retryable).
- [x] 1.4 `stages/user-review.ts` — `WaitingForUser`, assembles the
      spec's own grouped-by-purpose artifact summary from
      `priorResults`; resume input `{decision: "approve"|
      "request_changes", note?}`.
- [x] 1.5 `stages/github-pull-request.ts` — idempotency check
      (`gh pr list --head`), push (reusing `git()`/`httpsRepoUrl` from
      `ai-assist.ts`, same ambient-credential call `pushTask` makes),
      composes the PR body (`composeBody`, exported for isolated
      verification), `gh pr create` with graceful degradation when `gh`
      is missing or fails.
- [x] 1.6 `stages/ai-ready.ts` — merge detection via plain
      `git merge-base --is-ancestor` (deliberately `gh`-independent,
      more robust than parsing `gh pr view --json state`). Not yet
      merged → `Failed`, retryable — a normal, expected outcome per spec
      §29, not a bug.
- [x] 1.7 `seed-prompts.ts` — exactly one new entry,
      `onboarding.ai_doctor_review` — the phase's only Claude call.
- [x] 1.8 `STAGE_ORDER` gains `"ai_doctor", "user_review",
      "github_pull_request", "ai_ready"`.

## 2. UI — `RepoOnboardingPanel.tsx`

- [x] 2.1 `STAGE_LABELS` gains the 4 new keys.
- [x] 2.2 New `user_review` approval block — grouped artifact list,
      readiness status, "אשר ופתח Pull Request" / "בקש שינויים".
- [x] 2.3 Generic status block enhanced to render `prUrl`/`compareUrl`/
      `readinessDate` as a link when `github_pull_request`/`ai_ready`'s
      result carries them — no dedicated block needed since neither
      stage is `WaitingForUser`.

## 3. Verify end to end — one real bug found and fixed live

- [x] 3.1 Reused the "reset to `Pending` + `advanceRun`" driver pattern
      against the completed Altshuler Trade run, resuming from
      `guardrails` through `ai_doctor` and `user_review`.
- [x] 3.2 **Missed re-seeding the new prompt before the first live run
      (real, found live, trivial):** `ai_doctor` failed immediately with
      "no active prompt for onboarding.ai_doctor_review." Fixed by
      running `seed-prompts.ts` (idempotent — added only the 1 new row,
      left the other 8 already-active prompts untouched), then re-ran
      successfully.
- [x] 3.3 `ai_doctor` genuinely validated real content, not a rubber
      stamp: materialized `.claude/rules/service-bus-webjobs-...md` to
      disk (confirmed), all deterministic checks `PASS` (build/test
      correctly `not_attempted` — no root `package.json` in this .NET
      repo, per decision 0.3), and the Claude review call found real,
      substantive issues — CLAUDE.md and `repository-map.md` both claim
      "92 projects" (actually every `Project(...)` entry in the .sln,
      including 22 non-buildable solution-folder pseudo-entries — the
      real buildable count is ~70), and a "12 projects" claim under
      `Shared/Framework/` where only 11 actually exist. Correctly
      resulted in `overall_status: WARN` → stage status
      `CompletedWithWarnings`, not a false `PASS`.
- [x] 3.4 `user_review` correctly assembled the grouped summary from
      5 different prior stages' results; approved cleanly, advanced to
      `github_pull_request`.
- [x] 3.5 **Stopped deliberately before `github_pull_request`** (decision
      0.2) — the run sits paused there (`status: Running`,
      `currentStageKey: github_pull_request`), a valid resumable state,
      not a bug. Verified only the composable, network-free part: temporarily
      exported `composeBody` and called it directly with this run's real
      `priorResults` (no `git`/`gh` invoked at all) — confirmed a correct,
      well-formed PR body (found and fixed one cosmetic bug: the
      `.claude/settings.json` line was missing its list-bullet prefix).
      `findExistingPr`/`ai-ready.ts`'s merge check were verified by code
      review only, not live execution — both need a real `gh`/PR/merge
      to exercise meaningfully, none of which exist yet for this run.
- [x] 3.6 Regression: stages 1–11's rows were untouched.
- [x] 3.7 `npm run typecheck` clean after every file, including the
      cosmetic fix.

**Summary: Phase 5's 4 validation-and-delivery stages are implemented.
`ai_doctor` and `user_review` are verified end to end against the real
Altshuler Trade repository — the AI Doctor call proved itself a genuine
check, not a formality, by catching real inaccuracies in earlier-phase-
generated docs. `github_pull_request` and `ai_ready` are implemented and
verified as far as is safe without external side effects: composition
logic tested with real data, the actual `git push`/`gh pr create`/merge-
detection paths verified by code review and left for the user to
trigger explicitly when ready, per their own explicit instruction not to
touch the real GitHub remote unprompted. This is the last phase before
GitHub Pull Request execution becomes a live, user-triggered action —
Phase 6 (Optimization: Skills Evaluation, Incremental Refresh, Token/
cost telemetry, Rediscovery metrics) remains, not started without
further direction.**

---

# Phase 6 — Optimization (2026-09-16)

The last of 6 phases: **Skills Evaluation** (spec §18 Stage 11),
**Incremental Refresh** (§24), **Token/cost telemetry**, and
**Rediscovery metrics**. Unlike every prior phase, the spec gives the
last two items no dedicated section — bullet points in the
Implementation Order only, no field list or example JSON. Scoped
accordingly: build what's actually specified, keep the under-specified
two small and honestly labeled.

## 0. Decisions

- [x] 0.1 `skills_evaluation` lands as `STAGE_ORDER`'s new last entry
      (after `ai_ready`), not inserted at its spec-numbered position
      before `guardrails` — continues the same append-by-rollout-order
      precedent every earlier phase already established.
- [x] 0.2 Skills are drafted as DATA, never written to disk this pass —
      by the time this stage runs, the onboarding branch is already
      reviewed/pushed/merged; materializing here would need its own
      separate commit+push+PR cycle, disproportionate for the spec's
      most-optional, rarely-generated artifact.
- [x] 0.3 Incremental Refresh is a new exported function
      (`checkRepositoryRefresh`), not a `STAGE_ORDER` stage — analysis-
      only, persists its result as a `repo_ai_event`
      (`onboarding.refresh_checked`), writes/commits/pushes nothing.
      Actually regenerating flagged artifacts is real follow-on work.
- [x] 0.4 Rediscovery metrics is a query function
      (`repositoryRefreshMetrics`) over those same events — no new
      table. Token/cost telemetry is one aggregation function
      (`onboardingRunCostSummary`) over data that already existed on
      `repository_onboarding_claude_execution` — both debug-route-only
      maturity, no dedicated screen.

## 1. Schema + core (`packages/core/src/repo-onboarding/`)

- [x] 1.1 `stages/skills-evaluation.ts` — architecturally a near-exact
      mirror of `scoped-rules.ts`: evaluation call proposes candidates
      (`CREATE`/`DO_NOT_CREATE`), one generation call per approved
      candidate, `extractFencedBlock` (not JSON) for the drafted
      `SKILL.md` body from the start.
- [x] 1.2 Two new prompts: `onboarding.skills_evaluate`,
      `onboarding.skills_generate` (spec §18's own detection-prompt text,
      adapted).
- [x] 1.3 `refresh.ts` — `checkRepositoryRefresh(repoId, userId)`: finds
      the repo's last-analyzed commit from its most recent `Completed`
      run's `ai_ready` result, fetches + resolves current default-branch
      HEAD (reusing `ensureCheckout`/`git` from `ai-assist.ts`, same
      pattern `pushTask` uses), short-circuits to `NO_UPDATE_REQUIRED`
      with zero Claude calls when the commit hasn't moved, otherwise a
      `git diff --name-only` + one Claude call
      (`onboarding.refresh_check`). `repositoryRefreshMetrics(repoId)` —
      a plain query over the persisted events.
- [x] 1.4 `telemetry.ts` — `onboardingRunCostSummary(runId)`, sums
      `costUsd`/`inputTokens`/`outputTokens`/`durationMs` across a run's
      executions.
- [x] 1.5 `STAGE_ORDER` gains `"skills_evaluation"`; barrel imports the
      new stage module.
- [x] 1.6 `state-machine.ts` gains `getLatestOnboardingRun(repoId)` — a
      lightweight "most recent run for this repo" lookup, added when the
      UI replacement (below) needed it for the Repositories list and to
      fix a real bug in the onboarding panel's own run-resolution.

## 2. API + UI

- [x] 2.1 Two new debug-level routes:
      `POST /repos/:id/onboarding/refresh-check`,
      `GET /repos/:id/onboarding/refresh-metrics`; plus
      `GET /repos/:id/onboarding/runs/:runId/cost-summary` and
      `GET /repos/:id/onboarding/latest-run`.
- [x] 2.2 `RepoOnboardingPanel.tsx`: `STAGE_LABELS` gains
      `skills_evaluation`; header shows the real cost/token summary.

## 3. Verify end to end — one significant, session-spanning bug found and fixed live

- [x] 3.1 `onboardingRunCostSummary` confirmed against the real
      Altshuler run's accumulated executions: $4.51 → $5.91 (growing
      across this session), 13+ executions, ~104k+ output tokens — real,
      non-trivial data, not zeros.
- [x] 3.2 `checkRepositoryRefresh` correctly threw the honest, expected
      error ("the repository has not yet completed onboarding") when
      called against the Altshuler run — which is genuinely not
      `Completed` yet (deliberately paused before `github_pull_request`'s
      live push, per Phase 5's own boundary). Confirmed via server logs,
      not treated as a bug to force past.
- [x] 3.3 **`read_only_plan` mapped to Claude Code CLI's real
      interactive `--permission-mode plan` — which expects an
      `ExitPlanMode` tool call that doesn't exist in headless `-p` mode
      (real, found live, session-spanning):** verifying
      `skills_evaluation` in isolation (the full pipeline couldn't reach
      it yet without the still-pending live GitHub push), the
      generation call span to 29 turns and its final text was just
      *"`ExitPlanMode` isn't available... so here is the finished
      analysis directly"* — except that time it didn't actually re-emit
      the analysis, only a claim that it already had, silently defeating
      `extractFencedBlock`. Traced to `ai-assist.ts`'s `runClaudeRaw`:
      the read-only branch passed `--permission-mode plan` — Claude
      Code's real plan-then-approve interactive workflow — while its
      actual safety already came entirely from `--allowed-tools
      "Read,Grep,Glob"` (`--permission-mode` doesn't change which tools
      are callable at all here). This confusion was latent in **every**
      prior phase's `read_only_plan` calls (classification, targeted
      discovery, scoped rules, `ai_doctor` review, ...) — most silently
      self-corrected by working around the missing tool (burning extra
      turns in the process), one finally didn't. Fixed by changing the
      read-only branch's `--permission-mode` from `plan` to
      `acceptEdits` (the same mode already proven safe for the write
      branch — there is nothing to "accept" since Write/Edit aren't in
      the allowed-tools list, but it carries none of `plan` mode's
      `ExitPlanMode` expectation).
- [x] 3.4 Re-verified after the fix: re-ran `skills_evaluation`'s
      evaluation + generation calls against the real Altshuler Trade
      repository. No more `ExitPlanMode` confusion; the generation call
      produced a real, well-formed `SKILL.md` (proper YAML frontmatter,
      genuine content) on the first attempt. The evaluation call's
      reasoning was independently re-verified and, if anything, more
      rigorous the second time — it discovered live that `ILMergeOrder.txt`
      is never actually filled in anywhere in the repo (only template
      comments), correctly downgrading a candidate CLAUDE.md itself had
      hedged as a real workflow into `DO_NOT_CREATE` based on that
      evidence. 3 of 4 candidates correctly rejected with specific,
      evidence-grounded reasoning both times (one caught an earlier
      session's own assumed pattern was wrong via direct code
      inspection); 1 well-justified `CREATE` for a genuinely repeated,
      error-prone 8-artifact CRM plugin scaffold.
- [x] 3.5 Regression: stages 1–15 untouched; `npm run typecheck` clean
      after every file, including after the `ai-assist.ts` fix (a
      foundational, widely-shared function also used by the old
      `repo-ai/*` flow and `runImplement`/`pushTask`).
- [x] 3.6 **Closed a real gap in 3.2's own verification**: 3.2 only
      exercised `checkRepositoryRefresh`'s error path (no `Completed`
      run exists yet) — its actual success path, persisting a
      `repo_ai_event` and `repositoryRefreshMetrics` correctly
      aggregating it, was never exercised, since the real run can't
      reach `Completed` without the still-pending live GitHub push.
      Verified directly instead: wrote two realistically-shaped
      `onboarding.refresh_checked` events (one `updateRequired: true`,
      one `false`) via the real `appendRepoAiEvent`, confirmed
      `repositoryRefreshMetrics` correctly counted both, split them
      `updateRequiredCount`/`noUpdateCount`, and set `lastCheckedAt` —
      then deleted the synthetic events immediately after so this
      pilot repo's real event history isn't polluted with fake commit
      SHAs.

**Summary: Phase 6 completes all 6 phases of the user's own
Implementation Order. `skills_evaluation`, `checkRepositoryRefresh`,
`repositoryRefreshMetrics`, and `onboardingRunCostSummary` are
implemented and verified against real data. The most valuable outcome
wasn't a Phase 6 feature at all — verifying it surfaced and fixed a
real, session-spanning bug in `ai-assist.ts`'s `runClaudeRaw` that had
been silently degrading (wasted turns) or, in one case, outright
breaking every `read_only_plan` call since Phase 2, root-caused to a
mismatched Claude Code CLI permission mode rather than a prompt-content
issue. Caught specifically because verification kept exercising real
Claude calls with real extraction logic instead of stopping once output
looked plausible.**

---

# UI Front Door Replacement (2026-09-16)

Per explicit user instruction, after Phase 6: the old 3-step
`repository-ai-management` flow's screen was making the new 16-stage
pipeline unreachable as the primary UI — repos still routed to the old
screen (`#/repo/:id` → `RepoAiPanel.tsx`), with the new pipeline only
reachable via a manual forward-link. Instructed to fully delete the old
UI, not just unlink it, then continue Phase 6 without further questions.

## What changed

- [x] `RepoAiPanel.tsx` deleted outright (534 lines) — not left as
      unreachable dead code.
- [x] `App.tsx`: `#/repo/:id` now renders `RepoOnboardingPanel` directly
      (both `#/repo/:id` and `#/repo-onboarding/:id` resolve to the same
      screen); old import removed.
- [x] `api.ts`: the entire `repo-ai/*` client block (9 functions, 7
      types) deleted — confirmed via a full-codebase grep that every one
      was used exclusively by `RepoAiPanel.tsx` or by `Repositories.tsx`
      (updated below), nothing else depended on them.
- [x] Backend `repo-ai/*` module, its DB tables/data, and its API routes
      were deliberately left untouched — the user's instruction was
      scoped to "the UI," and this matches the earlier, already-made
      decision to defer old-*data* cleanup to the future. Nothing
      currently writes to that old state machine for repos onboarded via
      the new pipeline, so its data is inert, not actively wrong.
- [x] `Repositories.tsx` — its own status column independently called
      the old `getRepoAi`/`RepoAiState`; would have shown permanently
      stale "לא מנוהל" (not managed) badges once nothing writes to that
      state machine anymore. Rewritten to call the new
      `getLatestOnboardingRun(repoId)` (a new lightweight backend lookup,
      `state-machine.ts`) and show the real `OnboardingStatus` instead.
- [x] **Real bug found and fixed live, not just typechecked:** with the
      old screen gone, `RepoOnboardingPanel` becomes the sole entry
      point — but it only ever knew about an active run via
      `localStorage`, set by whichever browser session originally
      started it. A fresh browser (confirmed live: a new Browser-pane
      tab) saw "no active run" for Altshuler Trade and would have
      offered to start a **duplicate** onboarding run over one already
      paused mid-flight at `github_pull_request`. Fixed by having the
      panel fall back to `getLatestOnboardingRun` when `localStorage` is
      empty, before ever concluding no run exists.
- [x] Verified live in the browser end to end: `Repositories.tsx` shows
      the real "מתבצע" (Running) status for Altshuler Trade;
      clicking through (`#/repo/:id`) and `ClientDetail.tsx`'s "✦ ניהול
      AI" link both correctly resume the real, already-13-stages-deep
      run (cost summary, step rail, and all) rather than losing track of
      it — not a fresh/duplicate run.
- [x] `npm run typecheck` clean.

**Summary: the old UI is completely gone, not just unlinked — confirmed
by grepping for every symbol it used and either deleting or migrating
each one, not leaving orphaned dead code behind. Live verification (not
just typecheck) caught a real bug the deletion itself exposed: the new
panel's `localStorage`-only run-lookup would have silently lost track of
in-progress runs the moment it became the sole entry point instead of a
same-session-only side path. Fixed and reverified before considering
this done.**
