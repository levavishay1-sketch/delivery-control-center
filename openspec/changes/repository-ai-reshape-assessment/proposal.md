# Repository AI reshape assessment — no new mode, no new screen

Status: **proposed** — not implemented. Written up per this repo's own
methodology (`/opsx:propose → /opsx:apply → /opsx:archive`) because this
touches Discovery's schema and Plan's artifact taxonomy broadly enough to
warrant review before code, the same way `repository-ai-enablement-v2`
itself was. Revised once already (see history below) toward the smallest
version that solves the real problem.

Appetite: **medium** (revised down from *large* — see revision history below).

## Why

`refresh` and every normal onboarding run already ask, per existing
AI-facing artifact, "is this still *accurate* against the code" (the
`existing_instructions_assessment` this pipeline already computes on
every Discovery call, not a special one). Found live, dogfooding this
exact pipeline: that's not the only question worth asking. This
pipeline's own methodology has already changed once — 16 stages → 9,
a `docs/ai/*.md` encyclopedia → on-demand skills — purely because Claude
Code's loading mechanics and best practice moved forward, not because
any repository's *code* changed. A repository onboarded before that
shift is left carrying artifacts shaped by the old thinking (a
`docs/ai/architecture.md` that predates skills existing as a concept at
all), with no path back to reconsideration, because:

- The existing assessment only ever judges *content* accuracy — it has
  no concept of "should this exist in this *form* at all," only
  keep/merge/outdated/conflicting.
- `plan`'s artifact schema has exactly five kinds
  (`claude_md`/`nested_claude_md`/`rule`/`knowledge_skill|workflow_skill`/
  `agent`). A pre-existing file that predates the taxonomy — a loose
  `docs/ai/*.md`, for instance — cannot be proposed for removal or
  conversion, because it can never become a plan *item* in the first
  place. `plan`'s own `not_created` list said so explicitly on a real
  run: "תיקון/מחיקת קבצי Markdown חופשיים בתיקיית docs/ אינו בתחום סוגי
  הארטיפקטים הנתמכים בסבב הזה" — the AI itself named the schema gap it
  was hitting.

## What changes

**No new run mode, no new stage, no new screen the person has to learn.**
The whole point is that this shows up as one more row in the plan table
a person already reviews on every run — not as a decision to opt into.

- **Discovery's existing `existing_instructions_assessment`** — the same
  field, same call, every normal run (`initial` or `refresh` alike) —
  gets one more axis alongside its current verdict: `reshape`
  (`"none"` | `"supersede_with_skill"` | `"consolidate_with:<path>"`).
  No extra AI call, no extra read: Discovery is already reading these
  files to judge accuracy: this is one more question on the same pass.
- **`plan` gets a new artifact kind, `legacy_artifact`**, for exactly the
  case with no home today: an existing AI-facing file that isn't a
  claude_md/rule/skill/agent DCC recognizes. Its only actions are `keep`
  (stated reason), `superseded_by` (pointing at the plan item that
  replaces it — usually a skill), or `remove`. When Discovery's
  `reshape` fires, `plan` proposes one of these the same way it proposes
  every other item today — same table, same checkboxes, same approval
  gate a person already uses.
- **A small, optional nudge, not a gate**: the lifecycle panel (which
  already surfaces refresh signals) additionally notes, informationally,
  when `ONBOARDING_METHODOLOGY_VERSION` has moved on since the repo's
  last run — "worth running a check" — dismissible, never forcing
  anything, never a required step.

**Everything else is unchanged.** `generate`/`validate`/`review`/`deliver`
don't know or need to know that a `legacy_artifact` item exists; marked
`remove`, it goes through the exact same `action: "remove"` deterministic
path `generate` already has for a reviewer's per-file drop.

## What does not change

- The five foundational decisions.
- The existing accuracy assessment's own job — `reshape` is an added
  field on it, not a replacement.
- No artifact is ever removed without appearing in a plan a human
  approves — `legacy_artifact` is a schema addition that makes a
  proposal *possible*, never a new automatic-deletion path.
- No new choice at run-start, no new stage in the nine-stage stepper.

## Open questions

- Whether `legacy_artifact`'s `superseded_by` needs a hard validate-time
  check (does the pointed-to item actually exist in the same plan) or
  stays advisory text — leaning toward a hard check, given how much
  churn a dangling reference already cost in `referenced_paths`.
- How to phrase the lifecycle-panel nudge for a repo whose last run
  predates `onboardingVersion` being tracked at all (pre-v2 rows) —
  likely "any v1 row always gets the nudge," not decided here.

## Revision history

- **First draft**: proposed a third run mode (`redesign`), selected at
  start alongside `initial`/`refresh`, with Discovery and Plan taking a
  distinct "posture" only in that mode. Reconsidered after direct
  feedback: since Discovery already reads every existing artifact for
  accuracy on every normal run, asking one more question on that same
  read costs nothing extra and needs no separate mode, screen, or
  decision for a person to learn — the smaller version above does
  everything the mode would have, with no added surface area.
