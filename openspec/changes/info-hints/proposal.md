# Info hints — an "i" on everything that needs explaining

Status: **in progress** — see `tasks.md`.

Appetite: **medium**.

## Goal

A person who is not fluent in developer concepts can press an **"i"** next to
any card, section title, figure or non-obvious field and read, in one or two
plain Hebrew sentences, what it is. A new screen or component arrives with
that "i" already, without anyone having to remember to add it.

Every wording lives in **one** place and is keyed by **concept**, not by
screen: "עלות AI" says the same thing on the requirement, the dashboard and the
budgets screen, because it is one entry that all three point to.

## What this change does

- **One registry, keyed by concept** (`packages/core/src/glossary/`). An entry
  is flat — `key`, `kind`, `title`, `explain`, and for a button `press` — so it
  maps one-to-one to a table row later. Screens no longer own entries: a
  screen lists the concept keys it shows, and the chat answers about that
  screen from the same entries. Everything reads through one access surface
  (`getConcept`, `allConcepts`, `glossaryFor`), never the array directly.
- **The glyph is the letter "i"**, in one shared web component, `Info`
  (`apps/web/src/claude/Info.tsx`), which reads the whole registry once from
  `GET /claude/glossary`.
- **Shared components carry their own "i".** `PageHead`, `CardTitle` (the one
  card / section heading, replacing the ad-hoc `h4` / `card-title` / `w-title`
  headings), `StatTile` and the labelled `Field` take an `info` prop. It is
  required on the heading components, so a title without an explanation is
  a decision written in the code (`info={null}`), not an omission.
- **The rule is enforced by `npm run audit:stale`**: the registry is
  well-formed (unique keys, non-empty text, an explanation short enough to
  read at a glance, a `press` for every button), every key a screen uses
  exists, every screen registered with the chat has a glossary, a screen
  contains no raw `h1`–`h4` heading that bypasses the shared components, and
  no label, table column or figure names something while opening no
  explanation. A hook says the same thing at the moment a screen is saved.
- **An explanation that stopped being true is surfaced, not left to be
  believed.** `npm run info:drift` prints the explanations sitting on the
  lines a change touched, with their current wording, and asks whether the
  meaning changed — run before a pull request that touches a screen, and part
  of the `reviewer` subagent's pass. The slower signal: a repeated question
  in the control center now names the concept it is about, so a question that
  keeps coming back about an element that already has an "i" says the hint is
  the suspect rather than the screen.
- **Every existing screen is brought in**: the wording is written for all
  screens in the same pass, so the rule starts from a system that already
  follows it.
- **The rule for future work is written in the repository**, not only in
  someone's memory: a section in `CLAUDE.md` and a skill in `.claude/skills/`
  (`info-hints`) that says how to add a concept, how to word it, and which
  elements get an "i".

## Not in this change

- The registry stays **in code**. Moving it to the database (so wording can be
  edited without a release, with a per-client override) is on the wishlist; the
  shape above — one access surface, concept keys, flat fields — is what keeps
  that move small.
- An "i" on every button. A button explains itself by its name and gets an "i"
  only when pressing it is irreversible, costs money, writes to an outside
  system, or is otherwise not what its name suggests. Too many hints turn into
  noise.

## Impact

- `packages/core/src/glossary/` restructured; `chat/`, `insights.ts` and the
  API's `/claude/glossary/:screen` read through the same surface; a new
  `GET /claude/glossary`.
- `apps/web`: `Info` replaces the old hint component; `ui.tsx` / `forms.tsx`
  shared components gain `info`; every screen's headings move to `CardTitle`.
- `scripts/audit-stale.mjs`, `CLAUDE.md`, `.claude/skills/info-hints/`.
- No migration and no schema change.

## Exit gate

`npm run typecheck` and `npm run audit:stale` are green; every screen in the
app has its title, its cards and its figures explained by an "i", and each
opens the same sentence the chat gives for that concept; no screen names a
concept that has no entry; and the API was restarted once per stage and
answered `/health` with the screens loading afterwards.
