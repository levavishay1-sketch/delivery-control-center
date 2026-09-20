# Design record — repository onboarding v2 (retired 2026-09-19)

This is the only place the retired onboarding pipeline is described. It was
kept at the user's request so we know what was built, what it taught us, and
which ideas may be worth bringing back. None of it exists in the code any
more; git history from before its removal has the full source
(`packages/core/src/repo-onboarding/`, `apps/web/src/screens/RepoOnboardingPanel.tsx`
and `apps/web/src/screens/onboarding/`, migrations `0029`–`0033`).

It was replaced by the four-stage flow in
`openspec/changes/repository-onboarding-native-init/`, where the content
comes from Claude Code's own `/init` in one live session.

## What it was

A nine-stage pipeline (an earlier sixteen-stage version preceded it) that
prepared a repository for Claude Code by calling `claude -p` itself, with
DCC-owned prompts and JSON schemas, and writing the files on the model's
behalf. Four of the stages were human gates.

| # | Stage | Kind | What it did |
|---|---|---|---|
| 1 | `scan` — סריקה וסיווג | mixed | Isolated git worktree + baseline; deterministic repository profile (languages via `scc`, sizes, top-level layout); inventory of existing AI configuration; one no-tool classification call over the scan signals only |
| 2 | `boundaries` — גבולות והרשאות | human gate | Read-deny rules (noise folders + secrets actually present), a security profile (`STANDARD_DEVELOPMENT`, `RESTRICTED`, `READ_ONLY`, `SANDBOX`, `INFRASTRUCTURE`), keep/merge/replace per existing config file, classification correction, notes |
| 3 | `discovery` — Discovery ממוקד | ai | One budgeted read-only call: coverage of existing docs, an evidence-cited operating model, UNKNOWNs, at most 10 questions, and an assessment of every existing AI file (content verdict keep/merge/outdated/conflicting + form verdict `reshape`) |
| 4 | `confirm` — אימות והשלמה אנושית | human gate | Answers to the questions; auto-skipped with none; unanswered = UNKNOWN, never filled in |
| 5 | `plan` — תוכנית Artifacts | mixed, gate | The model proposed prose artifacts with a ten-question justification each; DCC added settings, applicable guardrails and its capture hooks; "not created" listed with reasons; stale existing files had to be acknowledged before approval |
| 6 | `generate` — יצירת Artifacts | mixed | One call returned file contents; DCC wrote them, stamped provenance, materialised the deterministic files, committed on the branch |
| 7 | `validate` — אימות ותקציב הקשר | mixed | Deterministic checks (settings parse, hooks exercised on real files, globs match, referenced paths exist, duplication, context budget) + one AI review + one automatic fix pass |
| 8 | `review` — סקירה ואישור | human gate | Full per-file diff, drop files, request changes with a note (back to `generate`) |
| 9 | `deliver` — מסירה ו-Pull Request | deterministic | Push + PR (`gh` or compare link); `AwaitingExternal` until merged; the merge was "AI Ready" |

Around it:

- **Automation** — presets `step_by_step` / `guided` / `automatic` (with
  explicit consent) / `custom` per stage (run auto/manual, gate auto/human),
  a persisted driver loop, auto-resolved gates logged as such. Kept in the
  new design.
- **Model and effort per stage** from a routing policy
  (`onboarding_*` capabilities, escalation by classified complexity), with
  per-run overrides. Kept in concept (one session now).
- **Artifact ledger** — every file DCC produced with kind, loading class
  (always / on demand / never), justification, consumers, watched paths,
  source of truth, token estimate and content hash.
- **Refresh** — deterministic staleness signals (`manifest_changed`,
  `watched_path_changed`, `artifact_missing`, `artifact_edited_outside_dcc`,
  `claude_md_too_long`, `referenced_path_missing`, `age`), one AI judgement
  only when a signal fired, then a `refresh` run carrying previous decisions.
- **Guardrail hooks** from a reviewed catalog: `protect-secrets`,
  `prevent-dangerous-git`, `protect-generated-code`, `restrict-write-paths`;
  DCC's own session/git capture hooks were installed in the repository too.
- **Prompt library** — `onboarding.v2.*` prompts versioned in the database,
  editable from the Prompts screen, with drift detection against the code.
- **Screen** — nine-card stepper, per-stage findings and gate forms, the
  Claude call behind each stage (model, cost, permissions, prompt), and a
  rail: automation, model and effort, cost, warnings, decision log,
  lifecycle (refresh), previous runs.

## Why it was replaced

Found while dogfooding it on the ALTSHULER_TRADE repository (2026-09-19):

- **Validation could not be passed.** Its AI review read the whole
  repository and always found something; a `FAIL` stopped the run, and the
  one fix pass could not touch files the plan had not approved. Most
  findings had already been known to earlier stages, which only reported
  them ("note for the record") instead of acting.
- **Detection without action.** Discovery flagged existing `docs/ai/*.md`
  as outdated or conflicting, but the plan was only allowed to act on a
  file whose *form* was wrong (`reshape` ≠ `none`), so a correctly shaped
  file with wrong content could not be fixed — and correcting CLAUDE.md
  while leaving the docs it points to created new contradictions.
- **Protected paths drafted by a model.** The guardrail pattern list came
  from model prose (`CrmEntryPoints/**/*.snk` covered 40 of 58 key files;
  an earlier list held free text that matched nothing).
- **Cost of ownership.** Hundreds of lines of DCC prompts and schemas to
  maintain, while Anthropic's own `/init` (`CLAUDE_CODE_NEW_INIT=1`)
  improves on its own.
- **A comparison on the same repository** (same baseline) showed `/init`
  producing a shorter, accurate CLAUDE.md and a skill that checked out
  against the code in every detail verified, in four minutes and two
  questions — while the pipeline found the live `ClientSecret` in
  `Web.config` that `/init` missed, and its deterministic checks would have
  caught `/init`'s non-matching `.snk` pattern.

## Ideas worth bringing back as stages

The new flow leaves room for stages between the Claude session and
delivery. Candidates, in the order the comparison suggests:

1. **Deterministic checks on what was written** — settings parse, hooks
   actually block the files they claim to (tested against real files of
   each protected type), referenced paths exist, no Cursor-only
   frontmatter (`globs:`/`alwaysApply:`) in rules, always-loaded context
   stays small. Fail only on what this run wrote; everything else is a
   warning for the review.
2. **Secret scan** — report live secrets in config files (DCC names the
   file, never the value) and suggest a read-deny rule for pure key files.
3. **Permissions** — a security profile turned into `settings.json`
   permissions, merged without removing the team's rules.
4. **Capture hooks** — DCC's session/git hooks so every later Claude
   session in the repository lands on the timeline.
5. **Refresh signals** — the deterministic staleness signals above, to
   decide when a repository needs another session.

Lessons that apply whatever comes back: a stage that detects a problem
must either act on it or hand it to a person explicitly; validation should
block only on what the run itself produced; a guardrail's coverage is a
measurement, not a model's claim.
