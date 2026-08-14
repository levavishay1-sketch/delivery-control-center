## Why

The Delivery Control Center's v1 was built directly (scaffold, schema, pipeline
engine, UI) before OpenSpec was introduced into this repo, so `openspec/specs/`
is empty even though the system is implemented and verified end-to-end. This
change documents the as-built v1 as the initial specs, so it becomes the
baseline every future change diffs against instead of starting from nothing.
No code changes; this proposal, its specs, and its tasks describe what
already exists and is running.

## What Changes

- Record the four capabilities that make up v1 as new main specs, matching
  what's implemented in `src/lib/` and `src/app/` today.
- No behavior changes. Tasks in this change are verification checklist items
  against the existing implementation, not new implementation work.

## Capabilities

### New Capabilities
- `sdd-pipeline`: the Constitution -> SPEC -> Plan -> Tasks -> Deploy stage
  engine — config-driven stage order/gates (`config/workflow.yaml`), and the
  draft -> submit for approval -> approve/reject -> advance transitions
  (`src/lib/pipeline.ts`).
- `audit-trail`: append-only log of every pipeline decision (draft, approval,
  rejection, advance, sync), written atomically with the state change it
  describes (`src/lib/audit.ts`).
- `work-item-sync`: pulling work items from an external system (Jira) or
  entering them manually, each starting its own pipeline
  (`src/lib/integrations/`).
- `ai-drafting`: an AI executor drafts each stage's content from the
  project's prompt templates; v1 ships a mock executor behind a real
  interface so a live model can be swapped in later without touching callers
  (`src/lib/agents/`).

### Modified Capabilities
(none — specs/ is currently empty)

## Impact

Documentation only: creates `openspec/specs/{sdd-pipeline,audit-trail,work-item-sync,ai-drafting}/spec.md`.
No source files change.
