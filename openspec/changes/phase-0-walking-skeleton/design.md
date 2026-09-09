# Phase 0 — design notes

## Why the schema ships before the app

Decisions 01 (event log) and 03 (multi-tenancy) are the two that are
genuinely painful to reverse. Writing them as Drizzle schema + `guards.sql`
makes them reviewable as code — the architect reviews the real thing, in
the repo, in parallel with the build. A change at this stage is one
migration, not a rewrite.

## RLS approach

- Policies are declared in the schema with `pgPolicy(...)` and emitted
  into migrations by drizzle-kit.
- The session variable `app.current_client` is set with
  `SET LOCAL ... = ...` inside a transaction (`withTenant`), so it is
  scoped to that transaction and safe under connection pooling.
- `guards.sql` creates `dcc_app` explicitly as `NOSUPERUSER NOBYPASSRLS`.
  The single most important operational rule: **the app never connects as
  a superuser**, because Postgres silently ignores RLS for superusers.
- `client`, `users`, `repo`, `repo_dependency` are not tenant-scoped by
  RLS: `client` is the tenant root, the others are org-global resources.

## Append-only enforcement

Two layers:
1. `appendEvent()` is the only write path and validates payloads.
2. `guards.sql` triggers reject UPDATE/DELETE at the database, so even a
   raw SQL mistake cannot mutate history.

## Payload registry

`payloadSchemas[type][version]`. Adding an event type = adding an entry.
Changing a shape = a new version key; old rows keep validating against
the version they were written with (`event_log.schema_version`).

## Context Brief

Stored one-per-WorkItem in `context_brief`, regenerated incrementally on
each new event. Phase 0 uses a fixed cheap model; the policy-driven model
choice (architecture §6) is a later slice. The Brief is what the
`SessionStart` hook injects — the mechanism, not a skill.

## Open questions carried into Phase 1

- Exact WorkItem ↔ working-directory resolution (branch convention is the
  Phase 0 answer; a `.dcc` marker file may be better).
- Whether `apps/api` is Fastify or Hono — Fastify assumed; revisit if the
  hooks need edge deploy.
- Brief regeneration: synchronous on write vs a queue. Phase 0 does it
  synchronously; move to a queue when event volume shows the latency.
