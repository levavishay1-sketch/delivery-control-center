## Context

See proposal.md - Why / Roadmap Source for motivation and sourcing.

Relevant existing shape, verified in code:
- `config/workflow.yaml`'s TASKS stage: `requiresApproval: true, approverRoles: [TECH_LEAD,
  MANAGER]` — unchanged by this slice.
- ANALYZE's `AnalysisFinding` (`schema.prisma:676`) is the exact precedent this slice mirrors: a
  structured, Zod-validated side-channel written alongside a stage's prose `content`, parsed via a
  `<!-- MARKER -->` + JSON block in both `claudeExecutor.ts` (`parseAnalysisFindings`) and
  `mockExecutor.ts`, and persisted by `completeStageDraft` (`src/domain/pipeline/commands.ts`)
  with a delete-then-recreate on redraft.
- `approveStage` (`pipeline/commands.ts:486`) moves a `PENDING_APPROVAL` stage straight to `DONE`
  (not the unused `APPROVED` enum value) once an `Approval` row is created. Since TASKS always
  requires approval, a TASKS `Stage.status === "DONE"` is only reachable through that gate — no
  separate "is this approved" check is needed beyond the status field itself.
- `createWorkItem` (`work-item/commands.ts:71`) already validates a supplied `parentId` belongs to
  the same project as `projectId` — reused verbatim; the pipeline's own WorkItem/project supplies
  both.
- The Pipeline Detail page (`src/app/pipelines/[id]/page.tsx`) already renders a stage-type-
  specific panel conditionally (`stageConfig.type === "ANALYZE" && ... <AnalyzeFindingsPanel />`)
  — the same conditional-render pattern is reused for TASKS's new panel.

## Goals / Non-Goals

**Goals:**
- Give an approved TASKS stage's drafted tasks a real path into assignable WorkItems, under
  explicit human selection.
- Reuse every existing mechanism (structured-output validation, approval gate, WorkItem creation)
  verbatim — no new execution, approval, or WorkItem-creation path.

**Non-Goals** (in addition to proposal.md's non-goals list):
- Any change to `requiresApproval`/`approverRoles` for the TASKS stage, or to `approveStage`
  itself. Materialization is a second, later, independent action gated on the stage already being
  `DONE` — it does not participate in the stage's own approval decision.
- Recursive decomposition (a materialized TASK's own TASKS stage/further breakdown). A
  materialized WorkItem is an ordinary WorkItem; if it later needs its own pipeline, that's the
  existing `startPipeline` flow, unrelated to this slice.
- A generic "child approval" or "approve all eligible" UI pattern (§51-52 of the new product
  definition) — this slice's selection UI is a plain multi-select, not a reusable Approval-Matrix
  component.

## Decisions

**1. `TaskDraft` is its own top-level model, not a `Json` column on `Stage`.**
Mirrors `AnalysisFinding` exactly (a separate table keyed by `stageId`) rather than
`RepositoryDiscovery.findings`'s `Json` column, because each draft needs its own identity
(`materializedWorkItemId`) to track materialization per-draft — a `Json` array can't hold a stable
per-item foreign key relationship the same way.

**2. Materialization gates on `Stage.status === "DONE"`, not a new `TaskDraft`-level "approved" flag.**
Verified: `approveStage` already moves a TASKS stage straight to `DONE` via its approval gate (not
the unused `APPROVED` enum value — see Context). Since TASKS always requires approval per
`workflow.yaml`, `DONE` alone is sufficient and unambiguous; adding a redundant approval concept at
the `TaskDraft` level would duplicate state that already exists one level up.

**3. Materialization is per-draft selection, not "approve the stage = auto-create everything."**
The old blueprint's own language ("behind an explicit approval gate") and the new product
definition's Requirement/WorkItem separation both treat "the AI drafted this" and "a human decided
this becomes real tracked work" as distinct decisions — approving the stage's *content* (is this a
reasonable task breakdown?) is not the same decision as *which* of those tasks become real,
assigned WorkItems right now (some may be deferred, merged, or dropped). A human selects which
drafts to materialize, rather than every approved draft becoming a WorkItem automatically.

**4. Materialized WorkItems are always `type: TASK`, `source: "MANUAL"`.**
Mirrors `createWorkItem`'s own manual-creation defaults (`work-item/commands.ts:88-93`) exactly —
a materialized draft is functionally indistinguishable from a WorkItem a human typed in by hand,
consistent with "no new WorkItem-creation path."

## Risks / Trade-offs

- [Risk] A user might expect approving the TASKS stage to automatically create the child
  WorkItems, given how tightly the two actions are related. → Mitigation: the materialize UI
  renders directly inside the same TASKS panel immediately once `DONE`, so the next step is
  visually adjacent, not a separate navigation — same mitigation pattern used for Slice 15's
  Start-SDD-then-Start-Pipeline handoff.
- [Risk] `taskDrafts` schema (title/description only) may prove too thin once richer decomposition
  fields (estimated effort, dependencies) are wanted later. → Mitigation: `TaskDraft` is its own
  model (Decision 1), so adding columns later is a normal additive migration, not a breaking
  reshape.

## Migration Plan

Additive only: new `TaskDraft` model, one migration, no backfill (no prior TASKS-stage structured
data exists to migrate). No existing table or enum altered.
