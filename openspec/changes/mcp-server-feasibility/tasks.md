# MCP server feasibility — tasks

Appetite: **small** (this is a spike, not a build).

- [x] 1.1 List candidate tools an MCP server would expose (search
      requirements/tasks/gaps, approve, progress, etc.) and separate
      read vs. write — see `proposal.md` § Assessment
- [x] 1.2 List candidate callers (DCC's own dashboard search bar; an
      external Claude Code session working in a client repo; others?) —
      see `proposal.md` § Assessment (also flags that the "dashboard
      search bar" use case doesn't actually need MCP)
- [x] 1.3 Sketch how it would sit next to the existing `apps/api`
      Fastify service — same process, separate service, thin wrapper? —
      recommends a separate `apps/mcp` process, thin over `packages/core`
- [x] 1.4 Write the recommendation and bring it back for a decision —
      done: read-only first, no write tools until real (Entra ID) auth
      replaces the current hook-token pilot shim, and confirm with the
      user which of the two named use cases they actually want before
      scoping an implementation change. **Decision is the user's — not
      made here.**
