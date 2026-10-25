# MCP server feasibility — tasks

Appetite: **small** (this is a spike, not a build).

- [x] 1.1 List candidate tools an MCP server would expose (search
      requirements/tasks/gaps, approve, progress, etc.) and separate
      read vs. write — see `proposal.md` § Assessment
- [x] 1.2 List candidate callers (DCC's own dashboard search bar; an
      external Claude Code session working in a client repo; others?) —
      see `proposal.md` § Assessment (also flags that the "dashboard
      search bar" use case doesn't actually need MCP)
- [x] 1.3 Sketch how it would sit next to the DCC API — the same process or
      a separate one — recommends a separate process that calls the REST API
- [x] 1.4 Write the recommendation and bring it back for a decision —
      read-only first, as a known person; write tools only by a later,
      explicit decision; keep the dashboard search bar apart. **The decision
      was the user's** (2026-09-12: build it).
