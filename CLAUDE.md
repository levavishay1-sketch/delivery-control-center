@AGENTS.md

## OpenSpec is mandatory for meaningful work

Meaningful development work — a new capability, a behavior change worth
planning, a schema/API change, or a new page/surface — MUST go through
OpenSpec: propose (`/opsx:propose` or the `openspec-propose` skill) → apply
→ archive (syncing delta specs into `openspec/specs/`). This applies even
when the task arrives as an ad hoc request rather than a planned roadmap
slice.

Small, local, obvious changes stay lightweight and don't need a change: a
label tweak, a button/copy change, a CSS adjustment, a bug fix to existing
behavior. Forcing those through full planning artifacts would be exactly
the kind of bureaucratic overhead OpenSpec's own philosophy (fluid, not
rigid) argues against. When it's unclear which side of the line something
falls on, open a change anyway — per "Change sizing" below, small changes
are cheap.

Two things are never optional, regardless of change size:
- **Never silently contradict an existing spec.** If an edit would make
  `openspec/specs/` stop matching reality, either update the spec in the
  same change or open a retroactive one — per "Specs: spec-anchored, not
  spec-once" below. This can't be checked mechanically; it's a judgment
  call every edit needs to make.
- **UI/visual work follows the Design System.** Read
  `openspec/specs/design-system/spec.md` and the latest slice's `design.md`
  before writing markup, and reuse `src/components/ui/` primitives rather
  than inventing new markup — even for a small change.

CI enforces the structural half of this, not the judgment half:
`.github/workflows/ci.yml` runs `openspec validate --strict` on every push
(catches malformed specs/changes), and a compliance check
(`scripts/check-openspec-compliance.sh`) fails the build only when a diff
*adds a new file* shaped like new capability — a Prisma migration, an API
route, a domain module, or a top-level page — with no accompanying
`openspec/` path in the same diff. It deliberately never fires on edits to
existing files, so small changes are never blocked by CI; the two bullets
above stay enforced by review discipline, not tooling, because neither is
mechanically checkable.

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
- **Job worker (Slice 2+)**: `DRAFT_STAGE` (and future async job types) run
  in a separate long-lived process, not inside the Next.js request/response
  cycle. Local dev needs both `npm run dev` and `npm run worker` running at
  once — a `Job` row enqueued via the app sits `QUEUED` forever if the
  worker isn't also running.
