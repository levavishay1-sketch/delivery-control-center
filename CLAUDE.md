# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Delivery Control Center

@openspec/project.md

## Working in this repo

- npm workspaces: packages under `packages/*`, apps under `apps/*` (`api`, `web`, `mcp`), `@dcc/*` names.
- Node ≥ 22, ESM, `.ts` extensions in imports (NodeNext).
- **Run TypeScript with `tsx`, never raw `node`.** A script that imports across
  workspace packages (`@dcc/core` → `@dcc/db`) resolves through a
  `node_modules/@dcc/*` symlink, and Node's type-stripping refuses anything
  under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). Keep new
  `dev`/`start`/`demo`/`smoke` scripts on `tsx`.
- Only `appendEvent()` writes to `event_log` — never a raw INSERT.
- Every tenant-scoped table carries `client_id` and an RLS policy.
- Don't change the five foundational decisions (see `openspec/project.md`)
  without a `docs/architecture-review.md`-style review.

### The local database (PGlite) — one process at a time

No local Postgres is needed: `@dcc/db` falls back to embedded PGlite
(`packages/db/.pgdata`) unless `DATABASE_URL` is set. **PGlite is not safe for
two processes to hold the same `.pgdata`.** This includes any one-off script
that imports `@dcc/db`, directly or through `@dcc/core`: a probe run with
`npx tsx` while the API is up can corrupt the directory, and the only fix is
`dev:reset` + `dev:setup` (which loses the local clients).

- Stop the API before `dev:migrate` / `dev:setup` / `dev:reset` / `dev:prove` /
  `smoke`. If it keeps running, it queries a stale schema and every query
  touching a new column returns 500.
- Editing a source file while a migration or script is mid-write races
  `tsx watch`'s kill-and-respawn and can corrupt `.pgdata`. Use
  `npm run -w @dcc/api start` (plain `tsx`, no watch) whenever a migration or
  one-off script might run concurrently.
- To run a script that needs the database while the API is up, point it at a
  scratch directory: `DCC_PGLITE_DIR=<scratch> npx tsx <script>` — or write the
  probe so it touches only git and the filesystem.

### Environment

- The API rejects requests without a matching `x-dcc-hook-token`. The web app
  sends `dev-secret` by default, so start the API with
  `DCC_HOOK_TOKEN=dev-secret` (`.claude/launch.json` already does).
- `DCC_DEV_EMAIL` and `DCC_HOOK_TOKEN` are also what the hooks and
  `skills/dcc.mjs` read; the hooks do nothing without them.
- Ports: API `:3001`, web `:5173` (vite proxies `/api`, including WebSocket).

## Commands

```bash
npm run typecheck              # tsc -b: db, core, api, mcp — NOT apps/web
npx tsc -p apps/web --noEmit   # web app has its own tsconfig; vite does not type-check
npm run lint                   # eslint . — errors fail, warnings are existing leftovers
npm test                       # vitest run — database-free unit tests
npm run audit:stale            # leftovers of replaced designs, stale OpenSpec statuses, missing "i" hints
npm run info:drift             # "i" explanations on lines a change touched — run before a PR that touches a screen
npm run sync                   # after merges: master current, merged local branches gone, what is left
npm run db:migrate             # drizzle-kit, real Postgres
npm run db:guards              # append-only triggers + dcc_app role
npm run -w @dcc/db dev:reset   # wipe local PGlite
npm run -w @dcc/db dev:setup   # apply migrations to local PGlite
npm run -w @dcc/db dev:migrate # migrate local PGlite
npm run -w @dcc/db dev:prove   # 9 checks: RLS wall + append-only + validation
npm run -w @dcc/api smoke      # 8 end-to-end checks against the API
npm run -w @dcc/core prove:routing    # routing proofs
npm run -w @dcc/core prove:retention  # chat-retention proofs
npm run -w @dcc/core prove:built-on   # a task developed before its dependency (own DB + git, safe with the API up)
npm run -w @dcc/api dev        # API on :3001 (tsx watch)
npm run -w @dcc/web dev        # web UI on :5173 (vite)
npm run -w @dcc/web build      # production build of the web app
```

There is no formatter or CI. A change is verified by `typecheck`, `lint`, `test`,
`audit:stale`, and the `dev:prove` / `smoke` / `prove:*` scripts.
`npm run lint` (ESLint flat config in `eslint.config.js`) fails only on real
errors; style leftovers are warnings — do not add new ones.
`npm test` runs Vitest over `*.test.ts` files next to the code (currently pure
modules in `packages/core/src`). **A test must import the module under test by
its own file, never `@dcc/core`'s index or `@dcc/db`** — that opens the PGlite
directory, which is unsafe while the API is up. Anything that needs the database
stays a `dev:prove` / `smoke` / `prove:*` script.

