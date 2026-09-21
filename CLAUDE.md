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
npm run sync                   # after merges: master current, merged local branches gone, what is left
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

**A finished task is committed, pushed, and its PR is opened.** When a
task is done, checked (`npm run typecheck`, `npm run audit:stale`, the
affected screens) and Claude stands behind it, Claude does not wait to be
reminded: it commits the work to the task's own branch, pushes that branch,
and opens the pull request — into the project branch (`master` only for a
`fix/` branch) — saying in the PR what was checked. The standing permission
covers the commit, the push and opening the PR; **merging stays a human
action**. If something was not checked or does not hold, Claude says so and
does none of it.

**Name a PR by its number and its branch.** Whenever Claude mentions a pull
request to the user, it gives the number, the branch and a short title —
"#9 (`fix/finished-task-commit-and-pr`, commit and open the PR for a
finished task)" — never the bare number, which tells the reader nothing.

**A subject's branch stays open until the user merges it.** The user merges in
batches — typically going through their open requests at the end of the day —
so a subject's branch and its one PR stay open for days. Every later request on
that subject, in any session, goes onto that same branch: find it (`npm run
sync` lists the open requests with their branches), switch to it, and add
commits. A finished task is committed and pushed to it as before, and the PR is
opened once, not once per commit. A request on another subject gets a branch of
its own. Claude never merges and never closes a request. At the start of each
request, say in one line which branch it goes onto and why, so the user can
correct it before any work is done; if a request touches two subjects, ask.
Before the first edit on a branch that is behind `master`, bring it up to date
with `git merge origin/master`; if that conflicts, stop and tell the user. A big
subject the user asked a project branch for (for example `project/info-hints`)
takes commits directly, one after another, with a single PR to `master` at the
end; split it into task branches only when the user asks.

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

**The same holds inside one session.** A session often takes several
requests. When a new request has no connection to the tasks already done
in the session, it gets its own branch — a `fix/` off `master`, or a
`task/` off the right project branch — before its first edit, and it ends
in its own PR. Never let it ride on the branch of the earlier work: a
branch that collects subjects makes a PR hard to review and hard to
understand. Related requests (the same subject, or one that depends on the
other) stay together. Branch from the current `origin/master` after a
`git fetch`, not from the local `master`, which can be behind.

**Always work in this folder, never in a second one.** The dev server the
user keeps open (`:5173`) watches only this folder, and the user checks a
change there the moment it is made. So make the new branch here with
`git switch -c <name> origin/master --no-track`, and edit here. **Never use
a separate `git worktree` or a second copy of the repository** — it hides
the change from the running app, and that is exactly what the user does not
want. Uncommitted files travel with a `git switch`; leave them out of the
commit by adding only the task's own files by name (never `git add -A`). If
git refuses the switch because an uncommitted file would be overwritten,
stop and tell the user rather than working somewhere else.

Claude may create a `fix/` or `task/` branch for this; a new `project/`
branch is still the user's decision.

**Keep this folder in step with the repository.** Run `npm run sync` first
thing whenever a new request begins, and the moment the user says something
was merged — before any other work. It fetches, moves this folder to an
up-to-date `master` when the branch it was on is already in it, deletes the
local branches that are entirely in `master`, and reports what is left. Open
pull requests are listed, not flagged — they are open on purpose — each with its
number, branch, title, whether it can merge and how far behind `master` it is;
what it flags is a branch nobody has a request for, commits that were not
pushed, stashes, other folders, and uncommitted files. Say its result in one
line ("clean", or what is left). When the user asks for a summary of their
requests, or at the end of a working day, give that list as a table: number,
branch, title, ready or not, behind `master`, conflicts. It never pushes and
never touches uncommitted files. Do not start new work on a stale `master` or on
a branch that has already been merged, and do not leave merged local branches
behind for the user to notice.

After a merge the branch is deleted (the repository deletes a PR's branch on
merge by itself; the project branch goes when its final PR merges). A branch
that was never merged and has been forgotten either gets a PR or is deleted
after looking at what it holds — never left to accumulate. The "ענפים" tab of
a pull request shows every branch of the repository and says which of these
applies.

## Every screen explains itself — the "i"

The end user is a Hebrew speaker who is not fluent in developer concepts.
So **every screen title, card, section title, figure and non-obvious field
carries an "i"** that opens one or two plain Hebrew sentences saying what it
is — and, for a costly or irreversible button, what happens if you press it.
This is the default for anything built from now on, not something to remember
per screen: the shared components (`PageHead`, `CardTitle`, `StatTile` in
`apps/web/src/ui.tsx`) take a **required** `info` prop, and
`npm run audit:stale` fails a raw `h1`–`h4` inside a screen, an unknown
concept key, or a malformed entry.

The wording lives in **one** place, keyed by **concept** and never by screen
(`packages/core/src/glossary/concepts/`), and is read only through
`getConcept` / `allConcepts` / `glossaryFor` — the same entries the chat
answers from, so a person gets identical words from the "i" and from Claude.
A new screen or component is not finished without it.

How to add one, how to word it, and which elements get an "i" (a button
usually does not): the `info-hints` skill in `.claude/skills/`, and
`openspec/changes/info-hints/design.md` for why it is built this way.

Two things hold this over time, and neither depends on remembering:

- **Completeness.** The `info` prop is required, so a card or a page title
  does not compile without one; `npm run audit:stale` fails a heading written
  by hand and a label, column or figure that names something and opens no
  explanation; and a hook says it the moment the file is saved. An element
  that genuinely needs none opts out with `{/* no-info: why */}` above it —
  the audit counts those, so an opt-out cannot quietly become the norm.
- **Staying true.** `npm run info:drift` lists the explanations that sit on
  the lines a change touched, and asks the one question a check cannot answer:
  did the meaning change? **Run it before opening a pull request that touches
  a screen**, and fix a wording that no longer matches in the same change. The
  slower signal is in the קלוד screen: a question that keeps coming back about
  an element that already has an "i" is marked there, because then the hint is
  the suspect, not the screen.

## Before a large task — the model and effort box

Before starting a **large** task, do not begin the work: invoke the
`model-advisor` skill and put its recommendation to the user as a choice
box with `AskUserQuestion` — approve, keep the current setting, one step
up, or a free-text comment. Start only after the answer. The shape of the
box and what to do with each answer are in the skill.

- **Large** = it spans several files, packages or screens, or it is a whole
  OpenSpec change or a group of its tasks. Not a question, a rename or a
  small fix.
- Ask once per phase, not once per task: a phase the user already approved
  is not asked about again until the next phase begins.
- A session cannot change its own model (`set_session_model` refuses the
  session that calls it), so an approval means *asking the user to switch*
  in the model menu or with `/model` and `/effort`, then waiting.

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
to "add to the wishlist", add one entry there and **commit and push it at
once** to the open wishlist branch — the one whose pull request is titled
"Wishlist: new ideas"; if none is open, open a `fix/wishlist-<date>` branch off
`origin/master` with such a request. An entry left only in the working folder
is protected by nothing. That request stays open and the user merges it when
they go through their requests; say at the end of a session which entries are
waiting in it. When an idea becomes an OpenSpec change, delete its entry.

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
