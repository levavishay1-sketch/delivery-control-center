# Delivery Control Center — Roadmap

This is the durable, repo-level source of truth for what this product is
trying to become and what's been done toward it. It exists so that the
program's scope — the master goal, the gap analysis, and the plan for future
slices — never depends on chat history or survives only as a fading
conversation summary. See `docs/roadmap-sources/README.md` for why.

**Rule**: nothing goes in the "Slices" table below as more than a status
stub until its scope is backed by either a file in `docs/roadmap-sources/`
or an explicit, dated decision recorded in this file. No slice is scoped
from memory of a prior conversation.

## Master goal

**Corroborated** (independently, by `openspec/config.yaml`'s project
context, present since the initial commit — not just this document):

> Delivery Control Center pulls work items from Jira/Azure DevOps (or manual
> entry), runs each one through a Constitution → SPEC → Plan → Tasks →
> Deploy pipeline, records every draft/approval/rejection/cost in an
> append-only audit trail, and lets AI agents draft each stage while humans
> approve at every gate. End goal: transparent, gated, audited software
> delivery.

**Reconstructed — unverified** (recalled from a compacted conversation
summary only; no independent corroboration exists anywhere in the repo or
git history; treat as a lead to confirm, not as settled scope):

> The product is meant to be a control plane for a software house serving
> many clients — each client with multiple projects, separate codebases,
> environments, requirements, and integrations — not just the single-tenant
> SDD pipeline that exists today. A "Master Prompt" document described a
> fuller vision (~70 sections) including an "Attention Center", Blockers /
> Decisions / Dependencies as first-class tracked objects, and
> evidence-driven completion (work isn't "done" until backed by verifiable
> evidence, not just an approval).

## Gap analysis

**Reconstructed — unverified**, same caveat as above. At some point a
"Gap Analysis & Implementation Prompt" document compared the Master Prompt
vision against the as-built system and concluded the product was only the
**"engine room"** (the SDD pipeline itself) and was missing the broader
**delivery control plane**: multi-client tenancy, the Attention Center,
Blockers/Decisions/Dependencies as first-class objects, evidence-driven
completion, real authentication, a domain layer, and more. That document's
actual content — the full gap list, the acceptance criteria, the detailed
per-slice scope — was never saved and is not recoverable. Only the
six-slice shape below survived, as one-line paraphrases.

**Action needed**: if the original document (or a close reconstruction of
it) still exists outside this repo, save it verbatim to
`docs/roadmap-sources/` before scoping any slice from the table below.
Until then, every slice past Slice 0 is a stub, not a plan.

## Slices

| # | Name (as recalled) | Status | Scope source | Detail |
|---|---|---|---|---|
| 0 | Tenancy, Identity & Foundations | **Done** | `.claude/plans/tingly-riding-comet.md` (session-local plan file, not saved here — see note below) | `openspec/changes/archive/2026-08-14-slice-0-tenancy-and-identity/` |
| 1 | Delivery model / Attention Center | Not started — **scope stub only, do not implement** | None. One-line label only, unverified. | — |
| 2 | SDD subsystem upgrades | Not started — **scope stub only** | None. One-line label only, unverified. | — |
| 3 | Agent execution resources | Not started — **scope stub only** | None. One-line label only, unverified. | — |
| 4 | Connector framework | Not started — **scope stub only** | None. One-line label only, unverified. | — |
| 5 | Engineering evidence | Not started — **scope stub only** | None. One-line label only, unverified. | — |
| 6 | Configuration Center | Not started — **scope stub only** | None. One-line label only, unverified. | — |

**Note on Slice 0**: it predates this roadmap mechanism and has the same
gap retroactively — its plan (`.claude/plans/tingly-riding-comet.md`) lives
outside the repo in the local Claude Code plans directory, not in
`docs/roadmap-sources/`. It shipped successfully anyway because it was
scoped, approved, and executed within a single continuous session before
any compaction occurred. Future slices should not rely on that being true
again — hence the rule below.

## How a slice gets scoped from here on

1. **Source lands first.** If the user provides planning input (a document,
   a detailed description, a revision to existing scope), it is saved
   verbatim to `docs/roadmap-sources/<date>-<slug>.md` in the same turn,
   before any discussion of scope, design, or implementation.
2. **This file is updated to point at it.** The slice's row in the table
   above gets a real "Scope source" link and its status moves to "Scoped."
3. **The OpenSpec proposal cites it.** Every `proposal.md` for a roadmap
   slice includes a `## Roadmap Source` section (first section, before
   "Why") that names the `docs/ROADMAP.md` slice entry and quotes the
   specific `docs/roadmap-sources/` excerpt the scope comes from. This is
   enforced by a project rule in `openspec/config.yaml`
   (`rules.proposal`) — `openspec` instructions for a new proposal will
   surface it.
4. **`tasks.md` inherits it for free.** OpenSpec's existing spec-anchored
   discipline (see `CLAUDE.md`) already keeps `tasks.md` and
   `openspec/specs/` truthful to what's actually built, once `proposal.md`
   is itself traceable to a real source. The gap this roadmap fixes is
   entirely at the layer *above* OpenSpec — the multi-slice program OpenSpec
   changes are drawn from — not within it.
5. **When a slice finishes**, its status here moves to "Done" and its row
   links to the archived OpenSpec change, the same way Slice 0's does.

## Status legend

- **Not started — scope stub only**: a label exists, nothing else. Must not
  be scoped or implemented from this file alone.
- **Scoped**: a real source document exists in `docs/roadmap-sources/` and
  is linked from this file; ready for an OpenSpec proposal.
- **In progress**: an OpenSpec change is open for it.
- **Done**: archived; linked to the archive folder.
