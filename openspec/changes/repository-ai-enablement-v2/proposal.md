# Repository AI Enablement v2 — nine stages, justified artifacts, a knowledge lifecycle

Status: **implemented and validated end-to-end (2026-09-18)** — replaces
the 16-stage pipeline of `repository-ai-enablement` and deletes the
`repo-ai` knowledge/catalog module it still depended on. See `tasks.md`
for the per-stage verdicts, the artifact justification table, the
evidence register and the validation record.

Appetite: **large** (user-directed: research → challenge → redesign →
implement → validate, in one pass).

## Why

The 16-stage pipeline worked as a state machine but not as a product or
as a token strategy, and a from-scratch review of Claude Code's real
loading mechanics showed why:

- It paid three AI passes (coverage, discovery, question generation)
  over the same files, then a fourth to write a `docs/ai/*.md`
  "encyclopedia" nothing loaded on demand — more knowledge, not more
  efficiency.
- Every artifact was produced by a stage of its own, so a repository got
  the same shape of output regardless of what it already had; "not
  created" was never a first-class outcome.
- Writes happened inside the model's session. Anything under `.claude/`
  is a protected path Claude Code never auto-approves headless, so
  stages reported success while files were silently not written (the
  v1 Phase 3 failure class).
- Every `claude -p` call executed the client repository's own
  `.claude/settings.json` hooks and `.mcp.json` on the operator's
  machine.
- The screen explained stages after the fact; there was no automation
  model, no diff before the push, no staleness detection worth the name.

## Foundations (evidence, then the decision)

Primary sources (read, not skimmed — code.claude.com docs, Sep 2026):
`CLAUDE.md` loads every session and the docs put "under 200 lines" as
the adherence threshold; block-level HTML comments are stripped before
injection (zero-cost provenance); `@imports` load with it; `.claude/rules/*.md`
with `paths:` load lazily, without `paths:` at launch; skills load only
their description (≤1536 chars) at startup and their body on demand;
`--restricted`, `--strict-mcp-config`, `--tools`, `--permission-prompts
none`, `--json-schema`, `--max-budget-usd`, `--no-session-persistence`
exist from the CLI versions the runner now checks for; `/init` itself is
now "explore → ask → reviewable proposal", the shape this pipeline takes.
Secondary (summaries only — the papers themselves were not reachable
from this environment, treat as UNVERIFIED): context files cut runtime
and output tokens (~−29% / −17%) without improving correctness; agent
README studies show the common content is commands, constraints and
architecture pointers, not inventories.

Decisions that follow: one always-loaded map (CLAUDE.md ≤ 120 lines,
target 40–80), everything else on demand (knowledge skills, path-scoped
rules, nested CLAUDE.md only for real subsystems); zero-context
artifacts for enforcement (settings deny rules, deterministic guardrail
hooks, DCC capture hooks); the model returns content, DCC writes it; the
model never runs Bash, never sees the client's hooks/MCP, and stops at a
budget; the human gates are where irreversibility or cost begins.

## What changed

**Nine stages, four human gates** (`packages/core/src/repo-onboarding/`):
`scan` (isolated worktree + deterministic profile + inventory of what
already exists + one no-tool classification call) → `boundaries` (gate:
read-deny rules, security profile, what to do with existing config,
classification correction) → `discovery` (one read-only budgeted call:
coverage of existing docs, evidence-cited operating model, UNKNOWNs,
≤10 questions) → `confirm` (gate; auto-skips with no questions;
unanswered = UNKNOWN, never filled) → `plan` (AI proposes prose
artifacts with the ten-question justification; DCC adds settings,
applicable guardrails, its hooks; gate: approve/remove items; "not
created" listed with reasons) → `generate` (one call returns content;
DCC writes, stamps provenance, materialises deterministic files,
commits on the onboarding branch) → `validate` (deterministic checks:
settings parse, hooks exercised with sample inputs, globs match real
files, referenced paths exist, CLAUDE.md↔skill duplication, context
budget; then one read-only AI review; one automatic fix loop) →
`review` (gate: full per-file diff, drop files, request changes with a
note → back to generate) → `deliver` (push + PR when a remote exists;
`AwaitingExternal` until a person merges; merge = AI Ready at a commit
and methodology version).

**Automation model** — `step_by_step` / `guided` (default: stages run,
gates wait) / `automatic` (gates resolved from the suggestions, requires
explicit `consent: true`, PR still merged by people) / `custom` per
stage; a persisted driver loop with every transition on the DB; gates
that were auto-resolved are logged as such.

**Knowledge lifecycle** — an artifact ledger (`repository_ai_artifact`:
kind, loading class, justification, consumers, watched paths, source of
truth, token estimate, content hash). Refresh = deterministic signals
first (manifest changed, watched path changed, artifact missing/edited
outside DCC, CLAUDE.md too long, referenced globs match nothing, age),
one AI judgement only when a signal fires, then a `refresh` run that
carries the previous decisions over and focuses discovery on what
changed. Files in the repository are the source of truth; a hash
mismatch is a signal, never an overwrite.

**Screen** — a pre-start page that explains every stage before it runs
(why / what / value / lifecycle stages it supports / output / impact),
the automation chooser with the consent text, and a run page: nine-node
stepper, the stage's real findings, the gate forms, the Claude call
behind each stage (model, cost, permissions, prompt with versioned
edits), and a rail with automation, cost, decision log, open warnings
and UNKNOWNs, and the lifecycle panel.

**Removed** — `packages/core/src/repo-ai/*` (catalog, inventory,
knowledge baseline, bootstrap, resolve) and the `AiComponents` screen;
the assess/breakdown/implement prompts no longer prepend a "repo AI
profile" block (an onboarded repository carries its knowledge in
CLAUDE.md and skills, loaded natively). Their tables stay inert.

## What does not change

Azure DevOps stays the source of truth; Claude Code keeps working as it
does; every action is on the timeline (`repo_ai_event`, via
`appendRepoAiEvent` only); identity is the acting user on every push,
PR and decision; `client_id` + RLS on the new table; the five
foundational decisions are untouched.

## FABLE

UNKNOWN / UNVERIFIED. Nothing named FABLE exists in the code, the git
history, or any spec in this repository; no definition was available to
evaluate. Nothing was built, kept or removed under that name — a
definition is needed before a verdict can be given.
