# Delivery Control Center

@openspec/project.md

## Working in this repo

- npm workspaces: packages under `packages/*`, apps under `apps/*`, `@dcc/*` names.
- Node ≥ 22, ESM, `.ts` extensions in imports (NodeNext).
- **Run TypeScript directly with `tsx`, never raw `node`.** Any script that
  imports across workspace packages (`@dcc/core` → `@dcc/db`, etc.) resolves
  through a `node_modules/@dcc/*` symlink, and Node's native type-stripping
  refuses to strip types for anything under `node_modules` — raw `node
  src/whatever.ts` fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`
  the moment it crosses a package boundary. `tsx` doesn't have that
  restriction. All `dev`/`start`/`demo`/`smoke` scripts already use it —
  keep new ones consistent.
- No local Postgres needed: `@dcc/db` falls back to embedded PGlite
  (`packages/db/.pgdata`) unless `DATABASE_URL` is set. **PGlite is not safe
  for two processes to hold the same `.pgdata` open at once** — if the API
  server is already running, stop it (or restart it right after) before
  running `dev:migrate`/`dev:setup` in a separate shell, or the running
  server keeps querying against its stale, pre-migration schema and every
  query touching the new column 500s until it's restarted. This is worse
  than staleness with `npm run -w @dcc/api dev` (`tsx watch`): editing a
  source file while a migration/script is mid-write races `tsx watch`'s
  own kill-and-respawn against that write and can leave `.pgdata` genuinely
  corrupted — confirmed live (2026-09-16): the DB stopped starting
  entirely (`RuntimeError: Aborted()` inside Postgres's own WASM
  crash-recovery), reproduced identically via `dev:migrate` itself, with
  no fix short of `dev:reset` (no `pg_resetwal`/`pg_waldump` ships with
  PGlite's embedded build). **Prefer `npm run -w @dcc/api start` (plain
  `tsx`, no watch) whenever a migration or one-off script might run
  concurrently**, and always stop the API process before `dev:migrate`/
  `dev:setup`/`dev:reset` rather than relying on watch-mode to restart
  around it.
- Only `appendEvent()` writes to `event_log` — never a raw INSERT.
- Every tenant-scoped table carries `client_id` and an RLS policy.
- Don't change the five foundational decisions (see `openspec/project.md`)
  without going through `docs/architecture-review.md`-style review.

## Commands

```bash
npm run typecheck              # tsc -b, whole repo
npm run db:migrate             # drizzle-kit, real Postgres
npm run db:guards              # append-only triggers + dcc_app role
npm run -w @dcc/db dev:reset   # wipe local PGlite
npm run -w @dcc/db dev:setup   # apply migrations to local PGlite
npm run -w @dcc/db dev:prove   # 9 checks: RLS wall + append-only + validation
npm run -w @dcc/api dev        # API on :3001 (tsx watch)
npm run -w @dcc/web dev        # web UI on :5173 (vite)
```

## This repo dogfoods itself

Hooks (`hooks/`), skills (`skills/`), the `reviewer` subagent
(`.claude/agents/`), and the model-routing policy (`config/model-policy.json`)
are the same mechanisms DCC gives to pilot clients — wired up here too via
`.dcc.json` + `.claude/settings.json`, against an internal "DCC Internal"
client. See `hooks/README.md` for what each hook does and its caveats
(`SessionEnd` can't block termination; hook config is snapshotted at
session start, so edits to `.claude/settings.json` need a fresh session).

## Methodology

OpenSpec (`/opsx:propose → /opsx:apply → /opsx:archive`) with a Shape-Up
`appetite` field. Changes live in `openspec/changes/`.
