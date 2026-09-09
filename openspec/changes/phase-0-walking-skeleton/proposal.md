# Phase 0 — Walking Skeleton

## Why

The central pain is lost context and no visibility across stages. The
hardest part is early capture, not decomposition. Adoption is the top
risk — the tool has to feel lighter than today's workflow on day one.

Phase 0 proves the core thesis with the smallest real slice: a real
event enters the system (a Claude session, a git push), lands on a
WorkItem timeline, updates a compact Context Brief, and the next Claude
session loads that Brief instead of replaying everything.

It builds the developer wedge first — session / commit / PR capture with
zero manual effort — because without it nobody is in the system to
confirm anything, and email/Slack ingestion (Phase 2) has no audience.

## What Changes

- **NEW** `@dcc/db` — the schema for the five foundational decisions as
  code: `event_log` (append-only, RLS, per-type payload validation),
  tenancy (`client` / `project` / `repo` / links), `workitem` / `gap` /
  `task` / `blocker` / `context_brief`, `users` / `service_connection`.
  Append-only triggers and the RLS-bound `dcc_app` role in `guards.sql`.
- **NEW** `@dcc/core` — `appendEvent()` as the single write path;
  `timeline()` / `unassigned()` reads; the Context Brief generator that
  runs on each new event.
- **NEW** `hooks/` — Claude Code hooks: `SessionStart` injects the
  Context Brief via stdout; `SessionEnd` posts the session summary;
  `PostToolUse` on git posts commit/PR/branch events.
- **NEW** `apps/api` — a thin HTTP surface the hooks post to and the UI
  reads from. Tenant context set per request.
- **NEW** `apps/web` — one read-only screen: a WorkItem timeline,
  chronological, AI-proposed vs human-confirmed visually distinct.
- **NEW** minimal admin: create WorkItem, link to an ADO work item id,
  link a repo to a project.

## Out of scope (later phases)

Automatic email/Slack ingestion · agents doing work · permission tiers
beyond `propose_only` · a codebase index · dependency visualisation ·
the Blocker response UI · model routing execution. The schema has
columns for these so they slot in without migration; the behaviour does
not ship in Phase 0.

## Impact

- Affected specs: `event-log` (new), `tenancy` (new), `session-capture`
  (new).
- Affected code: new `packages/db`, `packages/core`, `apps/api`,
  `apps/web`, `hooks/`.
- Needs a Postgres database (`docker compose up db`, or a Neon/Supabase
  free instance until Docker is available locally).
- No Azure DevOps dependency to start; the ADO link is a stored id in
  Phase 0, live sync is a later slice.

## Exit gate

A WorkItem moves from a raw requirement to a PR with the whole path
recorded, and a fresh Claude session on the second task starts from the
Brief — not from zero.
