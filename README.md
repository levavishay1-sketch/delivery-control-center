# Delivery Control Center

A system that wraps the full lifecycle of AI-assisted software delivery —
from the first raw requirement to the end of development — around Azure
DevOps and Claude Code, without replacing them.

> **Status:** the server is being rewritten in C# (ASP.NET Core Web API) under
> `Server/`; users, sign-in and permissions are the first feature on it. See
> [`openspec/changes/server-in-csharp/`](openspec/changes/server-in-csharp/).

## The idea in one paragraph

There is no "final closed spec". Work is one continuous stream of events
against a **WorkItem** — a phone call, an email, a Claude session, a
commit, a mid-build change request are all the same primitive: an event
on an append-only timeline. Everything else (the UI, the audit trail, the
context handed to the next Claude session) is derived from that timeline.
Azure DevOps stays the source of truth for Work Items; we mirror and
enrich.

## Layout

```
Server/        the server — C# (.NET 10) ASP.NET Core Web API, opened in Visual Studio
  DeliveryControlCenter.sln
  src/Dcc.Api             controllers, sign-in, permissions, WebSockets
  src/Dcc.Application     contracts between the layers
  src/Dcc.Domain          entities, the permission catalog, event schemas
  src/Dcc.Infrastructure  Postgres (EF Core + Npgsql), migrator, Entra / Graph
  db/migrations           the SQL migrations — the source of truth for the schema
  tests/Dcc.Tests         xUnit, against a fresh local test database
Client/        the web client (React + Vite)
OldServer/     the retired TypeScript server — reference only, never built,
               deleted once the C# server covers everything
hooks/         Claude Code hooks: SessionStart / SessionEnd / PostToolUse(git)
skills/        the skill library DCC hands to a client's repository
openspec/      the in-repo spec lifecycle — this repo dogfoods its own methodology
```

The server is mid-rewrite from TypeScript to C#
(`openspec/changes/server-in-csharp`). Screens whose endpoints are not yet
rewritten show an error until their turn.

## Prerequisites

- .NET 10 SDK
- PostgreSQL 17 on the machine (`winget install PostgreSQL.PostgreSQL.17`)
- Node ≥ 22, for the web client and the hooks

## Getting started

See [RUNNING.md](RUNNING.md). In short: `db-bootstrap` once, then
`npm run server` and `npm run web`, and sign in with the administrator
whose one-time password is in `Server/.local/initial-admin.txt`.

## Foundational decisions (do not change without review)

| # | Decision | Where in code |
|---|----------|---------------|
| 01 | Append-only `event_log`; everything reads from it | `IEventLogWriter` (Dcc.Domain/Events), `AddEventLog()`, `Server/db/guards.sql` |
| 02 | Identity is always a real person | `EventActor` (Dcc.Domain/Events); delegated agents capped by their owner |
| 03 | `client_id` + Postgres RLS backstop | every tenant table; `TenantScope` (Dcc.Infrastructure/Persistence) |
| 04 | `client → workitem` tree; repo may be org-shared | the SQL migrations |
| 05 | Resolution order `global → client → workitem` | permission scopes (`EffectivePermissions`) |

## Methodology

OpenSpec (`/opsx:propose → /opsx:apply → /opsx:archive`) with a Shape-Up
`appetite` field. Changes live in `openspec/changes/`.
