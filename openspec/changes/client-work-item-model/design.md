# Design: Client Work Item / Repository / Connection model

## Context

Confirmed by direct inspection (not assumption) before writing this design:

- `Requirement` (`prisma/schema.prisma:530`) is client-owned, type+title-mandatory, optionally
  Project-linked, and only becomes a `WorkItem` via the separate `startSddForRequirement` action
  (`src/domain/requirement/commands.ts:136`), which reuses `generateProjectKey`+`createProject`
  verbatim to resolve/create a Project, then `createWorkItem` to create the root WorkItem.
- `WorkItem.projectId` is `NOT NULL` (`schema.prisma:460`) — every WorkItem belongs to exactly one
  Project. `createWorkItem` (`src/domain/work-item/commands.ts:71`) requires `projectId` and
  validates a given `parentId` belongs to that same project (line 77-82). `addParentWorkItem`
  (work-item-model spec) enforces the same "same project" rule for the hierarchy in general.
- `WorkItem.source: IntegrationType` (`schema.prisma:462`) is hardcoded to `"MANUAL"` on every
  manually-created WorkItem (`commands.ts:94`) — never exposed as user-settable today. It shares
  the same `IntegrationType` enum as `Connector.type` (9 values: `MANUAL/JIRA/AZURE_DEVOPS/GITHUB/
  CRM/TEAMS/MCP/CUSTOM_API/OTHER`).
- `Repository` (`schema.prisma:973`) requires `connectorId` (`@unique`, NOT NULL) and is only
  created via `linkRepository` (`src/domain/evidence/commands.ts:36`), which requires a
  GitHub-typed `Connector` on a Project and performs a live GitHub API fetch. `Repository` is
  already client-owned (`clientId`) and already reusable across a client's projects via
  `ProjectRepository` — this part already matches the roadmap source's REPOSITORIES section.
- `Connector` (`schema.prisma:866`) is strictly 1:1 with `Project` (`projectId @unique`), always
  exists (including `MANUAL`), and is woven through `SyncRun`, `FieldProvenance`, `SyncConflict`,
  `WebhookDelivery`, and the GitHub/Jira/Azure DevOps adapters — genuinely required internally, not
  just a stale name. No detail page exists for it; it is configured only from Project Settings.
- No file-storage integration (S3, Vercel Blob, or otherwise) exists anywhere in this codebase.

## Decisions

### Decision 1 — Retire `Requirement`; `WorkItem` creation absorbs its intake shape

The roadmap source is explicit and leaves no room for interpretation: *"There is no Requirement →
Work Item conversion step... There is no separate Requirement object. The object itself is the
Work Item."* The `Requirement` model, its domain module (`src/domain/requirement/`), its routes
(`/api/requirements/*`, `/requirements/[id]`), and its components (`RequirementForm`,
`StartSddButton`, `DeclineRequirementButton`) are removed. `WorkStatus` already has `DRAFT` for
"not yet actioned" if that's ever needed — no replacement decline/lifecycle mechanism is invented,
since the roadmap source doesn't ask for one.

### Decision 2 — A Project-less WorkItem creation auto-resolves a Project, reusing the existing mechanism

The roadmap source's Client → Projects → Work Items hierarchy (Section 1) is fixed, and
`WorkItem.projectId` staying `NOT NULL` is the correct way to honor "there is exactly ONE Project
mechanism" (no schema change to make it optional, which would be a second, parallel hierarchy in
disguise). But the WORK ITEM creation form (Section 6) never asks for a Project — only
Type/Title/Source/Parent/Characterization/Attachments/Related Repositories. This is reconciled,
not invented: it's exactly the same shape `startSddForRequirement` already solves for a standalone
Requirement. `createWorkItemForClient` (new, Client-facing entry point):