Repository onboarding (`openspec/changes/repository-onboarding-native-init`)
runs the real, interactive Claude Code (`/init` with `CLAUDE_CODE_NEW_INIT=1`)
in a pseudo-terminal on the DCC machine, through `@lydell/node-pty`'s prebuilt
binary; the screen reaches it over a WebSocket on the same `/api` proxy.
Restarting the API disconnects a live session — the run's screen reopens the
same conversation (`--resume`).

## Git flow — one project branch, task branches under it

`master` is main; it changes only through a pull request — DCC is a solo repo
with no CI, so "reviewed" here means Claude's own checks, not a second human.
The user has given Claude standing permission to do everything a maintainer
would on GitHub in **this repo specifically** — commit, push, open, merge and
close a PR — a permission that does **not** extend to other repositories
without the same explicit statement there. Claude still opens every PR with
what was checked, the same as before: merging it is one more step in the same
already-checked task, not a separate approval. Claude still does not create a
`project/` branch on its own.

```
master
 └─ project/<name>            ← created from master (the user's decision)
      ├─ task/<name-1>        ← created from the project branch
      └─ task/<name-2>
```

- A task's PR goes **into the project branch**, not `master` (`master` only for a
  `fix/` branch). Merge it in once checked, then update the project branch and
  check the whole thing together (`npm run typecheck`, `npm run audit:stale`,
  the affected screens). Keep the project branch current with `master`. The
  final `project/<name>` → `master` PR ships a whole subject at once — say
  plainly what it ships and merge it the same way, unless the user asked to
  review that one specifically.
- A big subject the user asked a project branch for takes commits directly, with
  a single PR to `master` at the end; split into task branches only when asked.

**A finished task is committed, pushed, its PR opened, and — once Claude stands
behind it — merged**, all one step: done, checked (`typecheck`, `audit:stale`,
the affected screens), described in the PR, merged. If something was not
checked or does not hold, say so and do none of it — including the merge.
Add only the task's own files by name, never `git add -A`.

**A subject's branch stays open only while it is still being worked on.**
Every later request on that same subject, in the same session or a later one,
goes onto its branch if the PR has not merged yet (`npm run sync` lists open
requests with their branches): switch to it and add commits, still one PR, not
one per commit — merge once that subject's work is actually done, not after
every small addition to it. A request on another subject — including an
unrelated one later in the same session — gets its own branch before its first
edit and ends in its own PR. If a request touches two subjects, ask. At the
start of each request, say in one line which branch it goes onto and why.
Before the first edit on a branch behind `master`, run `git merge
origin/master`; if that conflicts, stop and tell the user.

**Every branch always tracks current `master` — not only at the moment it was
created.** The only reason to build on something other than current `master` is
the documented hierarchy above (a `task/` branch off its `project/` branch); there
is no other excuse. In one long session it is normal to have several `fix/`
branches open at once, all sharing the one dev server the user has open — the
moment ANY of them merges (yours or not), `git merge origin/master` into every
other branch you are still working on before its next edit or restart, not only
when it was first cut. A branch that falls behind its own already-merged sibling
silently resurrects bugs that sibling already fixed — confirmed live 2026-09-23,
where a stale `fix/` branch made an already-merged, already-verified fix look
broken again.

**Branch names:** `<type>/<short-description>`, lowercase English with hyphens.

| prefix | opened by | example |
|---|---|---|
| `project/` | a person, off `master` | `project/pull-requests` |
| `task/` | a person or DCC, off a project branch; keep the work-item key when there is one | `task/WI-1284-file-compare` |
| `fix/` | a person, a small fix straight off `master` | `fix/map-click` |
| `ai/onboarding/<run>` | DCC, one per onboarding run | `ai/onboarding/9c02a09e` |
| `claude/` | a Claude Code desktop session, automatically | — |

Claude may create a `fix/` or `task/` branch. Branch from `origin/master` after a
`git fetch`, not from the local `master`.

**Always work in this folder, never in a second one.** The dev server the user
keeps open (`:5173`) watches only this folder. Create the branch here with
`git switch -c <name> origin/master --no-track`. **Never use a separate
`git worktree` or a second copy of the repository for your own work.** The
exception is the worktrees DCC itself creates for `ai/onboarding/<run>` runs
under `~/.dcc-repos-onboarding/`; work inside the one you were started in. If
git refuses a switch because an uncommitted file would be overwritten, stop and
tell the user.

**Keep the folder in step with the repository.** Run `npm run sync` first thing
when a new request begins, and the moment the user says something was merged. It
fetches, moves this folder to an up-to-date `master` when the current branch is
already merged, deletes fully-merged local branches, and reports what is left
(open PRs, unpushed commits, stashes, other folders, uncommitted files); it
never pushes or touches uncommitted files. Say its result in one line. When the
user asks for a summary of their requests, or at the end of a working day, give
the open requests as a table: number, branch, title, ready or not, behind
`master`, conflicts. Do not start work on a stale `master` or a merged branch.

