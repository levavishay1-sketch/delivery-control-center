# MCP server — tasks

Appetite: **standard**. Follows `mcp-server-feasibility`.

## 1. The project

- [x] 1.1 `Server/src/Dcc.Mcp` — a console project in the solution, on
      `ModelContextProtocol` 2.3.0 (the latest stable on NuGet, checked
      2026-10-25; its API read from the package's own XML docs); stdio
      transport; every log level to stderr
- [x] 1.2 Configuration from the MCP client's environment: `DCC_API_URL`
      (default `http://localhost:5080`, an address with a path works) and
      `DCC_API_TOKEN`, sent as `Authorization: Bearer`; no database connection

## 2. The tools

- [x] 2.1 `list_clients` → `GET /clients`, the bare array; its description
      says what a row holds (id, name, counts, this month's spend, budget)
- [x] 2.2 `search_requirements` → the new
      `GET /clients/{clientId}/workitems/search?q=`
      (`RequirementService.SearchAsync`: inside the tenant, `ilike`, the 25
      newest, with `requirementType`), guarded by `requirements.read` on the
      client
- [x] 2.3 `get_requirement` → `GET /workitems/{id}`
- [x] 2.4 `get_timeline` → `GET /workitems/{id}/timeline`, the bare events array
- [x] 2.5 `get_cost_summary` → `GET /workitems/{id}/cost`
- [x] 2.6 Refusals are `isError` sentences: 404 (`no requirement with id …`),
      403 (naming the missing permission), 401, the API unreachable, an id
      argument that is missing or not a uuid (naming the argument and where
      to find one)

## 3. Identity and the wall

- [x] 3.1 Every call is made as the token's person: a client they may not read
      is not listed, and its requirements, timelines, costs and search are
      refused
- [x] 3.2 Write tools deliberately not built — the server stays read-only
      (decision 2026-10-25)

## 4. Verified

- [x] 4.1 `McpTests` (an SDK client over in-memory streams, the API in-process):
      `tools/list` returns exactly the five, read-only, with their titles,
      descriptions and parameters word for word; a reader of client A sees
      only A, gets the same JSON as the REST routes, and is refused client B's
      requirement, timeline, cost and search; a delegated agent's token reads
      no further than its owner; search matches inside its client only,
      ignoring case, the 25 most recently changed first; an unknown id answers
      `no requirement with id …`, an unknown client `no client with id …`; a
      wrong, revoked token, an unreachable API and a malformed id answer
      sentences
- [x] 4.2 Run as a real child process over stdio (the built `Dcc.Mcp.dll`, and
      `dotnet run --project Server/src/Dcc.Mcp`): `initialize`, `tools/list`
      and `tools/call` answered, nothing but JSON-RPC on stdout, exit code 0
      when stdin closes
- [ ] 4.3 A first run from a real Claude Code session against the running
      server, with a person's token (`claude mcp add dcc …`, see the proposal)
      — needs a token, which an admin makes