- If a Parent is selected → the new WorkItem's `projectId` is the parent's `projectId` (preserves
  the existing "hierarchy is same-project" rule intact, no change to `addParentWorkItem`/
  `createWorkItem`'s existing same-project check).
- If no Parent is selected → a new Project is created for the Client, reusing
  `generateProjectKey`(title) + `createProject` verbatim (moved from `requirement/commands.ts` to
  `project/commands.ts` since it's no longer Requirement-specific), then `createWorkItem` creates
  the WorkItem as that Project's root.

This is the only way to satisfy both "Type+Title only, no Project field on the form" and "there is
exactly one Project mechanism" at once without inventing a shared-default-Project concept the
roadmap source never mentions.

### Decision 3 — `source` is exposed on WorkItem creation, reusing the existing `IntegrationType` enum

The roadmap source's Source examples (Manual, Azure DevOps, Jira, GitHub, "another future source")
are exactly `IntegrationType`'s existing values. Introducing a second, competing "source taxonomy"
for WorkItems would violate "do not create duplicate entities or parallel mechanisms." `source`
becomes a normal optional input on `createWorkItemForClient` (defaulting to `MANUAL` exactly as
today when omitted), using the same enum Connector already uses. This does not touch the
`connector-management` spec's "unimplemented connector type" gate — that gate concerns *configuring
a Connector for live sync*, not labeling where a WorkItem's content originated. All 9
`IntegrationType` values are selectable as a WorkItem's Source.

### Decision 4 — Characterization = existing `description` (text) + new `WorkItemAttachment` (files)

"Characterization" is not a new field-carrying concept distinct from what already exists — its
text half is exactly `WorkItem.description`, already optional. Its file half needs new storage:
since no blob-storage integration exists anywhere in this codebase and the roadmap source frames
Connections' own scope as "keep intentionally simple... expanded in future work," the same
minimal-footprint approach applies here — a new `WorkItemAttachment` model storing the file's bytes
directly in Postgres (`data Bytes`, `filename`, `mimeType`, `size`, `workItemId`), zero new
infrastructure/dependencies. This is a deliberately simple starting point, not a permanent
architecture decision — swapping to object storage later is a storage-layer change behind the same
model, not a product-model change.

### Decision 5 — `Repository` gains a direct creation path; `connectorId` becomes optional

Reuse, not duplicate: `Repository` already is the client-owned, cross-project-reusable, detail-page
concept the roadmap source's REPOSITORIES section describes. Only its *creation path* is
GitHub-Connector-specific today. Two coexisting creation paths on the same model:

- **New**: `createRepositoryForClient(clientId, source, url)` — the roadmap source's exact Source*
  + Link* form. Populates `source`/`url` (new columns), leaves `owner`/`name`/`externalId`/
  `connectorId` null.
- **Existing, unchanged**: `linkRepository(projectId)` — still requires a GitHub Connector, still
  does the live fetch, still populates `owner`/`name`/`externalId`/`connectorId` for engineering
  evidence. Continues to find-or-create by `(clientId, owner, name)` as today.

`connectorId` moves from required+unique to optional+unique (still unique when set, since a
Connector still maps to at most one Repository via that path). No existing row's `connectorId`
changes. `owner`/`name`/`externalId` also become optional (nullable) since the new path doesn't
populate them; the Repository detail page's title falls back to `source`/`url` when `owner`/`name`
are absent.

### Decision 6 — New `Connection` model; `Connector` stays as-is, no longer Client-page-visible

Per proposal's "Why," `Connector` is genuinely technically required internally (the entire
sync/webhook/evidence subsystem keys off it) — exactly the exception the roadmap source itself
names ("unless the existing Connector is technically required internally... reconcile
appropriately rather than exposing two confusing product concepts"). Reconciliation: `Connector`
is not touched at all and simply stops being rendered on the Client page (it remains configured
from Project Settings, unchanged). A new, separate `Connection` model is added:

```
model Connection {
  id        String   @id @default(cuid())
  clientId  String
  client    Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  source    String
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

`source` is a plain `String`, not a Prisma enum: the roadmap source explicitly says Connections'
sources (Azure DevOps/Jira/GitHub/MCP/CLI/"other future sources") must be extensible and "not
hard-coded" — a closed DB enum would need a migration per new value, exactly what's being avoided.
No credentials/auth/sync-config fields, per "keep Connections intentionally simple... future work."
This is the same "new, deliberately flexible concept, not a rename of Connector" direction already
recorded as resolved in `docs/roadmap-sources/2026-08-17-core-product-definition-gap-analysis.md`
(Decision 2) — this change is the first slice that actually builds it, deliberately scoped down to
just Source+Name per this prompt's explicit "future work" deferrals.

### Decision 7 — "Related Repositories" is a new WorkItem↔Repository join, same-client enforced server-side

No relation between `WorkItem` and `Repository` exists today (only `Project`↔`Repository` via
`ProjectRepository`). New join model:

```
model WorkItemRepository {
  id           String     @id @default(cuid())
  workItemId   String
  workItem     WorkItem   @relation(fields: [workItemId], references: [id], onDelete: Cascade)
  repositoryId String
  repository   Repository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
  createdAt    DateTime   @default(now())

  @@unique([workItemId, repositoryId])
}
```

The same-client check happens in the domain command (`createWorkItemForClient`/
`updateWorkItemRepositories`), not only the UI's option list: given a WorkItem's resolved
`projectId` → `clientId`, every submitted `repositoryId` is verified to belong to that same
`clientId` before the join rows are written; a mismatch throws `ValidationError`. `onDelete:
Cascade` on both sides satisfies "deleting a Repository deletes its WorkItem associations but not
the WorkItems themselves" (Section 9) for free — only the join row is removed.

### Decision 8 — Client identifier = existing `Client.slug`

The roadmap source: *"The Client identifier should be the existing identifier used by the system
for that Client. Do not invent another identifier."* `slug` is exactly that — already displayed as
the client's identifier on the Clients hub (`{client.slug}`) and already unique per organization.
No new field.

## Routes

| Route | Change |
|---|---|
| `/clients/[id]` | Restructured: header (name + slug), WORK ITEMS / REPOSITORIES / CONNECTIONS panels replace Requirements/Tasks/Repositories/Connectors |
| `/clients/[id]/work-items/new` | **New** — dedicated WorkItem creation screen |
| `/work-items/[id]/360` | Unchanged (already the canonical WorkItem detail screen); gains a Characterization sub-section (description + attachments) and Related Repositories |
| `/clients/[id]/repositories/new` | **New** — dedicated Repository creation screen (Source*, Link*) |
| `/repositories/[id]` | Gains edit (Source/Link) + delete-with-confirmation; unchanged Discovery panels stay |
| `/clients/[id]/connections/new` | **New** — dedicated Connection creation screen (Source*, Name*) |
| `/connections/[id]` | **New** — Connection detail: view/edit/save/delete-with-confirmation |
| `/requirements/[id]`, `/api/requirements/*` | **Removed** |

## Migration note

No production data exists for `Requirement` beyond development/test fixtures (early-stage
product). The Prisma migration drops the `Requirement` table outright rather than migrating rows —
consistent with "the object itself is the Work Item" (there is nothing meaningful to convert: a
still-`OPEN`, never-SDD-started Requirement has no WorkItem to become; one already `SDD_ACTIVE` has
already produced its WorkItem via the pre-existing mechanism and that WorkItem is unaffected by
this migration).
