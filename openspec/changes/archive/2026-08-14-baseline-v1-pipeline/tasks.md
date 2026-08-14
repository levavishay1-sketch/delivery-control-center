## 1. sdd-pipeline verification

- [x] 1.1 Confirm stage sequence and gate rules load from `config/workflow.yaml`, not hardcoded (`src/lib/config.ts`)
- [x] 1.2 Confirm a new pipeline is created at the first configured stage (`createPipeline` in `src/lib/pipeline.ts`)
- [x] 1.3 Confirm drafting only accepts PENDING/REJECTED stages and moves them to PENDING_APPROVAL (`draftStage`)
- [x] 1.4 Confirm approving a non-final stage creates the next stage and advances `currentStage` (`approveStage`)
- [x] 1.5 Confirm approving the final configured stage sets the pipeline to COMPLETED with no further stage created
- [x] 1.6 Confirm rejecting a PENDING_APPROVAL stage sets it REJECTED and the pipeline BLOCKED (`rejectStage`)
- [x] 1.7 Confirm redrafting a REJECTED stage returns it to PENDING_APPROVAL and the pipeline to ACTIVE

## 2. audit-trail verification

- [x] 2.1 Confirm every transition (create, draft, approve, reject, advance, complete, sync) calls `recordAuditEvent` (`src/lib/audit.ts`, `src/lib/pipeline.ts`, sync route)
- [x] 2.2 Confirm audit writes happen inside the same `db.$transaction` as the state change they describe
- [x] 2.3 Confirm the audit trail page renders events newest-first with actor, action, and timestamp (`src/app/audit/page.tsx`)

## 3. work-item-sync verification

- [x] 3.1 Confirm manual work item creation immediately creates a pipeline (`POST /api/work-items`)
- [x] 3.2 Confirm project sync upserts work items by `(projectId, source, externalId)` and only creates a pipeline for items that don't already have one (`POST /api/projects/[id]/sync`)
- [x] 3.3 Confirm the Jira adapter fails with a clear error when required config/env vars are missing, before making any request (`src/lib/integrations/jira.ts`)

## 4. ai-drafting verification

- [x] 4.1 Confirm stage drafting reads the stage type's template from `config/prompts/*.md` rather than an inline string
- [x] 4.2 Confirm each draft records `aiModel`, `promptTokens`, `completionTokens`, and `costUsd` on the Stage
- [x] 4.3 Confirm drafting goes through the `AgentExecutor` interface (`src/lib/agents/types.ts`) and `mockExecutor.ts` is the only implementation wired in for v1

## 5. Close out

- [x] 5.1 Verified end-to-end against a live database: seed data, full 5-stage draft/approve walkthrough to COMPLETED, and the reject/redraft/approve cycle (see prior session's browser + API verification)
- [ ] 5.2 Run `/opsx:archive baseline-v1-pipeline` to merge these delta specs into `openspec/specs/` as the project's source of truth
