# MCP server v1 — tasks

Appetite: **standard**. Follows `mcp-server-feasibility`'s spike.

## 1. Package scaffolding

- [x] 1.1 New `apps/mcp` workspace package (`package.json`,
      `tsconfig.json` extending the shared base + referencing
      `packages/db`/`packages/core`, added to the root `tsconfig.json`
      references)
- [x] 1.2 `@modelcontextprotocol/sdk` installed (1.30.0) — its actual
      installed type definitions (`dist/esm/server/mcp.d.ts`,
      `stdio.d.ts`) were read directly before writing any tool code,
      not assumed from general MCP knowledge, since getting the
      `registerTool`/transport API shape wrong would mean a server that
      doesn't compile or doesn't run.

## 2. Read-only tools

- [x] 2.1 `list_clients` — `listClients()` (already exported)
- [x] 2.2 `search_requirements(clientId, query)` — a small tenant-scoped
      `ilike` query, written directly in the MCP layer (genuinely
      trivial, not business logic worth a new core export — same
      judgment already applied to the task-search route built for
      `bug-change-request-lifecycle`'s picker)
- [x] 2.3 `get_requirement(id)` — composes `tasksFor`, `attachmentsFor`,
      `reposForRequirement`, `timeline`, plus gaps/blockers queries —
      mirrors `GET /workitems/:id`'s own composition in
      `apps/api/src/server.ts` exactly, so the two can never quietly
      drift into different shapes for the same data
- [x] 2.4 `get_timeline(id)` — `timeline()`
- [x] 2.5 `get_cost_summary(id)` — `requirementCostSummary()`

## 3. Identity / write tools

- [x] 3.1 Deliberately NOT built this pass — see proposal.md's "why
      read-only, and why not later." No auth stub, no placeholder write
      tools behind a flag; nothing to accidentally ship half-secured.

## 4. Verify end to end

- [x] 4.1 `npm run typecheck` clean (whole repo, `apps/mcp` included in
      the root project references)
- [ ] 4.2 **Not verified against a real MCP client.** No interactive
      MCP-client harness (Claude Desktop, a configured Claude Code
      `.mcp.json`) was available in this session to actually connect and
      call these tools end-to-end. The tool schemas and response shape
      follow the installed SDK's own type definitions (checked, not
      guessed — see 1.2), and the underlying data-fetching code reuses
      already-tested `packages/core` functions, but the MCP protocol
      handshake itself (tool discovery, argument marshaling, content
      block rendering in a real client) has not been run for real. This
      is the single most important thing to do before relying on this
      server: register it in a real Claude Code session
      (`claude mcp add dcc -- npx tsx apps/mcp/src/server.ts`, or
      equivalent) and confirm `list_clients` actually returns data
      through a real client round-trip.
