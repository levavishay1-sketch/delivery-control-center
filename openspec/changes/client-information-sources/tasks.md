## 1. Data model & migration

- [ ] 1.1 Add `Connector.clientId` (nullable initially) and five new `IntegrationType` enum
      values (`CRM`, `TEAMS`, `MCP`, `CUSTOM_API`, `OTHER`) to `prisma/schema.prisma`. Generate
      the migration.
- [ ] 1.2 Write and run the backfill migration: set `Connector.clientId` for every existing row
      via `connectorId`'s own `projectId → project.clientId`.
- [ ] 1.3 Follow-up migration making `Connector.clientId` `NOT NULL` now that every row has one.

## 2. Domain layer

- [ ] 2.1 Update `getClientDetail` in `src/domain/client/queries.ts` to resolve a client's
      connectors via `db.connector.findMany({ where: { clientId } })` instead of
      `projects.map(p => p.connector)`.

## 3. Tests

- [ ] 3.1 Unit test: `getClientDetail` returns the same connectors before and after the query
      change, including a connector whose project has since been reassigned conceptually (i.e.
      the test asserts against `clientId` directly, not derived from `projects`).
- [ ] 3.2 Unit test: the backfill migration's `clientId` resolution — covered by exercising
      `getClientDetail`/`listClients`-adjacent queries against seeded data with an existing
      connector row, confirming `clientId` matches the connector's project's client.

## 4. Documentation & verification

- [ ] 4.1 Run `/verify` (build + lint + a live check): confirm the Clients hub's detail page
      still shows a client's connectors correctly after the query change, confirm the five new
      `IntegrationType` values are not selectable in `ConnectorConfigForm`, confirm `prisma
      studio`/a direct query shows the new enum values exist and `Connector.clientId` is
      populated for existing rows.
- [ ] 4.2 Update `docs/ROADMAP.md`'s Slice 13 row and detail section to **Done**, linking this
      change's archive path.
