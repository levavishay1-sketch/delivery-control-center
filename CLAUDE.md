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
  PGlite's embedded build). **The same goes for any one-off script that
  imports `@dcc/db`**, directly or through `@dcc/core`: a probe run with
  `npx tsx` while the API is up is a second process on the same `.pgdata`,
  and that alone is enough to corrupt it — confirmed twice on 2026-09-20,
  both times costing a `dev:reset` + `dev:setup` and re-creating the local
  clients. Stop the API first, or write the probe so it only touches git and
  the filesystem. **Prefer `npm run -w @dcc/api start` (plain
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
npm run audit:stale            # leftovers of replaced designs, stale OpenSpec statuses
```

Repository onboarding (`openspec/changes/repository-onboarding-native-init`)
runs the real, interactive Claude Code (`/init` with `CLAUDE_CODE_NEW_INIT=1`)
in a pseudo-terminal on the DCC machine, through `@lydell/node-pty`'s
prebuilt binary; the screen reaches it over a WebSocket on the same `/api`
proxy. Restarting the API disconnects a live session — the run's screen
reopens the same conversation (`--resume`).

## Git flow — one project branch, task branches under it

`master` is main; it changes only through a reviewed pull request. Work is
grouped into **projects** (an OpenSpec change or a set of them), each with
its own long-lived branch, and every task branches off that project branch:

```
master
 └─ project/<name>            ← created from master
      ├─ task/<name-1>        ← created from the project branch
      └─ task/<name-2>
```

1. A task finishes → push it, open a PR **into the project branch** (the PR's
   base is `project/<name>`, not `master`), merge it there.
2. After **every** merge, update the project branch and check the whole
   thing works together (`npm run typecheck`, `npm run audit:stale`, the
   affected screens) — not only at the end.
3. Keep the project branch current with master (`git pull origin master`
   while on it) so the last PR is not a surprise.
4. When the project holds together, one PR `project/<name>` → `master`. That
   merge is a human action.

Claude commits and pushes on its own only in the case below; otherwise only
when asked. It never pushes to or merges into `master`, and does not create
a project branch on its own.

**A finished task is committed, pushed, and a PR is requested.** When a
task is done, checked (`npm run typecheck`, `npm run audit:stale`, the
affected screens) and Claude stands behind it, Claude does not wait to be
reminded: it commits the work to the task's own branch, pushes that branch,
and asks the user for a pull request — into the project branch (`master`
only for a `fix/` branch, where a human merges) — saying what was checked.
The standing permission covers the commit and the push, and the request is
the question about the PR. If something was not checked or does not hold,
Claude says so and neither commits nor pushes.

### Branch names and what happens to a branch

Name: `<type>/<short-description>` — lowercase English, words joined by
hyphens. The type says who opened it and why:

| prefix | opened by | example |
|---|---|---|
| `project/` | a person, off `master` | `project/pull-requests` |
| `task/` | a person or DCC, off a project branch; keep the work-item key when there is one | `task/WI-1284-file-compare` |
| `fix/` | a person, a small fix straight off `master` | `fix/map-click` |
| `ai/onboarding/<run>` | DCC, one per onboarding run | `ai/onboarding/9c02a09e` |
| `claude/` | a Claude Code desktop session, automatically | — |

A project branch is about one subject: its name, its PR title and its
OpenSpec change should describe the same thing. Work that grows into a
second subject gets its own project branch instead of piling on.

After a merge the branch is deleted (the repository deletes a PR's branch on
merge by itself; the project branch goes when its final PR merges). A branch
that was never merged and has been forgotten either gets a PR or is deleted
after looking at what it holds — never left to accumulate. The "ענפים" tab of
a pull request shows every branch of the repository and says which of these
applies.

## This repo dogfoods itself

Hooks (`hooks/`), skills (`skills/`), the `reviewer` subagent
(`.claude/agents/`), and the model-routing policy (`config/model-policy.json`)
are the same mechanisms DCC gives to pilot clients — wired up here too via
`.dcc.json` + `.claude/settings.json`, against an internal "DCC Internal"
client. See `hooks/README.md` for what each hook does and its caveats
(`SessionEnd` can't block termination; hook config is snapshotted at
session start, so edits to `.claude/settings.json` need a fresh session).

**Two skill directories, don't mix them.** `skills/` at the root is the
library DCC hands to a client's repository — those call `skills/dcc.mjs`
and Claude Code does not load them here. `.claude/skills/` is this
repository's own, loaded by Claude Code in every session. A new skill
for our own sessions goes in the second one, or it silently never fires.
Today that is `model-advisor`: which model and effort level a task wants,
and how to group a large change into phases instead of switching per
task. Its facts live in `references/models.md` with the date they were
checked — update that file when a model is released, not the method.

## Wishlist

The user's ideas for the project that are not yet committed to live in
`docs/wishlist.md`; its header has the format and the statuses. When asked
to "add to the wishlist", add one entry there and leave it **uncommitted**
until the user says to commit — then all waiting entries go in one PR, since
`master` changes only through one. Say at the end of a session that entries
are waiting. When an idea becomes an OpenSpec change, delete its entry.

## Methodology

OpenSpec (`/opsx:propose → /opsx:apply → /opsx:archive`) with a Shape-Up
`appetite` field. Changes live in `openspec/changes/`.

### Replacing a design — the change is not done until the old one is gone

When a change supersedes an earlier design (a pipeline, a screen, a
module, a table family), the cleanup is part of the same change, not a
later discovery. Before calling it done:

1. **Delete the superseded OpenSpec change** (`git rm -r`). Do not keep or
   archive it — git history is the record. Nothing may mention the old
   design afterwards, the replacing change included: it describes what the
   new design is and why, not what it replaced (no "N → M" counts, no
   old-stage mapping tables). The one exception is a **design record**,
   written only when the user asks for one: `docs/history/<name>.md` says
   what the old design was, why it was replaced and which ideas may come
   back. Other files may link to it but never restate it.
2. **Sweep the whole repo for the old names**: stage keys, module paths,
   table/column names, screen and component names, prompt keys. Include
   comments, seed prompts, docs, and **templates that are written into a
   client's repository**. Expect zero hits outside `docs/history/` and
   applied migrations; add the names to the retired list in
   `scripts/audit-stale.mjs` so `npm run audit:stale` keeps it that way.
3. **Use `grep -rIn` with `--exclude-dir=node_modules,dist,.git,.pgdata`**
   for that sweep. A negated-only glob in the Grep tool (`!node_modules/**`)
   returned "no matches" for terms that do exist — don't trust an empty
   result from it without a positive control.
4. **Deleted files leave dangling references** — grep for the deleted paths
   (`repo-ai/…`), not just the concepts.
5. Say in the change's `tasks.md` what was swept and what was
   deliberately kept, so the next reader doesn't have to rediscover it.
