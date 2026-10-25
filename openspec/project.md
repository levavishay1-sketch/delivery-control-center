# Delivery Control Center — project context

## What this is

A system that wraps the full lifecycle of AI-assisted software delivery —
from the first raw requirement to the end of development — around the
tools the organisation already uses (Azure DevOps, Claude Code), without
replacing them.

The authoritative design lives in the architecture decision document
(draft 2). This file is the short version OpenSpec and contributors read.

## The reframe that drives everything

There is no "final closed spec". Work is one continuous stream of events
against a WorkItem, not a handoff between a requirements phase and a build
phase. A phone call, an email, a Claude session, a commit, a mid-build
change request — all are the same primitive: an event on a timeline. The
"spec" is the current understanding derived from that timeline, never a
frozen artifact.

## Non-negotiables

- **Azure DevOps is the source of truth** for Work Items. We are an
  orchestration layer that mirrors and enriches — never a competing copy.
- **Claude Code keeps working as it does today.** We detect, record and
  manage what happens around it.
- **The tool must be more convenient than today's workflow** on day one,
  or it will not be adopted.
- **No silent actions.** Every commit, approval, dependency (and why),
  session, status change — including changes made directly in ADO — is
  recorded.
- **Identity is always a real person.** Every AI action runs as a named
  user's Claude identity, even background work.
- **The wall between clients is absolute** and built into the foundation.

## The five foundational decisions

1. **Event log** — one append-only timeline per WorkItem; everything
   reads from it.
2. **Identity** — always a real person behind every AI action.
3. **Multi-tenancy** — `client_id` on every tenant row + Postgres RLS as
   an independent backstop.
4. **N×X model** — client → project → workitem; repo may be org-shared.
5. **Resolution order** — `global → client → workitem`, most specific
   wins, per-key.

## Stack

C# / .NET 10 ASP.NET Core Web API (`Server/`) · PostgreSQL 17 with SQL
migrations (SQL-first → natural RLS; EF Core + Npgsql read and write, never
migrate) · React + Radix + Tailwind (`Client/`) · the Claude Code CLI ·
an MCP server in C# (`Server/src/Dcc.Mcp`) · OpenSpec for the in-repo spec
lifecycle · Azure Key Vault for secrets (later; `Server/.local` on a
developer's machine).

## Methodology

OpenSpec (`/opsx:propose → /opsx:apply → /opsx:archive`) with delta
markers, plus a Shape-Up `appetite` field we add. This repo dogfoods it
from commit 1.

## Conventions

- `Server/DeliveryControlCenter.sln`: `Dcc.Api`, `Dcc.Application`, `Dcc.Domain`,
  `Dcc.Infrastructure`, `Dcc.Mcp`, `tests/Dcc.Tests` (xUnit). The schema is the
  SQL in `Server/db/migrations`; data the server reads lives beside it
  (`Server/glossary`, `Server/onboarding`).
- The web client is the npm workspace `@dcc/web` in `Client/`; the hooks and
  skills are zero-dependency Node scripts (Node ≥ 22).
- Every tenant-scoped table carries `client_id` and an RLS policy, and is
  touched only inside `TenantScope`.
- Only `IEventLogWriter` writes to `event_log`. Never raw INSERT.
- `OldServer/` is the retired TypeScript server, kept as the reference the C#
  server was ported from — never built, never run, never added to.
