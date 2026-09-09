# Architecture review — the five foundational decisions

**Reviewer:** acting architect (delegated 2026-09-09)
**Scope:** `packages/db/src/schema/**`, `packages/db/src/client.ts`,
`packages/db/src/events/**`, the OpenSpec specs for `event-log` and
`tenancy`.
**Verdict: APPROVED to build on, with the follow-ups below scheduled.**

None of the follow-ups block Phase 0 or the Altshuler pilot. Two of them
(F-3, F-4) must be closed before a **second** client is onboarded to a
real shared Postgres.

---

## 01 — Append-only event log  ·  APPROVED

Sound. `(client_id, id)` PK leaves partitioning open without a key
change. Dual timestamps with the clock-skew CHECK. Append-only enforced
twice — `appendEvent()` at the app boundary, triggers at the DB — which
is the right defense in depth. Per-type Zod payload registry
(`schema_version` on the row) is the correct discipline against payload
rot.

**Follow-ups**
- **F-1** (low) — a trigger asserting a superseding row shares
  `client_id` and `workitem_id` with its target. Today `supersedes` is an
  unchecked pointer.
- **F-2** (low) — document the `RANGE (client_id)` partition procedure
  for when event volume warrants it; nothing to do until then.

## 02 — Identity is always a person  ·  APPROVED

`EventActor` is a clean discriminated union: `user` / `delegated`
(carries `triggeredBy`) / `system` (transport only). `appendEvent()` now
rejects a `system` actor on reasoning event types
(`gap.proposed`, `tasks.proposed`, `model.routed`, `blocker.raised`).

**Follow-ups**
- **F-5** (med, Phase 1) — when background jobs land, each must resolve
  an owner and run as `{ kind: "delegated", userId: <owner>, ... }`. The
  "orphan agent" guard is a runtime concern, not schema.

## 03 — Multi-tenancy via RLS  ·  APPROVED WITH A DOCUMENTED CARVE-OUT

The wall on tenant **data** is solid: `client_id` + `pgPolicy` on every
tenant table, `dcc_app` created `NOSUPERUSER NOBYPASSRLS`,
transaction-local `SET LOCAL` for the session var, `withTenant()` made
re-entrant via `AsyncLocalStorage` so nested calls reuse the open
transaction. `dev:prove` demonstrates a cross-tenant read **and** write
are both refused.

**Carve-out (reviewed, accepted):** `client`, `users`, `repo`,
`repo_dependency` are **org-global directory tables** — not tenant-scoped
by RLS. The app role can read them. The position: tenant *data* (events,
WorkItems, gaps, tasks, briefs) is walled; the *directory* (which
clients and repos exist) is org-internal metadata, not a secret from the
internal team. This is a deliberate, standard multi-tenant shape.

**Follow-ups**
- **F-3** (must, before client #2 on shared Postgres) — writes to
  `client` / directory tables need an explicit admin path. Today
  `setupClient()` reads/writes `client` outside `withTenant`; on real
  Postgres as `dcc_app` that is fine only because those tables have no
  RLS. Decide: a dedicated `dcc_admin` role for onboarding, or
  `SECURITY DEFINER` functions. Not needed for the single-client pilot.
- **F-4** (must, before client #2) — run `dev:prove` **and** `smoke`
  against a real Postgres with the app connected as `dcc_app` (not
  superuser). PGlite proves the policy logic; it does not prove the
  connect-as-role deployment.

## 04 — client → project → workitem, repo may be org-shared  ·  APPROVED

Hierarchy is right. `repo.client_id` nullable for org-shared, explicit
link tables with `added_by` / `added_at`, cross-repo dependency as its
own table. The denormalised `client_id` on `workitem` / `gap` / `task` /
`blocker` is the correct call for RLS and partition keys.

**Follow-ups**
- ~~**F-6**~~ **DONE** (migration `0002_f6_composite_fks`) — `unique (id,
  client_id)` on `project` and `workitem`; composite FKs
  `workitem (project_id, client_id) → project`,
  `gap|task|blocker (workitem_id, client_id) → workitem`. A child row
  can no longer carry a different `client_id` than its parent.

## 05 — Resolution order  ·  DESIGN APPROVED, implementation pending

`global → client → workitem`, per-key deep-merge, config-as-code for
global/client, DB override at workitem level (logged as an event),
autonomy-increasing overrides need sign-off one level up. The design is
sound; there is no code to review yet (Phase 1).

---

## Cross-cutting notes

- `appendEvent()` as the single write path is a convention backed by
  review + the fact that payload validation only happens there. The DB
  triggers stop UPDATE/DELETE but not a rogue INSERT. Accepted — a rogue
  INSERT still can't skip RLS, and code review covers the rest.
- `links[]` on events carry no referential integrity (some point at
  external systems). Correct for an audit log.
- Migrations are generated and committed. `guards.sql` is separate and
  idempotent. Good.

## Scheduled follow-ups summary

| id | severity | when |
|----|----------|------|
| F-1 supersedes same-scope trigger | low | anytime |
| F-2 partition procedure doc | low | when volume warrants |
| F-3 admin path for directory writes | must | before client #2 |
| F-4 prove against real Postgres as dcc_app | must | before client #2 |
| F-5 background-job owner resolution | med | Phase 1 |
| ~~F-6~~ composite FKs | med | DONE — migration 0002 |
