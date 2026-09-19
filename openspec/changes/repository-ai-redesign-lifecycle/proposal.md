# Repository AI redesign lifecycle — a third onboarding mode for when the *tooling* changes, not just the code

Status: **proposed** — not implemented. Written up per this repo's own
methodology (`/opsx:propose → /opsx:apply → /opsx:archive`) because this
touches the onboarding schema, prompts, and plan logic broadly enough to
warrant review before code, the same way `repository-ai-enablement-v2`
itself was.

Appetite: **large**.

## Why

`repository-ai-enablement-v2` already has two run modes:

- **`initial`** — the first onboarding of a repository.
- **`refresh`** — deterministic staleness signals (a watched path changed,
  an artifact was hand-edited, a glob stopped matching, age > 90 days) →
  one AI judgement only when a signal fires → a targeted fix to the
  specific artifact whose *content* went stale.

Both answer the same question: **"is what we already decided still
accurate against the code?"** Neither answers a different one that came
up live, dogfooding this exact pipeline on a real repository: **"is the
*shape* of what we decided still the best shape, now that the tooling
itself has moved on?"**

Concretely: this pipeline's own methodology has already changed once
(16 stages → 9, `docs/ai/*.md` encyclopedia → on-demand skills) purely
because Claude Code's loading mechanics and best practice moved forward
— nothing in any onboarded repository's *code* had to change for that
verdict to flip. A repository onboarded before that shift is left
carrying artifacts shaped by the old thinking (a `docs/ai/architecture.md`
that predates skills existing as a concept at all) with no path back to
reconsideration, because:

- `refresh` only ever asks "does this specific artifact's *content* still
  match the code" — it has no concept of "should this exist in this
  *form* at all."
- `plan`'s artifact schema has exactly five kinds
  (`claude_md`/`nested_claude_md`/`rule`/`knowledge_skill|workflow_skill`/
  `agent`). A pre-existing file that predates the taxonomy — a loose
  `docs/ai/*.md`, for instance — cannot be proposed for removal or
  conversion, because it was never able to become a plan *item* in the
  first place. Found live: Discovery correctly flagged three `docs/ai/*.md`
  files as `conflicting`/`outdated` against the code, `plan`'s own
  `not_created` list explained *why* it couldn't act ("תיקון/מחיקת קבצי
  Markdown חופשיים בתיקיית docs/ אינו בתחום סוגי הארטיפקטים הנתמכים
  בסבב הזה") — the AI itself named the schema gap it was hitting.

## What changes

**A third mode: `redesign`.** Same nine stages, same human gates — this
is not a new pipeline, it's a different *posture* for `discovery` and
`plan` to take, selected at start time next to today's "רענון" /
"onboarding מלא מחדש" choice, plus one automatic trigger:

- **Manual**: a person requests it explicitly (e.g. "the team wants a
  structural review of our AI setup").
- **Suggested, never forced**: the lifecycle panel (which already surfaces
  refresh signals) additionally compares the repository's completed run
  against the current `ONBOARDING_METHODOLOGY_VERSION` and, on a mismatch,
  shows a dismissible suggestion — never an automatic run. Nothing about
  crossing a version boundary implies the old setup is *wrong*; it implies
  it's worth a look.

**Discovery's redesign posture**: in addition to today's operating-model
read, it is handed the FULL current artifact set (every file the
inventory finds, not just the ones `existing_instructions_assessment`
already checks for accuracy) and asked a different question per artifact:
not just "is this accurate" but "given what Claude Code and this
methodology can do today, is this still the *right kind of thing*" —
e.g. "this is a loose docs/ai file predating skills; propose superseding
it," or "this rule's scope now overlaps a skill; propose consolidating."

**Plan's redesign posture**: a new artifact kind, `legacy_artifact`, for
exactly the case that has no home today — an existing AI-facing file
that isn't a claude_md/rule/skill/agent DCC recognizes (a loose docs/ai
markdown file today; a future taxonomy leftover after the *next*
methodology shift). Its only actions are `keep` (with a stated reason),
`superseded_by` (pointing at the plan item that replaces it — usually a
new or updated skill), or `remove`. Nothing about this kind writes new
prose; it only lets removal/supersession enter the same human-reviewed
plan gate every other artifact already goes through — full visibility,
full "no silent actions," same as today.

**Everything else is unchanged.** `generate`/`validate`/`review`/`deliver`
don't know or care which mode produced the plan they're given; a
`legacy_artifact` marked `remove` goes through the exact same
`action: "remove"` deterministic path `generate` already has for a
reviewer's per-file drop.

## What does not change

- The five foundational decisions.
- `refresh`'s own job — content-staleness-against-code detection stays
  exactly as it is; `redesign` is additive, not a replacement.
- No artifact is ever removed without appearing in a plan a human
  approves — `legacy_artifact` is a schema addition to make a proposal
  *possible*, not a new automatic-deletion path.

## Open questions

- Should `redesign` require the same explicit `consent: true` an
  `automatic` policy run already requires for auto-resolved gates, given
  it can now propose deleting more than just newly-generated content? —
  leaning yes, but not decided here.
- How a version mismatch is computed when a repo's last run predates
  `onboardingVersion` being tracked at all (pre-v2 rows) — likely "any
  v1 row is always a redesign candidate," but not decided here.
- Whether `legacy_artifact`'s `superseded_by` needs to be a hard
  validate-time check (does the pointed-to item actually exist in the
  same plan) or stays advisory text — leaning toward a hard check, given
  how much churn a dangling reference already cost in `referenced_paths`.
