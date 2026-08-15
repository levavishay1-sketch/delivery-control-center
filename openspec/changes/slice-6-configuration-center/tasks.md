## 1. Data model & migrations

- [x] 1.1 Add `Organization.aiBudgetUsd` (nullable `Decimal(10,4)`) to `prisma/schema.prisma`.
- [x] 1.2 Add `ConfigChange` model: `id`, `scope` (new `ConfigScope` enum: `ORGANIZATION`/`CLIENT`/`PROJECT`), `field` (string, e.g. `"aiBudgetUsd"`), `oldValueUsd`/`newValueUsd` (nullable `Decimal(10,4)`), `changedByUserId` (FK `User`), `createdAt`; index per scope-FK (implemented as separate nullable `organizationId`/`clientId`/`projectId` FKs rather than a generic `scopeId` string, so referential integrity is enforced — matches `BudgetOverride`'s own existing pattern of nullable per-scope FKs).
- [x] 1.3 Generate and apply the migration (`npx prisma migrate deploy` per the project's non-interactive-migration workaround); run `npx prisma generate`. (No dev server/worker was running; nothing to restart.)

## 2. Budget resolution — Organization fallback tier

- [x] 2.1 Extend `checkBudget` (`src/domain/agent/commands.ts`) to fall through Project → Client → Organization → unbounded, adding the `Organization` fetch and `"organization"` scope alongside the existing `"client"`/`"project"`/`null` values; update `BudgetCheckResult`'s scope type (also added `scopeId` to `BudgetCheckResult`, needed so callers can recover the organization's id — not otherwise available to them the way client/project ids already are).
- [x] 2.2 Extend `approveBudgetOverride`'s scope union (currently `{ clientId?, projectId? }`) to accept `{ organizationId?, clientId?, projectId? }`, mirroring `checkBudget`'s own scope precedence (org-admin-gated for the Organization scope); `BudgetOverride`'s consumption query (`claimBudgetOverride`) gains an `"organizationId"` key alongside `"clientId"`/`"projectId"`. Also threaded the new scope through `BudgetExceededError` (gained an `organizationId` field), its two throw sites (`constitution/commands.ts`, `pipeline/commands.ts`), the two API routes that serialize it, the two "Approve to continue" UI components (`ConstitutionDraftButton.tsx`, `DraftButton.tsx`), and a new `POST /api/organizations/[id]/budget-override` route — without this, an organization-level budget-exceeded refusal would have had no way to be approved from the UI at all (the existing components only knew "client"/"project").
- [x] 2.3 Unit tests: budget resolves to Organization when Client and Project are both unset; Client still overrides Organization; Project still overrides both; blocks once the organization's accrued cost meets its threshold; `approveBudgetOverride` at organization scope requires org-admin (rejects a plain WRITE_ROLES client membership); existing precedence tests continue to pass unmodified. 12/12 in `budget.test.ts`, 259/259 full suite.

## 3. Configuration domain — effective value & history

- [x] 3.1 Create `src/domain/config/queries.ts`: `getEffectiveBudget(scope, scopeId)` — walks Project → Client → Organization, returning `{ value, sourceScope, isOverride }`; `listConfigHistory(scope, scopeId)` — most-recent-first `ConfigChange` rows.
- [x] 3.2 Create `src/domain/config/commands.ts`: `previewBudgetImpact(scope, scopeId, newValue)` — for `ORGANIZATION`/`CLIENT` scope, counts descendant clients/projects with no override of their own; returns `{ affectedClients, affectedProjects }` (both 0 for `PROJECT` scope).
- [x] 3.3 `setBudget(ctx, scope, scopeId, value)` in `src/domain/config/commands.ts` — authz per design.md decision 5 (`requireOrgAdmin` for `ORGANIZATION`, `requireClientRole(WRITE_ROLES)` for `CLIENT`/`PROJECT`), updates the scope's `aiBudgetUsd`, creates a `ConfigChange` row and a `recordAuditEvent`, in one transaction. `resetToInherited(ctx, scope, scopeId)` is `setBudget(..., null)`.
- [x] 3.4 Unit tests: effective-value resolution at each scope (own override / inherited from client / inherited from organization / fully unbounded); impact preview counts at Organization and Client scope (and Project scope's fixed zero); `setBudget` authz (org admin required for Organization scope, WRITE_ROLES for Client/Project, VIEWER rejected); `ConfigChange` row created on every set/clear, most-recent-first history. 11/11 passing.

## 4. API routes

- [x] 4.1 `GET /api/config/organization/[id]` (effective value + history), `POST /api/config/organization/[id]/preview` (impact preview), `POST /api/config/organization/[id]/budget` (set/clear).
- [x] 4.2 `GET /api/config/clients/[id]` , `POST /api/config/clients/[id]/preview`, `POST /api/config/clients/[id]/budget`.
- [x] 4.3 `GET /api/config/projects/[id]` , `POST /api/config/projects/[id]/budget` (no preview route — project scope skips preview per design.md decision 4).

## 5. UI — Configuration Center

- [x] 5.1 New `ConfigBudgetPanel.tsx` client component: shows effective value / source scope / inherited-or-override badge, an editable value field, "Reset to inherited" action, and (Organization/Client scope) the impact-preview-then-confirm flow before saving.
- [x] 5.2 New `ConfigHistoryList.tsx`: renders a scope's `ConfigChange` history (old → new, who, when).
- [x] 5.3 New Organization Configuration page (`/organizations/[id]/config` — the app's first Organization-scoped page; org-admin-gated) showing the Organization's `ConfigBudgetPanel` + history, and its clients for drill-down.
- [x] 5.4 Replace the inline `BudgetForm` on the Dashboard's Client cards (`src/app/page.tsx`) and the project Constitution page (`src/app/projects/[id]/constitution/page.tsx`) with a link into `ConfigBudgetPanel` for that scope (Client/Project use the direct-save path per design.md decision 4; no preview step for Project).

## 6. E2E test scenario

- [ ] 6.1 Write `e2e/slice6-configuration-center.spec.ts`: an org admin sets an Organization budget, sees the impact preview naming affected clients/projects, confirms, and sees a client with no override now report that value as its effective (inherited) budget; the org admin then sets a Client-level override, previews and confirms, and sees a project under it (no override) report the client's value instead; a write-capable user then sets that project's own override directly (no preview), sees it reported as an override, resets it to inherited, and sees it fall back to the client's value; the scope's history list reflects every change made.

## 7. Unit tests for domain logic

- [ ] 7.1 Full-suite pass confirming existing `agent/budget.test.ts` (Slice 3) transition/precedence tests still pass unmodified alongside the new Organization-tier tests from Task Group 2.

## 8. Documentation & verification

- [ ] 8.1 Update `docs/PRODUCT_SPEC.md`: revision header (seven slices); a new/updated section covering the Configuration Center; "Current capabilities"/"Missing capabilities" refreshed; Slice 6 marked Done in "Prioritized roadmap" and "Current Product Definition."
- [ ] 8.2 Update `docs/ROADMAP.md`: Slice 6 row → Done with archive link, Slice 6 section heading → "— **Done**".
- [ ] 8.3 Run build + lint + `tsc --noEmit` + full unit test suite + the new E2E test; live-check the impact-preview counts against real seeded data (not just "looks right") and the Organization-level budget-enforcement path (a real drafting attempt refused once the org-level threshold is exceeded), per the project's verification standard.
