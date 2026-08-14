## Context

See proposal.md — Why. Six models, ~12 query sites today; this is the
cheapest point to retrofit tenancy and identity. Full reasoning, including
alternatives considered, was captured during planning; the decisions below
are the outcome.

## Goals / Non-Goals

**Goals:** real tenant isolation, real authentication and per-client
authorization, a domain-layer boundary that makes bypassing tenant scoping
a build error, and fixing the five known config/code inconsistencies.

**Non-Goals:** per-stage-type role assignment (Slice 2), durable
cross-restart pause/resume for SDD runs (Slice 2), hierarchical config
inheritance/override UI (Slice 6), Playwright in CI (fast-follow).

## Decisions

1. **Auth: Auth.js (NextAuth v5), Credentials provider, database sessions,
   `@auth/prisma-adapter`.** Alternative considered: hand-rolled session
   cookies. Rejected — reimplements cookie/CSRF/session-rotation
   correctness that a well-audited library already solves, for a product
   whose whole premise is being trustworthy.
2. **Password hashing: Node's built-in `crypto.scrypt`**, not
   bcrypt/argon2. Alternative: argon2. Rejected — native binding adds
   dependency-install friction we've already hit twice
   (`npm install-scripts` gate) for no security gain at this scale;
   scrypt is a NIST-recommended KDF built into Node.
3. **Role scope: per-`(User, Client)` via `ClientMembership`**, not a
   single global role. A person can be Tech Lead on one client's work and
   Viewer on another's — a global role can't express that, and it's a
   real requirement for a software house serving multiple clients.
4. **No public signup** — org admins create users and memberships.
5. **Secrets encryption: AES-256-GCM, field-level**, only the credential
   values inside `integrationConfig`/`aiConfig` JSON, not the whole blob —
   keeps non-secret fields (e.g. `baseUrl`) readable without decrypting.
6. **`Job` table lands in this slice**, scoped minimally (used to make
   `AI_DRAFTING` real and to retry Jira/Claude calls), because Slice 2's
   design explicitly builds its durable SDD-run state machine on top of
   it. The richer state machine itself is not built here.
7. **CI runs lint + build + Vitest only.** Playwright needs a seeded
   Postgres; adding a CI database service is a reasonable fast-follow,
   not bundled into an already-large slice.
8. **Existing dev/demo rows are disposable.** Migration history is never
   reset; a backfill (default `Organization` + `Client`) keeps existing
   rows valid rather than treating demo data as precious.

## Migration sequencing

Add nullable `Project.clientId` → backfill (create one default
`Organization` + `Client`, assign existing projects to it) → alter to
required → add `@@unique([clientId, key])`, dropping the old global-unique
`key` constraint. Same backfill pattern for `Approval.approverId` /
`AuditEvent.userId` (both nullable — legacy rows predate real identity and
stay attributed by their existing free-text snapshot).

## Domain layer

```
src/domain/
  shared/    context.ts, authz.ts (requireClientRole), errors.ts, crypto.ts
  organization/  client/  project/  work-item/  pipeline/  job/
```

`src/lib/audit.ts`, `src/lib/config.ts`, `src/lib/db.ts`,
`src/lib/agents/*`, `src/lib/integrations/*` are unchanged in place —
shared infra the domain layer calls into, not aggregates themselves.
`src/lib/pipeline.ts`'s functions move into `src/domain/pipeline/commands.ts`
with authorization added; behavior is otherwise preserved exactly.

Enforcement: an ESLint `no-restricted-imports` rule scoped to `src/app/**`
blocks `@/lib/db` and `@/generated/prisma/client` imports outside
`src/domain/**`.

Every domain command: Zod-validate input → `requireClientRole` →
`db.$transaction` → `recordAuditEvent` inside that same transaction →
typed return. API routes become thin controllers.

## Risks / Trade-offs

- [Migrating existing rows to required FKs could fail if backfill logic has
  a bug] → each migration step is applied and verified against the real
  Neon dev database before the next step is written, not assumed correct.
- [Auth.js version churn / v5 is comparatively new] → pin the version,
  verify the documented App-Router integration pattern against the
  installed package before writing route code (same discipline used for
  Next.js 16 / Prisma 7 surprises earlier in this project).
- [Domain-layer migration touches every existing route] → task group 1
  moves logic with no behavior change and is verified against the full
  existing live walkthrough before any new capability is added on top.
