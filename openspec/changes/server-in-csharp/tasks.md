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

- [ ] 4.1 Clients, repositories, settings, service connections, prompt library, model policy, glossary (the "i" registry as JSON in `Server/glossary`, served anonymously; the audit reads it there)
- [ ] 4.2 Requirements, timeline, context brief, gaps, blockers, decisions, attachments, spec
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
