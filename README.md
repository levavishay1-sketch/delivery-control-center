# Delivery Control Center

A system that wraps the full lifecycle of AI-assisted software delivery —
from the first raw requirement to the end of development — around Azure
DevOps and Claude Code, without replacing them.

> **Status:** Phase 0 (walking skeleton). The database foundation for the
> five foundational architecture decisions is in place; the app slices
> are next. See [`openspec/changes/phase-0-walking-skeleton/`](openspec/changes/phase-0-walking-skeleton/).

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
packages/db      @dcc/db    schema (the 5 foundational decisions as code),
                            event validation, tenant-scoped connection
packages/core    @dcc/core  appendEvent, timeline reads, Context Brief    (next)
apps/api                    HTTP surface for hooks + UI                   (next)
apps/web                    the WorkItem timeline screen                  (next)
hooks/                      Claude Code hooks: SessionStart / SessionEnd  (next)
                            / PostToolUse(git)
openspec/                   the in-repo spec lifecycle — this repo
                            dogfoods its own methodology
```

## Prerequisites

- Node ≥ 22
- A PostgreSQL database. Either:
  - `docker compose up -d db` (once Docker is installed), or
  - a free [Neon](https://neon.tech) / [Supabase](https://supabase.com)
    database — put its pooled URL in `DATABASE_URL`.

## Getting started

```bash
cp .env.example .env          # then set DATABASE_URL
npm install
npm run db:generate           # drizzle-kit: SQL from the schema
npm run db:migrate            # apply it
npm run db:guards             # append-only triggers + the dcc_app role
```

After `db:guards`, point `DATABASE_URL` at the `dcc_app` role (not the
superuser) for all application use — RLS is ignored for superusers.

## Foundational decisions (do not change without review)

| # | Decision | Where in code |
|---|----------|---------------|
| 01 | Append-only `event_log`; everything reads from it | `packages/db/src/schema/events.ts`, `sql/guards.sql`, `src/events/` |
| 02 | Identity is always a real person | `EventActor` in `src/events/envelope.ts` |
| 03 | `client_id` + Postgres RLS backstop | every tenant table; `src/client.ts` `withTenant()` |
| 04 | `client → project → workitem`; repo may be org-shared | `src/schema/tenancy.ts` |
| 05 | Resolution order `global → client → workitem` | (Phase 1 — permission/policy tables) |

## Methodology

OpenSpec (`/opsx:propose → /opsx:apply → /opsx:archive`) with a Shape-Up
`appetite` field. Changes live in `openspec/changes/`.
