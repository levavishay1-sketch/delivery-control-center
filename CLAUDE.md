@AGENTS.md

## Git workflow

Routine git operations are pre-authorized — do them without asking for
per-action approval: `git add`, `git commit`, creating/switching local
branches, `git pull`, and `git push` to non-`main` branches.

Commit at natural checkpoints: after an OpenSpec change is archived (bundle
the code changes, the updated `openspec/specs/`, and the archived change
folder into one commit), or after any other coherent unit of work is
verified working (build/lint pass, manually checked). Write commit messages
that explain why, matching this repo's existing message style once one is
established.

Still confirm first, every time: force-push (`push --force`), `git reset
--hard`, rewriting published history, deleting branches, and pushing
directly to `main` (open a PR instead once a remote exists, unless told
otherwise).

## Specs are spec-anchored, not spec-once

`openspec/specs/` must reflect what the code actually does, not just what
was originally proposed. If implementation reveals that a change's
`design.md` or spec delta was wrong — a different approach, a dropped
requirement, a discovered constraint — update those files before archiving,
not after. Don't let an archived change encode a decision that isn't what
actually got built.

If code ever changes outside a formal OpenSpec change (a quick fix, a
hotfix) in a way that contradicts an existing requirement in
`openspec/specs/`, that's a signal a change should have been opened for it.
Open one retroactively rather than leaving the spec stale.

## Change sizing

Prefer several small, independently-verifiable OpenSpec changes over one
large one. Within a single change's `tasks.md`, group tasks into units that
can each be built and verified on their own — build/lint plus a targeted
check — rather than only verifying once at the very end. For a change with
more than one such group, commit after each verified group, not only at
final archive; this keeps history granular and bisectable.

## Verification standard

A change isn't done because the code looks right — it's done after: build +
lint pass, then a targeted live check that actually exercises the change
(curl/browser/DB query against the real dev database, or the real external
API when one is involved), not just a unit-level check. When a change adds
or touches an error path, verify that path live too, not only the happy
path (e.g. the Claude API billing-failure case was verified by triggering
it for real, confirming no partial writes).

## Project lessons / gotchas

Durable, stack-specific facts learned the hard way in this repo — check
these before re-deriving them from scratch:

- **Next.js 16**: dynamic route handlers and pages must use the generated
  `RouteContext<'/path'>` / `PageProps<'/path'>` type helpers; `params` is a
  `Promise` (`await ctx.params`), not a manually-typed object.
- **Prisma 7**: `schema.prisma`'s `datasource` has no `url` field — the
  connection string goes into a driver adapter (`new PrismaPg({
  connectionString })` from `@prisma/adapter-pg`) passed to `new
  PrismaClient({ adapter })`. The generated client has no directory
  index — import from `@/generated/prisma/client`, never
  `@/generated/prisma`. Standalone scripts run via `tsx` (outside Next.js
  and outside the `prisma` CLI) don't get `.env` loaded automatically —
  add `import "dotenv/config"` explicitly.
- **`js-yaml`**: the ESM build has no default export —
  `import * as yaml from "js-yaml"`, not `import yaml from "js-yaml"`.
- **npm `install-scripts` gate**: this repo's `package.json` has an
  `allowScripts` allowlist. A new dependency with a postinstall script
  needs `npm install-scripts approve <pkg>` (after reading what the script
  does) before it will run — a plain `npm install` silently skips it
  otherwise.
