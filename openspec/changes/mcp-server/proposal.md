# MCP server for DCC — v1 (read-only)

Status: **built, read-only v1 shipped 2026-09-12.** Follows
`mcp-server-feasibility`'s spike and recommendation. The user's decision
(2026-09-12): "כן בונים MCP מלא. השאלה אם לבנות אותו עכשיו או בסיום
המערכת זה אתה תחליט" (yes, build a full MCP; timing is this session's
call). Decided: start now, but sequence it exactly as the feasibility
spike recommended — read-only first, write tools deliberately withheld
until real auth exists to back them.

## Why (unchanged from the spike)

An MCP server exposing DCC lets an external Claude Code session (the
strongest identified use case: a developer already working in a
client's repo) query DCC's data directly — a requirement's status, its
timeline, its AI cost — without alt-tabbing to the web UI.

## What shipped

A new `apps/mcp` workspace package — a thin, stdio-transport MCP server
over `packages/core`/`@dcc/db`, the same relationship `apps/api` already
has to those packages. Five read-only tools:

- `list_clients` — every client this instance manages (needed to get a
  `clientId` for the others)
- `search_requirements(clientId, query)` — title substring search
- `get_requirement(id)` — full detail: fields, gaps, blockers, tasks,
  attachments, repos, full event timeline (mirrors the web UI's
  requirement page / the REST API's `GET /workitems/:id`)
- `get_timeline(id)` — just the event log
- `get_cost_summary(id)` — cumulative AI cost, by kind

## Why read-only, and why not later

DCC's own non-negotiable #2 is "every AI action runs as a named user's
Claude identity, even background work." `apps/api`'s current auth
(`actingUser` in `context.ts`) is explicitly documented as *"Phase 0 ...
NOT production auth — a pilot shim"* — a shared secret plus a
self-reported email header. That's acceptable for a trusted local dev
harness calling its own API; it is not strong enough to hand to an
external MCP client and call the resulting WRITE actions "a named real
person." Read tools don't carry that requirement — reading data doesn't
need to be attributed to anyone, matching how the equivalent REST `GET`
routes already work today (no acting-user resolution either). Write
tools (approve, progress, compose) stay explicitly out of this v1 until
real (Entra ID) auth replaces the shim — building them now would mean
either leaving them genuinely unsafe or inventing a throwaway auth
mechanism nobody would keep.

## Explicitly out of scope (this v1)

- Any write tool (approve_task, progress_task, add_note, start_breakdown,
  ...) — see above.
- Deployment/packaging (how a developer actually gets this server
  registered in their own Claude Code config) — this ships the server
  itself; wiring it into someone's local `.mcp.json` is a separate,
  per-developer step, not a DCC repo concern.
- The "dashboard search bar" use case the user originally named — the
  feasibility spike already flagged this doesn't actually need MCP (an
  in-app AI search feature would call the existing REST API directly);
  unaffected by this build.

## Impact

- New workspace package `apps/mcp`, added to the root `tsconfig.json`
  references and `package.json` workspaces (already covered by the
  existing `apps/*` glob).
- New dependency: `@modelcontextprotocol/sdk` (installed, pinned in
  `apps/mcp/package.json`).
- No changes to `packages/core`'s public surface beyond what was already
  exported — the MCP tools compose existing exports, per the
  feasibility recommendation to keep this a thin adapter.

## Exit gate

`npx tsx apps/mcp/src/server.ts` (or `npm -w @dcc/mcp run dev`) starts a
working MCP server over stdio that a Claude Code session can register
and query — search/read a requirement's data without opening the DCC
web UI.
