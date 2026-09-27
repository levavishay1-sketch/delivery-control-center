| # | rule | severity | violations | distinct `from` files | examples (up to 5) |
|---|---|---|---|---|---|
| 1 | no-circular | error | 14 | 7 | `apps/web/src/components/FileCompare.tsx → apps/web/src/claude/Info.tsx → apps/web/src/api.ts`<br>`packages/core/src/tasks.ts → packages/core/src/ai-assist.ts`<br>`packages/core/src/chat/proposals.ts → packages/core/src/chat/index.ts`<br>`packages/core/src/screens/index.ts → packages/core/src/chat/index.ts`<br>`packages/core/src/glossary/index.ts → packages/core/src/glossary/concepts/index.ts → packages/core/src/glossary/concepts/admin.ts` |
| 2 | api-bypasses-core | error | 7 | 4 | `apps/api/src/context.ts → packages/db/src/index.ts`<br>`apps/api/src/context.ts → packages/db/src/schema/index.ts`<br>`apps/api/src/scenario-altshuler.ts → packages/db/src/index.ts`<br>`apps/api/src/server.ts → packages/db/src/index.ts`<br>`apps/api/src/server.ts → packages/db/src/schema/index.ts` |
| 3 | mcp-bypasses-core | error | 2 | 1 | `apps/mcp/src/server.ts → packages/db/src/index.ts`<br>`apps/mcp/src/server.ts → packages/db/src/schema/index.ts` |
| 4 | chat-reaches-onboarding | error | 3 | 2 | `packages/core/src/chat/index.ts → packages/core/src/repo-onboarding/runs.ts`<br>`packages/core/src/chat/proposals.ts → packages/core/src/repo-onboarding/change-diff.ts`<br>`packages/core/src/chat/proposals.ts → packages/core/src/repo-onboarding/changes.ts` |
| 5 | insights-reaches-chat | error | 1 | 1 | `packages/core/src/insights.ts → packages/core/src/chat/index.ts` |
| 6 | core-reaches-db-directly | info | 86 | 44 | `packages/core/src/actions/index.ts → packages/db/src/index.ts`<br>`packages/core/src/actions/index.ts → packages/db/src/schema/index.ts`<br>`packages/core/src/admin.ts → packages/db/src/index.ts`<br>`packages/core/src/admin.ts → packages/db/src/schema/index.ts`<br>`packages/core/src/ado-pull.ts → packages/db/src/index.ts` |
| 7 | no-orphans | info | 0 | 0 | — |

### All 14 cycles

- `apps/web/src/components/FileCompare.tsx → apps/web/src/claude/Info.tsx → apps/web/src/api.ts`
- `packages/core/src/tasks.ts → packages/core/src/ai-assist.ts`
- `packages/core/src/chat/proposals.ts → packages/core/src/chat/index.ts`
- `packages/core/src/screens/index.ts → packages/core/src/chat/index.ts`
- `packages/core/src/glossary/index.ts → packages/core/src/glossary/concepts/index.ts → packages/core/src/glossary/concepts/admin.ts`
- `packages/core/src/glossary/index.ts → packages/core/src/glossary/concepts/index.ts → packages/core/src/glossary/concepts/claude.ts`
- `packages/core/src/glossary/index.ts → packages/core/src/glossary/concepts/index.ts → packages/core/src/glossary/concepts/code.ts`
- `packages/core/src/glossary/concepts/onboarding.ts → packages/core/src/glossary/index.ts → packages/core/src/glossary/concepts/index.ts`
- `packages/core/src/glossary/concepts/overview.ts → packages/core/src/glossary/index.ts → packages/core/src/glossary/concepts/index.ts`
- `packages/core/src/glossary/concepts/pages.ts → packages/core/src/glossary/index.ts → packages/core/src/glossary/concepts/index.ts`
- `packages/core/src/glossary/concepts/pull-request.ts → packages/core/src/glossary/index.ts → packages/core/src/glossary/concepts/index.ts`
- `packages/core/src/glossary/concepts/requirement.ts → packages/core/src/glossary/index.ts → packages/core/src/glossary/concepts/index.ts`
- `packages/core/src/glossary/concepts/task.ts → packages/core/src/glossary/index.ts → packages/core/src/glossary/concepts/index.ts`
- `packages/core/src/glossary/index.ts → packages/core/src/glossary/concepts/index.ts`

### core-reaches-db-directly — the 44 files

`actions/index.ts`, `admin.ts`, `ado-pull.ts`, `ado-sync.ts`, `ai-assist.ts`, `blockers.ts`, `brief/generate.ts`, `brief/read.ts`, `bugs.ts`, `capture.ts`, `chat/gaps.ts`, `chat/index.ts`, `chat/proposals.ts`, `chat/retention.ts`, `claude-center.ts`, `clients.ts`, `code-map.ts`, `contention.ts`, `crud.ts`, `dashboard.ts`, `decisions.ts`, `flow.ts`, `gaps.ts`, `import-ado.ts`, `insights.ts`, `manual-work.ts`, `policy-admin.ts`, `prompts.ts`, `pull-request-conflict.ts`, `pull-request-detail.ts`, `pull-request-review.ts`, `pull-requests.ts`, `repo-branches.ts`, `repo-onboarding/events.ts`, `repo-onboarding/runs.ts`, `research-work.ts`, `resolve.ts`, `spec-map.ts`, `start-build.ts`, `task-ado-sync.ts`, `task-branch-repair.ts`, `task-files.ts`, `task-merge.ts`, `tasks.ts`

Core modules in scope (excluding tests / prove / run / demo / prove-kit / .mjs): 89; importing @dcc/db directly: 44 (49%).