**Name a PR by its number and its branch** whenever you mention one: "#9
(`fix/finished-task-commit-and-pr`, commit and open the PR for a finished
task)" — never the bare number.

## Every screen explains itself — the "i"

The end user is a Hebrew speaker who is not fluent in developer concepts. Every
screen title, card, section title, figure and non-obvious field carries an "i"
that opens one or two plain Hebrew sentences saying what it is — and, for a
costly or irreversible button, what happens if you press it. `PageHead`,
`CardTitle` and `StatTile` (`apps/web/src/ui.tsx`) take a **required** `info`
prop, and `npm run audit:stale` fails a raw `h1`–`h4` inside a screen, an unknown
concept key, a malformed entry, or a label/column/figure that names something and
opens no explanation. An element that genuinely needs none opts out with
`{/* no-info: why */}` above it (the audit counts these).

- The wording lives in **one** place, keyed by **concept** and never by screen:
  `packages/core/src/glossary/concepts/`, read only through `getConcept` /
  `allConcepts` / `glossaryFor` — the same entries the chat answers from.
- A new screen or component is not finished without it. How to add and word one,
  and which elements get an "i": the `info-hints` skill in `.claude/skills/`.
- Run `npm run info:drift` before a pull request that touches a screen, and fix
  a wording that no longer matches in the same change.

## Before a large task — the model and effort box

**Large** = it spans several files, packages or screens, or it is a whole
OpenSpec change or a group of its tasks. Before starting one, do not begin the
work: invoke the `model-advisor` skill and put its recommendation to the user as
a choice box with `AskUserQuestion` — approve, keep the current setting, one step
up, or a free-text comment. Start only after the answer. Ask once per phase, not
once per task. A session cannot change its own model, so an approval means asking
the user to switch with `/model` and `/effort`, then waiting.

## This repo dogfoods itself

Hooks (`hooks/`), skills (`skills/`), the `reviewer` subagent
(`.claude/agents/`) and the model-routing policy (`config/model-policy.json`) are
what DCC gives to pilot clients, wired up here too via `.dcc.json` +
`.claude/settings.json` against an internal "DCC Internal" client. Four hooks are
configured: `session-start`, `session-end`, `post-tool-use` (git activity) and
`info-hint-check` (lints screen files for missing "i" hints on Edit/Write). See
`hooks/README.md` for caveats (`SessionEnd` cannot block termination; hook
config is snapshotted at session start, so edits to `.claude/settings.json` need
a fresh session).

**Two skill directories, don't mix them.** `skills/` at the root is the library
DCC hands to a client's repository — those call `skills/dcc.mjs` and Claude Code
does not load them here. `.claude/skills/` is this repository's own, loaded in
every session (`info-hints`, `model-advisor`). A new skill for our own sessions
goes there, or it silently never fires. `model-advisor`'s facts live in
`references/models.md` with the date they were checked — update that file when a
model is released, not the method.

## Wishlist

The user's uncommitted ideas live in `docs/wishlist.md` (its header has the
format and statuses). When asked to "add to the wishlist", add one entry and
**commit and push it at once** to the open wishlist branch — the one whose pull
request is titled "Wishlist: new ideas"; if none is open, open a
`fix/wishlist-<date>` branch off `origin/master` with such a request. The request
stays open for the user to merge; say at the end of a session which entries are
waiting in it. When an idea becomes an OpenSpec change, delete its entry.

## Methodology

OpenSpec (`/opsx:propose → /opsx:apply → /opsx:archive`) with a Shape-Up
`appetite` field. Changes live in `openspec/changes/`; each needs a `Status:` line
that matches its task ticks (`audit:stale` checks this).

### Replacing a design — the change is not done until the old one is gone

When a change supersedes an earlier design (a pipeline, screen, module, table
family), the cleanup is part of the same change:

1. **Delete the superseded OpenSpec change** (`git rm -r`); git history is the
   record. Nothing may mention the old design afterwards, the replacing change
   included — it describes what the new design is and why, not what it replaced.
   The one exception is a design record written only when the user asks:
   `docs/history/<name>.md`.
2. **Sweep the whole repo for the old names** — stage keys, module paths,
   table/column names, screen and component names, prompt keys — including
   comments, seed prompts, docs, and templates written into a client's
   repository. Expect zero hits outside `docs/history/` and applied migrations;
   add the names to the retired list in `scripts/audit-stale.mjs`.
3. Sweep with `grep -rIn --exclude-dir=node_modules,dist,.git,.pgdata`. A
   negated-only glob in the Grep tool (`!node_modules/**`) returned "no matches"
   for terms that exist — don't trust an empty result without a positive control.
4. Deleted files leave dangling references — grep for the deleted paths, not just
   the concepts.
5. Say in the change's `tasks.md` what was swept and what was deliberately kept.
