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

- [x] 2.1 `recordSession()` — normalise a Claude session into a
      `claude.session` event, then refresh the Brief
- [x] 2.2 `recordGitActivity()` / `recordNote()` — normalise into events
- [x] 2.3 Context Brief generator — assembled from structured state
      (gaps, blockers, task counts, recent timeline); `summariseTimeline()`
      is the model seam, no-LLM path ships in Phase 0
- [x] 2.4 `briefFor(workitemId)` — the exact SessionStart stdout payload
- [x] 2.5 `resolveWorkItem()` — from the `WI-nnnn` branch convention
- [x] 2.6 `demo.ts` proves the exit gate end to end

## 3. Claude Code hooks  ·  `hooks/`

- [x] 3.1 `session-start.mjs` — resolve WorkItem from branch, fetch Brief,
      print to stdout; no-op when nothing resolves
- [x] 3.2 `session-end.mjs` — read `transcript_path`, naive summary, POST
- [x] 3.3 `post-tool-use.mjs` — detect git commit/push/branch/PR, POST
- [x] 3.4 `hooks/README.md` — `.dcc.json` + env + `settings.json` snippet,
      both caveats noted
- [ ] 3.5 Dry-run against a real Claude Code session on a scratch repo

## 4. API  ·  `apps/api`

- [x] 4.1 Fastify app, `POST /events` (hook capture), header identity shim
- [x] 4.2 `GET /workitems/:id/timeline` · `/brief` · `/clients/:id/inbox`
      · `GET /resolve`
- [x] 4.3 Admin: `POST /workitems`, `/workitems/:id/ado-link`,
      `/projects/:id/repos`
- [x] 4.4 `smoke.ts` — 8 checks green via fastify.inject

## 5. Web  ·  `apps/web`

- [x] 5.1 Vite + React, RTL, IBM Plex, the mockup's visual tokens inline
      (Radix/Tailwind + a design-system skill come with the real UI phase)
- [x] 5.2 WorkItem timeline screen — chronological, AI-proposed (dashed
      amber, ◇) vs human (solid blue, ◆) distinct, confidence as a meter,
      Context Brief panel showing the SessionStart payload
- [x] 5.3 Unassigned inbox tab (read-only)
- [x] 5.4 Runs end to end: PGlite → Fastify → React, verified in browser
- [x] 5.5 Interactive: verify / dismiss / spin-off a gap, answer a
      blocker — the verify action was clicked in-browser and the
      resulting `gap.verified` event rendered as a human (solid blue)
      entry, distinct from the AI proposal above it
- [x] 5.6 Blockers-routed-to-me tab

## 6. Prove the exit gate

- [x] 6.1 `setupClient()` + `POST /admin/setup-client` — client → project
      → repo link → first WorkItem, one call
- [x] 6.2 `scenario-altshuler.ts` — the pilot's under-baked-requirement
      flow end to end through the API (as the hooks + skills would drive it)
- [ ] 6.3 Run a real Claude Code session against ALTSHULER_TRADE with the
      hooks + skills installed
- [ ] 6.4 Write up what was and wasn't convenient — the pilot signal

## 7. Phase-1 head start (built alongside Phase 0)

- [x] 7.1 Gaps: `proposeGap` / `verifyGap` (+ spin-off), events, brief
- [x] 7.2 Blockers: `raiseBlocker` / `answerBlocker` / `blockersFor`
      queue, events, "Decisions on record" in the brief
- [x] 7.3 `skills/gap-report` + `skills/raise-blocker` (SKILL.md) and the
      `skills/dcc.mjs` CLI they call
- [x] 7.4 `withTenant` made re-entrant (AsyncLocalStorage) — nested
      tenant calls reuse the open transaction
- [ ] 7.5 `task-breakdown` skill wrapping OpenSpec
- [ ] 7.6 Blocker response UI · gap verify UI
