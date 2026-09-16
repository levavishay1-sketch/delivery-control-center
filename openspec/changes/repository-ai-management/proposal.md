# Repository AI management

Status: **implemented (core loop), scoped down from the full spec** — see
`tasks.md` for exactly what shipped vs. what's deliberately deferred.

## Why

DCC tracks requirements and tasks, but a Repository itself was just a Git
pointer — nothing in DCC knew what AI tooling (Skills, Agents, MCPs,
hooks, methodologies) already existed in a repo, and nothing DCC-authored
carried forward from one Task execution to the next. Every `claude -p`
call DCC makes (assess/breakdown/implement) started from the requirement
text alone, rediscovering the repository from zero every time.

## What changed

A Repository can now be put under **AI management**: DCC scans it
(deterministically, no model call) for the AI components it actually
contains, keeps a synced — never duplicated — record of them in a
global, cross-client catalog, and can build an evidence-backed
**Knowledge Baseline** (Claude reads the repo, produces a structured
summary) that's automatically injected into every subsequent
assess/breakdown/implement prompt for Tasks on that repo.

Full source spec (18 sections + 7 prompt-template appendix, supplied by
the user 2026-09-14) described a much larger system: an automated
internal-fit + external-research recommendation engine (P3A/P3B), a
formal MANDATORY/CONDITIONAL/ON_DEMAND component-activation model, a
review scheduler, and Experience Records feeding back into future
recommendations. **This pass deliberately built the real, working core
loop — inventory, knowledge, task-execution inheritance — and left the
automated-recommendation engine and activation-mode governance for a
deliberate follow-up**, rather than fabricate a research/decision engine
with no real internal-experience corpus behind it yet. See tasks.md for
the precise line.

## Decisions carried over from the user (2026-09-14)

1. No `Project` entity — DCC's real hierarchy is `Organization → Client
   → Repository → WorkItem → Child WorkItems`. The resolver order is
   `global → client → workitem`, Repository inserted where the spec's
   Project scope would have gone.
2. **A Repository belongs to exactly one Client.** No shared
   Repository/profile model — `repo.clientId` must be set (not the
   NULL/org-shared case that already exists elsewhere in the schema) for
   AI management to start on it. Rejected explicitly, not silently.
3. **The Repository is the source of truth for its own AI components.**
   DCC keeps no second copy of a Skill/Agent/MCP's own files — only a
   synced record of type/name/where-found. A component appears in the
   global catalog the moment any repo has it; it's never deleted from
   the catalog, just left at zero active repos, once none do.
4. **Repository Knowledge is separate from the components themselves** —
   it describes the repo, it isn't a mirror of its tooling. Storage kept
   deliberately flexible (structured DB rows now, not committed into the
   client's own repository) per the explicit instruction to keep this
   adjustable later.
5. **`/init` investigated, not asked about.** The Claude Code CLI has no
   `init` subcommand — `/init` is a built-in slash command that resolves
   headlessly the same as interactively. Verified live:
   `claude -p "/init" --permission-mode acceptEdits --allowed-tools
   "Read,Grep,Glob,Write,Edit"` against a throwaway repo produced a real
   `CLAUDE.md` and exited 0 — same `runClaudeRaw` mechanism as every
   other write-mode call in this codebase, not a new one.

## Explicitly out of scope this pass

- The automated P3A (internal fit) / P3B (external research) engine —
  needs a real "Company Standards" concept and an internal-experience
  corpus neither of which exist yet; building the research/comparison
  logic blind would be fabrication, not implementation.
- MANDATORY/CONDITIONAL/ON_DEMAND component activation modes — Task
  execution today gets the repo's knowledge + a list of what's already
  there (so it doesn't propose re-adding something present), not a
  governed per-component activation policy.
- Independent P5 validation, Experience Records, the periodic review
  scheduler.
- Committing generated knowledge into the client's own repository (the
  spec's own default) — kept DB-side per decision #4 above.

## Impact

- `packages/db` — 6 new tables (`repo_ai_profile`, `ai_component`,
  `repo_ai_component_link`, `repo_knowledge_snapshot`,
  `repo_ai_recommendation`, `repo_ai_event`), migration `0029`.
- `packages/core/src/repo-ai/*` — new module: inventory scanner + sync,
  knowledge generation, `/init` bootstrap, the execution-profile
  resolver, lightweight recommendations, the global catalog.
- `packages/core/src/ai-assist.ts` — `runClaudeJson` split into
  `runClaudeRaw` (text + meta) + a thin JSON-parsing wrapper, both now
  exported; `ensureCheckout`/`git` exported; the three prompt builders
  (`buildAssessPrompt`/`buildBreakdownPrompt`/`buildImplementPrompt`)
  additively prepend the resolved repo AI profile.
- `apps/api` — `/repos/:id/ai*` routes, `/ai-components*` routes.
- `apps/web` — `RepoAiPanel.tsx` (opened from `ClientDetail.tsx`'s
  Repositories card), `AiComponents.tsx` (new nav item, global catalog).

## Exit gate

A Repository under AI management shows what AI tooling it actually
contains (synced, not duplicated) and a Claude-generated knowledge
summary; a Task execution against that Repository's requirement
automatically receives both in its prompt, without a person re-pasting
context DCC already has.
