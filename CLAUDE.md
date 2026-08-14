@AGENTS.md

## Git workflow

Routine ops (add, commit, local branch create/switch, pull, push to
non-`main`) are pre-authorized — no per-action approval needed. Commit at
checkpoints: each verified task group, and after every OpenSpec archive
(code + updated specs + archive folder, one commit).

Always confirm first: force-push, `reset --hard`, history rewrites, branch
deletion, direct push to `main` once a remote exists (open a PR instead
unless told otherwise).

## Durable inputs

Multi-step planning/requirements/roadmap input from the user (a pasted
document, a described multi-slice plan) must never live only in
conversation. Same turn it's given: save it verbatim to
`docs/roadmap-sources/<date>-<slug>.md`, then update `docs/ROADMAP.md`
(the roadmap index) to point at it. Never re-derive future scope from a
conversation summary — if `docs/ROADMAP.md` marks a slice as an unverified
stub, treat it as unscoped and ask for the source before planning it, even
if a prior summary suggests you already know the scope.

## Specs: spec-anchored, not spec-once

`openspec/specs/` must match actual code. If implementation diverges from a
change's design/spec delta, fix those files before archiving — never
archive a decision that isn't what got built. A code change outside a
formal OpenSpec change that contradicts an existing spec means a change
should've been opened for it — open one retroactively.

## Change sizing

Prefer several small OpenSpec changes over one large one. Group `tasks.md`
into independently buildable/testable units; verify (`/verify`) and commit
each group, not just at the end.

## Verification standard

Done = build + lint pass + a targeted live check (curl/browser/DB, or the
real external API) that actually exercises the change — not just "looks
right." Verify touched error paths live too, not only the happy path. Use
`/verify` to run this.

## Project lessons / gotchas

- **Next.js 16**: route handlers/pages use generated `RouteContext<'/path'>`
  / `PageProps<'/path'>`; `params` is a `Promise` (`await ctx.params`).
- **Prisma 7**: no `url` in `schema.prisma` datasource — pass a driver
  adapter (`new PrismaPg({ connectionString })`) to `new PrismaClient({
  adapter })`. Import the generated client from `@/generated/prisma/client`
  (no directory index at `@/generated/prisma`). Standalone `tsx` scripts
  need `import "dotenv/config"` — `.env` isn't auto-loaded outside
  Next.js/the `prisma` CLI.
- **js-yaml**: no default export — `import * as yaml from "js-yaml"`.
- **npm install-scripts gate**: a new dependency with a postinstall script
  needs `npm install-scripts approve <pkg>` (after reviewing it) or it's
  silently skipped.
