## Roadmap Source

Implements old blueprint **Slice 18** (`docs/ROADMAP.md`, "Slices 11–21 — Product Vision & Flow
Blueprint"), which scoped it as: "materializes the SDD pipeline's existing `TASKS` stage artifact
into real, individually-assignable child `WorkItem` rows behind an explicit approval gate, for any
Work Item where SDD principles call for decomposition." Per
`docs/roadmap-sources/2026-08-17-core-product-definition-gap-analysis.md` Part 3:

> **18** — `task-decomposition-approval` ... §26-27 (SDD → Authoritative Work → Structured
> Platform Representation → Visual Work Graph) — strong match ... **Still roughly accurate**, but
> should decompose from a Requirement's SDD output once Requirement exists (Decision 3), not only
> from a WorkItem's own pipeline.

Requirement now exists (Slice 15, archived 2026-08-18): its "Start SDD" action creates a root
WorkItem + Pipeline, which flows through the standard SDD pipeline exactly like any other
WorkItem's pipeline. This slice is the natural next link in that chain — the TASKS stage already
exists and is already approval-gated, but today produces only unstructured prose with no way to
turn it into real, assignable work.

## Why

A TASKS stage's output today is free-form Markdown (`config/prompts/tasks.md`) with no path from
"the AI drafted a task list" to "real, assignable child WorkItems exist." Without this, the
Requirement → SDD Activation chain built in Slice 15 dead-ends at "a WorkItem with a Pipeline
exists" — completing this gap is what makes that chain useful end to end, not just structurally
present.

## What Changes

- The TASKS stage's AI output gains a structured, Zod-validated `taskDrafts` array alongside its
  existing prose content — the same `<!-- MARKER -->` + schema + validate-before-trust discipline
  already used for ANALYZE's `analysisFindings` (`src/lib/agents/claudeExecutor.ts`,
  `mockExecutor.ts`), reused verbatim, not a new pattern.
- A new `TaskDraft` record per drafted task (title, description), replacing on redraft — same
  discipline as `AnalysisFinding`.
- One explicit "Materialize" domain command: once a TASKS stage has been approved (`status ===
  "DONE"`, only reachable via the stage's existing approval gate), a write-capable user selects
  which drafts become real child `WorkItem`s, created via the existing `createWorkItem` command
  (`parentId` = the pipeline's own WorkItem) — no new WorkItem-creation path, no change to the
  TASKS stage's own approval gate.
- UI: the Pipeline Detail page's TASKS panel shows the draft list with a "Materialize Selected"
  action once approved; a materialized draft links to its created WorkItem instead.

## Capabilities

### New Capabilities
- `task-decomposition`: structured TASKS-stage task drafts and the explicit materialization
  action that turns selected drafts into real child WorkItems.

### Modified Capabilities
(none — extends the existing `sdd-pipeline`/`ai-drafting` execution discipline without changing
any of its existing requirements; the TASKS stage's approval gate itself is unchanged)

## Impact

- `prisma/schema.prisma`: new `TaskDraft` model, new migration.
- `src/lib/agents/types.ts`, `claudeExecutor.ts`, `mockExecutor.ts`: structured TASKS output.
- `src/domain/pipeline/commands.ts`: `completeStageDraft`'s existing TASKS default branch writes
  `TaskDraft` rows when present.
- New `src/domain/task-decomposition/` module (materialize command + queries, tests).
- New `src/app/api/stages/[id]/task-drafts/` routes (list, materialize).
- `src/app/pipelines/[id]/page.tsx`: TASKS panel gains the draft list + materialize UI.
- `config/prompts/tasks.md`: instructions extended with the structured-output marker.
