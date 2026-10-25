# MCP server for DCC — feasibility

Status: **spike complete, decision made** — the user decided on 2026-09-12 to
build it, read-only first, as this spike recommends. See `mcp-server` for the
server DCC has.

## Why

An MCP server exposing DCC lets MCP-aware tools (Claude Code, claude.ai,
Claude Desktop) work with DCC's data directly. The user named one use: a
dashboard search bar backed by MCP tool calls. The spike asks whether MCP is
the right shape, for which callers, and what it takes.

## What "done" looks like for the spike (not the feature)

- A short assessment: which tools (read, write, or both), who calls them, and
  how the server sits next to the DCC API.
- A recommendation: worth building, not yet, or a narrower slice than "the
  whole API".

## Explicitly out of scope

- Any implementation — that is `mcp-server`.

## Impact

None — a research and decision task, not a code change.

## Assessment

### Candidate tools — read vs. write

**Read** — low risk and useful; each one is data the web already reads
through a REST `GET`:
- `list_clients` — to get a `clientId` for the others
- `search_requirements(clientId, query)` — a title lookup
- `get_requirement(id)` — the requirement page
- `get_timeline(id)` — the event log
- `get_cost_summary(id)` — what its AI work cost
- later candidates: a requirement's tasks, its gaps and blockers, the TFS
  task mirror

**Write** — real stakes:
- `add_note(requirementId, body)`
- approve or progress a task
- answer or verify a gap
- start an assessment or a breakdown — architecturally odd on its own: the
  tool call from one Claude session would start another Claude run, whose
  result the caller sees only by polling back, and spend money from there. A
  recursion to design deliberately, not to back into.

### Candidate callers

- **An external Claude Code session already working in a client's
  repository** — the strongest fit, and the one MCP is built for. DCC already
  calls a person's `claude`; this is the reverse direction: the developer's
  own session reaching into DCC to check a requirement, its timeline or its
  cost without switching to the web UI.
- **claude.ai through a custom connector** — e.g. a PM asking "what's
  blocking WI-1284" without opening DCC. Real, but later; it needs an HTTP
  transport, not stdio.
- **The web's own search bar** — the use the user named, but not an MCP
  case: MCP connects an LLM *host* to tools, and a React app is not such a
  host. An AI search inside the web app would have the server call Claude
  with tools over the existing REST API — no MCP needed.

### How it sits next to the API

- **(a) A separate process that calls the REST API.** It holds no database
  connection, so it can never read past the API's own permission checks, and
  a misbehaving MCP client can never take down the API the web depends on.
  stdio for a local Claude Code session.
- **(b) An MCP-over-HTTP endpoint inside the API.** Fewer processes, and what
  a remote caller needs — but every tool must then check permissions itself,
  and an MCP client's trouble becomes an API incident.

**Recommendation: (a).** (b) only when there is a real remote caller.

### The hard part is identity, not wiring

Non-negotiable: **identity is always a real person** — every action runs as
a named person, and the wall between clients is absolute. An MCP caller must
therefore be a known person, not whoever it claims to be, and an MCP tool's
`clientId` gets the same wall as any other request, with no MCP exception.
The API's personal API tokens (`dcc_pat_…`, checked live; a delegated agent's
token never exceeds its owner) give exactly that: the server calls the API as
the token's person.

### Recommendation

**Worth building — narrower than "the whole API".**

1. Start **read-only**, the read tools above. Useful at once, and reading as
   a known person is a much smaller trust decision than acting as one.
2. **Write tools only by a later, explicit decision** — they add attribution
   of actions and spending to the question.
3. **Keep the two uses apart.** The dashboard search bar is an in-app AI
   feature; the MCP server is for the external Claude Code session.
