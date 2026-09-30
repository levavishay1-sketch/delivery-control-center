# The server in C# — tasks

Appetite: **large**. Branch: `project/eyas` — commits land on it directly,
one PR to `master` at the end, when the user asks.

## 1. Layout

- [x] 1.1 `apps/web` → `Client/`; `apps/api`, `apps/mcp`, `packages/core`, `packages/db` → `OldServer/`, out of the npm workspaces and the TypeScript build
- [x] 1.2 Scripts (`audit-stale`, `info-drift`, `info-lint`), the info-hint hook and the `info-hints` skill point at the new paths; `.gitignore` covers `Server/.local`, `bin/`, `obj/`

## 2. Foundation

- [x] 2.1 PostgreSQL 17 installed; `db-bootstrap` creates `dcc_owner` / `dcc_app` and the `dcc` database; secrets in `Server/.local` (outside git)
- [x] 2.2 Solution and projects; shared `Directory.Build.props`; latest stable packages from NuGet (checked 2026-09-28)
- [x] 2.3 Migrator: the numbered SQL files applied once each, split on the statement marker as the old server did, then `guards.sql` every start (a general-purpose runner was dropped: it substitutes `$tag$`, which ten migrations use as dollar-quoting)
- [x] 2.4 `TenantScope` — the RLS wall
- [x] 2.5 Event log behind `IEventLogWriter` / `IEventLogReader`; validation (`EventPayloads`, the decision-02 rule) as its own layer; the store chosen in `AddEventLog()` only
- [x] 2.6 Error shape `{ error, message }`; audit log behind `IAuditLog`
- [x] 2.7 The old `dev:prove` checks as xUnit tests against a fresh `dcc_test` database

## 3. Users and permissions

- [x] 3.1 See `openspec/changes/users-and-permissions/tasks.md`

## 4. The rest of the server, in dependency order

- [x] 4.1 Clients, repositories, settings, service connections, prompt library, model policy, glossary
  - Routes and JSON as the old server: `/health`, `/clients` (list filtered by clients.read), `/clients/:id`, PATCH/DELETE, `/admin/setup-client`, `/clients/:id/claude-retention`, `/repos`, PATCH/DELETE `/repos/:id`, `/clients/:id/repos`, `/connections`, `/connections/ado/projects`, `/clients/:id/connections/ado` (+ PATCH, check, DELETE), `/prompts`, PATCH `/prompts/:id`, `/claude/policy`, `/claude/glossary` (open without signing in, so the login screen has its "i"), `/claude/glossary/:screen`, `/dev/workitems`; `GET /users` answers `{ users }` for the owner pickers
  - `SqlJson`: SQL rows as the JSON node-postgres produced (numeric/bigint as strings, ISO timestamps) — the tool for every endpoint still to come
  - Azure DevOps HTTP with the api-version walk and a 20-second timeout; the policy file written back in its own layout (a test proves byte-for-byte); the prompt contract checked on save
  - The glossary moved from TypeScript to `Server/glossary/concepts/*.json` + `screens.json`; the server (`GlossaryService`) and the scripts (`scripts/glossary.mjs`: audit-stale, info-drift) read it there. Swept: the scripts, the info-hint hook, the `info-hints` skill, `CLAUDE.md`, `openspec/changes/{info-hints,claude-in-dcc}`, `docs/wishlist.md`, `Client/src/api.ts`. Kept on purpose: `docs/research/**` and the `docs/fable-brief-*` notes (they describe the code as it was when written), and three files under `OldServer/` that still import the deleted TypeScript glossary (`core/src/index.ts`, `chat/index.ts`, `insights.ts`) — reference only, never built, deleted with `OldServer/` (5.2)
  - The identity audit moved to `/identity-audit`: `/audit` is the activity log's route (4.8)
  - Errors are `{ error: code, message }`; the client's `errText` shows the message
- [ ] 4.2 Requirements, timeline, context brief, gaps, blockers, decisions, attachments, spec
  - Done: `POST /workitems`, `GET/PATCH/DELETE /workitems/:id`, `/workitems/:id/timeline`, `/brief` (assembled, never summarised), `/requirements/:id/flow`, `/workitems/:id/spec` (the document read out of the attachment — a .docx through OpenXml, text otherwise), `/clients/:clientId/inbox`, `/list/workitems`, `/list/initiatives`, assign, ado-link, requirement repositories, dependencies, gaps (propose, verify — resolved/dismissed/spun off —, edit, delete), blockers (raise, answer, edit, delete, "waiting on me"), attachments (stored, text extracted from txt/md/docx/pdf, uploaded to Azure DevOps when connected, handed back); decisions recorded on reopen; the ledger writer (`ClaudeLedger`) and `TableColumns` (whole rows in the old camelCase shape)
  - Still open here: `POST /events` — the capture endpoint the hooks and the "add note" form use (sessions, git activity, notes)
  - Belongs to later tasks: `/workitems/:id/start`, task flow, bug links, research, flow runs (4.3); materialize and ADO sync (4.4); assess, breakdown, spec map, cost and calls (4.5); touches and review (4.6)
- [ ] 4.3 Tasks, flow, the checks pipeline, manual work, built-on, start-build, task ADO sync
- [ ] 4.4 Azure DevOps: http, pull, sync, import
- [ ] 4.5 Claude: ai-assist (`claude.exe`), chat, the Claude centre, insights, retention, routing
- [ ] 4.6 Pull request centre
- [ ] 4.7 Repository onboarding: PTY (`Porta.Pty`) over an authenticated WebSocket, branches, code map, local folder
- [ ] 4.8 Dashboard, alerts, budgets, activity log
- [ ] 4.9 MCP server in C#; demo data; the remaining `prove:*` scripts as tests

## 5. Finish

- [ ] 5.1 Hooks and `skills/dcc.mjs` authenticate with API tokens
- [ ] 5.2 `OldServer/` deleted; the old names swept ("Replacing a design"), added to the retired list in `scripts/audit-stale.mjs`
- [ ] 5.3 `CLAUDE.md`, `README.md`, `RUNNING.md`, `openspec/project.md` describe only the C# server
