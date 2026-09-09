# Phase 0 — tasks

Appetite: **large** (this is the foundation slice; everything after is
smaller). Order matters — each group unblocks the next.

## 1. Database foundation  ·  `@dcc/db`

- [x] 1.1 Workspace + tooling (npm workspaces, tsconfig, drizzle-kit)
- [x] 1.2 Schema: enums, `users`, `service_connection`
- [x] 1.3 Schema: tenancy — `client`, `project`, `repo`, `client_repo`,
      `project_repo`, `repo_dependency`
- [x] 1.4 Schema: `workitem`, `workitem_repo`, `gap`, `task`,
      `task_dependency`, `blocker`, `context_brief`
- [x] 1.5 Schema: `event_log` — append-only shape, `(client_id, id)` PK,
      indexes incl. partial "unassigned"
- [x] 1.6 `guards.sql` — append-only triggers, `dcc_app` role, future-date check
- [x] 1.7 `withTenant()` / `withoutTenant()` connection helpers
- [x] 1.8 Event validation — envelope + per-type payload registry (Zod)
- [x] 1.9 `appendEvent()` single write path; `timeline()` / `unassigned()` reads
- [x] 1.10 `npm install`, generate migration `0000_init.sql`, apply to a DB
- [x] 1.11 Embedded dev DB (PGlite — no install needed); `dev:setup`
      applies migration + `guards.sql`
- [x] 1.12 `dev:prove` — 9 checks green: RLS blocks cross-tenant read &
      write, append-only rejects UPDATE/DELETE, payload validation rejects
      unknown type & malformed payload, supersedes correction works
- [ ] 1.13 Same proof against a real Postgres (Neon) once a URL is available
- [ ] 1.14 Move to `drizzle-kit migrate` + `npm run guards` for real DBs

## 2. Core  ·  `@dcc/core`

- [ ] 2.1 `recordSession()` — normalise a Claude session into a
      `claude.session` event
- [ ] 2.2 `recordGitActivity()` — normalise commits/PR/branch into `git.activity`
- [ ] 2.3 Context Brief generator — regenerate a WorkItem's brief on each
      new event; model chosen by policy (stub: fixed cheap model)
- [ ] 2.4 `briefFor(workitemId)` — the text a SessionStart hook injects

## 3. Claude Code hooks  ·  `hooks/`

- [ ] 3.1 `session-start` — resolve WorkItem from cwd/branch, fetch Brief,
      print to stdout
- [ ] 3.2 `session-end` — read `transcript_path`, summarise, POST to API
- [ ] 3.3 `post-tool-use` (git) — detect commit/push/PR, POST to API
- [ ] 3.4 `settings.json` snippet + install doc; note the two caveats
      (SessionEnd can't block; config snapshot at startup)

## 4. API  ·  `apps/api`

- [ ] 4.1 Fastify app, `POST /events` (from hooks), tenant middleware
- [ ] 4.2 `GET /workitems/:id/timeline`, `GET /inbox`
- [ ] 4.3 Admin: `POST /workitems`, `POST /workitems/:id/ado-link`,
      `POST /projects/:id/repos`

## 5. Web  ·  `apps/web`

- [ ] 5.1 Vite + React + Radix + Tailwind; the DCC design-system tokens
      (skill-creator) as the base
- [ ] 5.2 WorkItem timeline screen — chronological, AI-proposed vs
      human-confirmed distinct, confidence as a meter
- [ ] 5.3 Unassigned inbox list (read-only in Phase 0)

## 6. Prove the exit gate

- [ ] 6.1 Seed one client/project/repo/workitem
- [ ] 6.2 Run a real Claude Code session against a scratch repo with the
      hooks installed; confirm the session + commits land on the timeline
- [ ] 6.3 Start a second session; confirm SessionStart injects the Brief
- [ ] 6.4 Write up what was and wasn't convenient — the pilot signal
