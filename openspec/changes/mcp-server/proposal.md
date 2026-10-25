# MCP server for DCC (read-only)

Status: **built** — five read-only tools in C#, over the REST API with a
person's API token; one check left (task 4.3: a first run from a real Claude
Code session with a person's token).

Appetite: **standard**. Follows the spike `mcp-server-feasibility`.

## Why

A developer already working in a client's repository in Claude Code can ask
DCC about a requirement — its status, its timeline, what its AI work cost —
from inside that session, without switching to the web UI.

## What it is

- **`Server/src/Dcc.Mcp`** — a .NET 10 console project in
  `Server/DeliveryControlCenter.sln`, on the official C# MCP SDK
  (`ModelContextProtocol` 2.3.0, the latest stable on NuGet on 2026-10-25). An
  MCP client starts it as a child process and speaks MCP with it over stdio:
  stdin and stdout carry the JSON-RPC, so every log line goes to stderr. It
  exits when the client closes stdin.
- **No database connection.** Every tool is one `GET` on the REST API, made as
  the person whose API token the server was given. The configuration comes
  from the environment the MCP client starts it with:
  - `DCC_API_URL` — where the API is (default `http://localhost:5080`; an
    address with a path, such as the web's `/api` proxy, works too);
  - `DCC_API_TOKEN` — a `dcc_pat_…` token, sent as `Authorization: Bearer`.

  So the API's own checks decide what a tool may return —
  `[RequirePermission]`, the client filter of the lists, and RLS inside the
  tenant — exactly as for the same person on the web. Nothing about
  permissions lives in the MCP server.
- **Five tools, all of them read** (each one says `readOnlyHint`):

  | Tool | Parameters | REST route | Answers |
  |---|---|---|---|
  | `list_clients` | — | `GET /clients` | the clients the person may read, as a bare array: id, name, initiatives, workitems, this month's AI spend, monthly budget |
  | `search_requirements` | `clientId` (uuid), `query` | `GET /clients/{clientId}/workitems/search?q=` | up to 25 requirements of that client whose title contains the text (case-insensitive; `%` and `_` act as wildcards), newest first: id, key, title, type, phase, requirementType |
  | `get_requirement` | `id` (uuid) | `GET /workitems/{id}` | the requirement page: `{workitem, attachments, repos, gaps, blockers, tasks, taskDependencies, events}` |
  | `get_timeline` | `id` (uuid) | `GET /workitems/{id}/timeline` | the events, as a bare array — the newest 200 |
  | `get_cost_summary` | `id` (uuid) | `GET /workitems/{id}/cost` | `{totalUsd, totalInputTokens, totalOutputTokens, runCount, byKind}` |

- **The search route** `GET /clients/{clientId}/workitems/search?q=` answers
  `{items}` and needs `requirements.read` on the client; it reads inside the
  client's tenant (`RequirementService.SearchAsync`).
- **An answer** is one text block: the JSON, indented by two spaces, with
  Hebrew and other text written as itself.
- **A refusal** is a sentence with `isError`, never a protocol error:
  - 404 — `no requirement with id <id>` (for the search: `no client with id <id>`);
  - 403 — "The token's person may not read requirement <id> (it needs
    requirements.read).";
  - 401 — the token was not accepted (missing, wrong, expired, revoked, or its
    person disabled): set `DCC_API_TOKEN` to a token from `POST /tokens`;
  - the API cannot be reached — "Cannot reach the DCC API at <address>: …";
  - an id argument that is missing or not a uuid (a key such as `WI-1284`) —
    "id must be a uuid — a requirement's id, from search_requirements (it is
    "WI-1284")." (`clientId`: "… a client's id, from list_clients …"),
    answered before the API is called.

## Who it acts as

Always a named person — the token's. An admin creates the token with
`POST /tokens` (for a person: `forAgentId` = that person's id; it carries the
person's full powers, nothing narrower) and hands it over; the person puts it
in their own MCP client's configuration. A token made for a delegated agent
acts as that agent, which never exceeds its owner. `DELETE /tokens/{id}`
revokes a token, and from then on every tool answers that the token was not
accepted.

## Connecting it to Claude Code

```bash
claude mcp add dcc -e DCC_API_URL=http://localhost:5080 -e DCC_API_TOKEN=dcc_pat_… \
  -- dotnet run --project <repo>/Server/src/Dcc.Mcp
```

`claude mcp add` keeps the server (and the token) in the local scope —
private to you, never in a repository's `.mcp.json`. The server needs the API
running (`npm run server`).

## Out of scope

- **Write tools** (add a note, approve or progress a task, start an
  assessment). The server stays read-only (the user's decision, 2026-10-25):
  an outside session may look, not act. Tools that start a Claude run from
  inside a Claude session would also spend money from there.
- **An HTTP `/mcp` endpoint inside the API** — what a remote caller such as a
  claude.ai connector would need. Its own change, when there is such a caller.
- **A screen for tokens** — tokens are made through the API (`POST /tokens`).
- **A search bar in the web app** — an AI feature inside DCC calls the REST
  API itself; it does not need MCP.

## Impact

- New project `Server/src/Dcc.Mcp` (packages `ModelContextProtocol` 2.3.0,
  `Microsoft.Extensions.Hosting` 10.0.12), added to the solution; the test
  project references it.
- New route `GET /clients/{clientId}/workitems/search`
  (`RequirementsController.Search`, `RequirementService.SearchAsync`).
- Tests: `Server/tests/Dcc.Tests/Integration/McpTests.cs`.

## Exit gate

A Claude Code session with the server registered and a person's token lists
that person's clients, finds and reads a requirement of theirs, and is
refused a requirement of a client they may not read.
