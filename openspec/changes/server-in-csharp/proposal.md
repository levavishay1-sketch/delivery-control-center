# The server in C# — ASP.NET Core Web API

Status: **in progress** — see `tasks.md`.

Appetite: **large**.

## Goal

The whole server side of DCC runs as one C# (.NET 10) ASP.NET Core Web API
under `Server/`, which the web client talks to exactly as before (same routes,
same JSON), and which the team can read, extend and debug in the language it
knows best.

## What this change does

- **One solution, `Server/DeliveryControlCenter.sln`**, opened in Visual
  Studio: `Dcc.Api` (controllers, authentication, WebSockets), `Dcc.Application`
  (contracts), `Dcc.Domain` (entities, the permission catalog, the event
  actor and payload schemas), `Dcc.Infrastructure` (EF Core + Npgsql, the
  migrator, Git / Claude CLI / PTY, Microsoft Graph, Azure DevOps), and
  `tests/Dcc.Tests` (xUnit).
- **The repository splits into three**: `Server/` (the C# server),
  `Client/` (the React web client, unchanged apart from sign-in), and
  `OldServer/` (the TypeScript server, out of the build, kept only as the
  reference being rewritten — deleted at the end).
- **A real Postgres everywhere.** The embedded PGlite is a Node library with
  no .NET driver, so local development runs on a Postgres installed on the
  machine. `dotnet run -- db-bootstrap` creates the two roles (`dcc_owner`,
  `dcc_app`) and the database once; every start applies the numbered SQL
  migrations (the existing 0000–0055 and onward) and `guards.sql`.
- **The five foundational decisions carry over unchanged**: the event log is
  written only through `IEventLogWriter` (validation wrapped around whichever
  store is chosen, in one place — `AddEventLog()`); the tenant wall is
  `TenantScope` (`SET LOCAL ROLE dcc_app` + `app.current_client`, RLS
  enforced by the database); identity, the N×X model and the resolution
  order are as before.
- **The contract is the old server's.** Every endpoint keeps its route and
  JSON shape (`OldServer/apps/api/src/server.ts`, `Client/src/api.ts`), so
  the client changes only in how it authenticates.
- **One cut-over.** Development happens on `project/eyas`; screens whose
  endpoints are not yet rewritten show an error until their turn.

## Out of scope

- Rate limiting, caching and further hardening (a later change).
- Rewriting the hooks and `skills/dcc.mjs` — they are clients of the API that
  run in a client's repository; they only switch to API tokens.

## Decided with the user (2026-09-28)

Rewrite everything in C# (not a separate identity service, not a gradual
strangler); Postgres installed on Windows; no Swagger — requests live in
`Dcc.Api.http`; users and permissions are the first feature built on it
(`openspec/changes/users-and-permissions`).
