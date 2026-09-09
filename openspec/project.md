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

TypeScript / Node · PostgreSQL · Drizzle ORM (SQL-first → natural RLS) ·
React + Radix + Tailwind · Claude Agent SDK · OpenSpec for the
in-repo spec lifecycle · Azure Key Vault for secrets.

## Methodology

OpenSpec (`/opsx:propose → /opsx:apply → /opsx:archive`) with delta
markers, plus a Shape-Up `appetite` field we add. This repo dogfoods it
from commit 1.

## Conventions

- npm workspaces. Packages under `packages/*`, apps under `apps/*`.
- `@dcc/*` package names.
- Node ≥ 22, ESM, `.ts` extensions in imports (NodeNext).
- Every tenant-scoped table carries `client_id` and an RLS policy.
- Only `appendEvent()` writes to `event_log`. Never raw INSERT.
