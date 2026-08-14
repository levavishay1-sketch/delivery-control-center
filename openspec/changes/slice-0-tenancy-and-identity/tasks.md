## 1. Domain layer scaffold + ESLint guard

- [x] 1.1 Create `src/domain/shared/errors.ts` (`context.ts`/`authz.ts` deferred to group 4 — nothing uses them until roles exist; creating them now would be dead code)
- [x] 1.2 Move `src/lib/pipeline.ts` functions into `src/domain/pipeline/commands.ts` unchanged in behavior
- [x] 1.3 Move every other direct Prisma call site under `src/app/**` into domain queries/commands too (`src/domain/project/`, `src/domain/work-item/`, `src/domain/audit/`) — the lint rule in 1.4 is a hard block, so it can't land until *all* call sites are moved, not just pipeline's. Scope grew beyond the original wording of this task for that reason.
- [x] 1.4 Add ESLint `no-restricted-imports` rule blocking `@/lib/db` and `@/generated/prisma/client` under `src/app/**`; proved it actually fires (temporarily added a violating file, confirmed lint failure, removed it)
- [x] 1.5 `/verify`: build, lint, full existing live walkthrough (create project, work item, draft, approve) — checked both the real-Claude failure path (billing error propagates as a clean error, no crash) and the mock-executor success path (full draft→approve→advance cycle), both identical to pre-refactor behavior

## 2. Tenancy schema

- [x] 2.1 Add `Organization`, `Client` models
- [x] 2.2 Add nullable `Project.clientId`, migrate, backfill a default Organization+Client, assign existing projects (`prisma/migrate-backfill-default-client.ts` — one-off, deleted after it ran successfully; not meant to be re-run or kept as permanent code)
- [x] 2.3 Alter `Project.clientId` to required; replace global-unique `key` with `@@unique([clientId, key])` (migration authored by hand — `prisma migrate dev` refuses non-interactive environments; applied via `prisma migrate deploy`, confirmed zero drift with `prisma migrate status`)
- [x] 2.4 Extended `src/domain/project/` with `clientId` scoping; added `src/domain/client/`, `src/domain/organization/`, `GET /api/clients`; `AddProjectForm` gained a client selector; home page now groups projects under a client heading (grew beyond the original wording — a client selector and grouped UI is what actually makes a required `clientId` usable without auth yet to imply "current client")
- [x] 2.5 `/verify`: migration applies cleanly against real Neon DB (3 existing projects backfilled and visible under "Default Client"); build and lint pass; live-verified per-client key uniqueness — same key across two different clients succeeds, duplicate key within one client is correctly rejected by the DB constraint; confirmed via screenshot that the home page renders the new client-grouped layout correctly

## 3. Authentication

- [x] 3.1 Install `next-auth`; add `User`, `Account`/`Session`/`VerificationToken` models (standard Auth.js shape), `passwordHash`/`isOrgAdmin` on `User`; migration applied via `prisma migrate deploy` (hand-verified additive-only, `migrate status` confirmed zero drift)
- [x] 3.2 Configure Credentials provider + JWT session strategy (**deviation from plan**: the plan specified "Credentials provider, database sessions" + `@auth/prisma-adapter`; `@auth/core`'s own Credentials provider docs state it requires JWT sessions, not database sessions — switched to `session: { strategy: "jwt" }` and did not wire up `PrismaAdapter` at all, since it provides no functional benefit without a database-session-based provider and its types don't match our custom Prisma client output path. `Account`/`Session`/`VerificationToken` tables are kept in the schema so a future OAuth provider is additive, not a migration. Documented in `src/auth.ts` comments.)
- [x] 3.3 Login page (`src/app/login/page.tsx`, server action calling `signIn`), `auth()` session helper, sign-out button in `src/app/layout.tsx`. Split into `src/auth.config.ts` (Edge-safe, no Prisma) + `src/auth.ts` (Node runtime, adds Credentials provider) because Next.js 16's Proxy (renamed from Middleware) runs on the Edge runtime and can't load our Prisma client. `src/proxy.ts` builds its own `NextAuth(authConfig)` instance from the Edge-safe config only.
- [x] 3.4 Seed script creates one org-admin user (`admin@example.com`, password from required `SEED_ADMIN_PASSWORD` env var, hashed via `src/domain/shared/password.ts`'s scrypt-based `hashPassword`)
- [x] 3.5 `/verify`: unauthenticated request to `/` redirects to `/login` (confirmed via curl, 307). Login and session persistence: simulated the full NextAuth Credentials flow via curl (fetch CSRF token, POST to `/api/auth/callback/credentials`, reuse cookie jar) — login returns 302 with a valid session cookie, a follow-up authenticated request to `/` returns 200, and `/api/auth/session` returns the correct user. Build and lint both pass. (Initial live test failed against a stale `next dev` process left bound to port 3000 from earlier in the session, running pre-fix code — restarting the dev server resolved it; root cause was a stale process, not the auth implementation.)

## 4. Roles + authorization

- [ ] 4.1 Add `Role` enum, `ClientMembership` model
- [ ] 4.2 Implement `requireClientRole()` in `src/domain/shared/authz.ts`
- [ ] 4.3 Wire into every domain command and API route
- [ ] 4.4 `/verify`: Vitest — unauthenticated rejected, wrong role rejected, correct role succeeds

## 5. Real identity on decisions and audit

- [ ] 5.1 Add `Approval.approverId`, `AuditEvent.userId` (both nullable, real FKs)
- [ ] 5.2 API routes stop accepting `approverName` from the request body; derive from session
- [ ] 5.3 `/verify`: approve as a logged-in user; confirm DB row and audit entry show the real user

## 6. Fix the five inconsistencies

- [ ] 6.1 `requiresApproval: false` actually skips the gate (uses the sdd-pipeline spec delta's new scenario)
- [ ] 6.2 `AI_DRAFTING` is set via the `Job` row around the executor call, cleared after
- [ ] 6.3 `WorkItem.status` rendered in the UI
- [ ] 6.4 `Client`/`Project` integration config settable from a form
- [ ] 6.5 `AZURE_DEVOPS` explicitly rejected as unavailable, not offered in the UI
- [ ] 6.6 `/verify`: each behavior checked live, one at a time

## 7. Secrets encryption

- [ ] 7.1 `src/domain/shared/crypto.ts` — `encryptSecret`/`decryptSecret`, AES-256-GCM, key from `ENCRYPTION_KEY`
- [ ] 7.2 Apply to credential fields inside `integrationConfig`/`aiConfig` on write/read
- [ ] 7.3 `/verify`: Vitest round-trip test; direct DB read confirms ciphertext, not plaintext

## 8. Tests + CI

- [ ] 8.1 Vitest config; collect/complete unit tests from groups 4/6/7
- [ ] 8.2 One Playwright smoke test: login → create client → create project → create work item → draft → approve
- [ ] 8.3 `.github/workflows/ci.yml`: lint + build + Vitest on push
- [ ] 8.4 `/verify`: `npm test` green locally; push and confirm Actions run is green

## 9. Close out

- [ ] 9.1 Full slice verification: two clients coexist with isolated data/credentials; unauthenticated request to any route rejected; Viewer cannot approve — proven by tests
- [ ] 9.2 Archive this change into `openspec/specs/`
