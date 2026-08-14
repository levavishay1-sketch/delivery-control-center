## Why

The product is currently single-tenant with no authentication (see
`docs/PRODUCT_SPEC.md` §3, §12, §28): every route is callable by anyone,
there is no `Client`/`Organization` boundary, and `Project.key` is
globally unique rather than scoped. A gap-analysis against the product's
intended vision (a multi-client delivery control plane) identified this as
the highest-leverage, cheapest-to-fix-now foundation: 6 models and ~12
query sites today; expensive to retrofit after more feature slices land.
This change ("Slice 0") adds real tenancy, real identity, a domain-layer
boundary between UI and database, and fixes five concrete inconsistencies
between config/schema and actual code behavior.

## What Changes

- New `Organization` → `Client` hierarchy; every `Project` belongs to a
  `Client`; `Project.key` uniqueness becomes per-client, not global.
- Real authentication (Auth.js / NextAuth v5, Credentials provider,
  database sessions) and per-client roles via a `ClientMembership` join
  table, replacing free-text `Approval.approverName` /
  `AuditEvent.actorName` as the source of identity (kept as immutable
  display snapshots alongside new real user references).
- A `src/domain/` layer: all Prisma access and business rules move behind
  domain command/query functions; API routes and Server Components stop
  importing Prisma directly (enforced by an ESLint rule).
- Backend authorization on every mutation via `requireClientRole()`.
- A minimal `Job` table, used first to make `StageStatus.AI_DRAFTING` a
  real, observable state instead of a dead enum value.
- Field-level secrets encryption (AES-256-GCM) for integration/AI
  credentials stored in `Client`/`Project` config JSON.
- Fixes five inconsistencies from `PRODUCT_SPEC.md` §30:
  `requiresApproval` now actually gates; `AI_DRAFTING` is assigned;
  `WorkItem.status` is rendered; `Project`/`Client` integration config is
  settable from the UI; `AZURE_DEVOPS` is shown as explicitly unavailable
  rather than silently aliased to manual.
- Test framework (Vitest + one Playwright smoke test) and CI
  (lint + build + Vitest on push).

**BREAKING**: `POST /api/stages/[id]/approve` and `/reject` stop accepting
`approverName` in the request body — identity now comes from the
authenticated session. All API routes require authentication.

## Capabilities

### New Capabilities
- `tenancy`: `Organization`/`Client` hierarchy, project scoping, per-client
  uniqueness.
- `identity-and-access`: authentication, per-client roles, backend
  authorization on every mutation.
- `domain-layer-boundary`: architectural rule that Prisma access is
  confined to `src/domain/`, enforced by lint.

### Modified Capabilities
- `sdd-pipeline`: `requiresApproval` becomes functional; `AI_DRAFTING`
  becomes a real, assigned state; approval identity comes from an
  authenticated user, not free text.
- `work-item-sync`: work items and their `status` field become visible in
  the UI; `AZURE_DEVOPS` is explicitly unavailable rather than silently
  aliased to manual sync.

## Impact

Affected: `prisma/schema.prisma` (multiple new models + migrations),
`src/lib/pipeline.ts` (moved into `src/domain/pipeline/`), all API routes
under `src/app/api/`, all pages under `src/app/`, `eslint.config.mjs`, new
dependencies (`next-auth`, `@auth/prisma-adapter`, `zod`, `vitest`,
`@playwright/test`), new env vars (`ENCRYPTION_KEY`, `AUTH_SECRET`).
No change to `AgentExecutor`/`IntegrationAdapter` interfaces, prompt/workflow
config mechanism, or existing migration history.
