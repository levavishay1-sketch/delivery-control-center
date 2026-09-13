# MCP server for DCC — feasibility

Status: **spike complete, decision made** — the user decided 2026-09-12
to build it, following this spike's own recommendation (read-only
first). See `mcp-server` for what was actually built.

## Why

An MCP server exposing DCC itself would let other tools (Claude Code,
Claude.ai, other MCP-aware clients) interact with DCC's data directly —
one concrete use the user named: a dashboard search bar backed by MCP
tool calls instead of (or alongside) DCC's own REST API. Worth
evaluating; not yet decided this is the right direction.

## What "done" looks like for the spike (not the feature)

- A short written assessment: what an MCP server would expose (read
  tools against gaps/tasks/requirements? write tools like approve/
  progress? both?), who the intended callers are (DCC's own web UI? an
  external Claude Code session? both?), and what it would take to stand
  one up against the existing `apps/api` Fastify service.
- A recommendation: worth building, not worth it yet, or worth it for a
  narrower slice than "the whole API."

## Explicitly out of scope (until the spike concludes)

- Any implementation. This stays a research question until answered.

## Impact

None yet — this is a research/decision task, not a code change.

## Assessment (spike result)

Grounded in the actual `apps/api` Fastify service and its auth model
(`apps/api/src/context.ts`), not a generic MCP writeup.

### Candidate tools — read vs. write

**Read** (low risk, genuinely useful, no new business logic — each maps
straight onto an existing `packages/core` function):
- `search_requirements(clientId?, query, phase?)` — title/notes lookup
- `get_requirement(id | key)` — full detail (`workitemDetail`)
- `get_timeline(id)` — the event log
- `get_tasks(requirementId)` — task-flow hierarchy
- `get_cost_summary(id)` — `requirementCostSummary`
- `get_gaps(requirementId)`, `get_blockers(requirementId)`
- `list_ado_tasks(clientId)` — the TFS cross-client mirror

**Write** (real stakes — see "the hard part" below):
- `add_note(requirementId, body)`
- `approve_task` / `progress_task`
- `answer_gap` / `verify_gap`
- `start_breakdown` / `start_assess` — flagged as architecturally odd on
  its own: these already spawn a separate headless `claude -p`
  subprocess (`ai-assist.ts`'s `runClaudeJson`). An MCP tool call FROM
  one Claude session kicking off ANOTHER Claude subprocess run, whose
  result the calling session doesn't see until it polls back, is a
  recursion pattern worth designing deliberately, not backing into.

### Candidate callers

- **DCC's own web dashboard search bar** — the use case the user named,
  but worth naming a mismatch back: MCP connects an LLM *host* (Claude
  Code, claude.ai, Claude Desktop) to tools. A REST-served React SPA is
  not such a host, so "the browser calls MCP tools" isn't literally how
  this works. What the user is actually asking for is more likely an
  AI-powered search feature *inside* the web app — which would have the
  web app's own backend call Claude with tool-use against `apps/api`'s
  *existing* REST endpoints. That doesn't need the MCP protocol at all.
- **An external Claude Code session already working in a client's
  repo** — the strongest fit, and the one MCP is actually built for.
  Today the data flow is one-directional: DCC shells out to a person's
  local `claude` CLI (`ai-assist.ts`). The reverse direction — a
  developer's own interactive Claude Code session, already open in the
  client's repo, reaching INTO DCC to check a task's status, read its
  Context Brief, or see cost-to-date without alt-tabbing to the DCC web
  UI — is a genuinely new, additive capability.
- **claude.ai web, via a custom connector** (future, org-permission
  gated) — e.g. a PM asking claude.ai "what's blocking WI-1284" without
  opening DCC. Real, but a later step than the internal-developer case
  above.

### How it would sit next to `apps/api`

Either way, an MCP server should be a **thin transport adapter over
`packages/core`**, exactly the same relationship `apps/api` already has
to `packages/core` — never a second copy of the business logic.

- **(a) A separate process** (`apps/mcp`), same `@dcc/core`/`@dcc/db`
  dependencies, its own small entrypoint on the official MCP TypeScript
  SDK (stdio for a local Claude Code caller, HTTP transport for a
  remote one). Cleanest separation; an MCP server crashing or
  misbehaving can never take down the REST API the pilot's web UI
  depends on.
- **(b) Routes mounted inside the existing `apps/api` Fastify process**,
  via an MCP-over-HTTP transport. Fewer processes to run/deploy, but
  couples MCP's request lifecycle to the REST API's — a bad MCP client
  interaction becomes a REST API incident too.

**Recommendation: (a).** Matches how this repo already separates
concerns (`apps/web`, `apps/api` as siblings) and keeps the blast radius
of an early, unproven feature away from what pilot clients already rely
on.

### The hard part is identity, not wiring

DCC's own non-negotiable #2 (`openspec/project.md`) is **"Identity is
always a real person — every AI action runs as a named user's Claude
identity, even background work."** `apps/api`'s current request auth
(`actingUser` in `context.ts`) is a shared `x-dcc-hook-token` secret
plus an `x-dcc-dev-email` header the caller self-reports — explicitly
documented in that file as *"Phase 0 ... NOT production auth — a pilot
shim."* That shim is fine for a trusted local dev harness calling its
own API. It is NOT strong enough to hand to an arbitrary external MCP
client and call the resulting actions "a named real person" — an MCP
caller can claim to be anyone via that header today.

Multi-tenancy has the same shape: every query already goes through
`withTenant()` (RLS as an independent backstop, non-negotiable #3) — an
MCP tool's `clientId` argument needs the exact same "wall between
clients is absolute" treatment, no MCP-specific exception.

### Recommendation

**Worth building, but narrower than "the whole API," and not yet.**

1. Start **read-only** — the tool list above, nothing that writes.
   Genuinely useful today (checking a requirement from inside a Claude
   Code session without alt-tabbing), and it sidesteps the identity
   question almost entirely: reading data as "some authenticated DCC
   user" is a much smaller trust decision than writing/approving as one.
2. **Do not expose write tools until real auth (Entra ID) lands.**
   Writes need the same "always a named real person" + tenant-isolation
   guarantee the REST API is designed to eventually get; the current
   hook-token shim can't honestly provide that to an external MCP
   client.
3. **Separate the two use cases the user's framing conflated.** The
   "dashboard search bar" is better served by an in-app AI search
   feature (no MCP needed) than by an MCP server; the MCP server itself
   is worth building for the "external Claude Code session reaching
   into DCC" case. Worth confirming with the user which one they
   actually want before scoping further — this spike answers "is an MCP
   server the right shape," not "which of these two features to build."
