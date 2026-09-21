# Info hints — tasks

Appetite: **medium**. Two stages; every stage leaves the system whole.
Branch: `project/info-hints` — commits land on it directly, one PR to `master`
at the end.

## 1. Foundation

- [x] 1.1 `@dcc/core` `glossary/`: registry keyed by concept, split into `concepts/<area>.ts`; the access surface (`getConcept`, `allConcepts`, `glossaryFor`); screens as lists of concept keys; the step-zero matcher and `glossaryAnswer` unchanged in behaviour; kind `section`
- [x] 1.2 Existing entries of the seven screens moved onto concept keys, duplicates merged
- [x] 1.3 API: `GET /claude/glossary` (every concept); `/claude/glossary/:screen` kept for the chat
- [x] 1.4 Web: `Info` component — the letter "i", one fetch, opens on click, closes outside; the old hint component removed
- [x] 1.5 Web: `info` prop on `PageHead`, `CardTitle` (new), `StatTile`, the labelled field
- [x] 1.6 `audit:stale`: registry well-formed, used keys exist, chat screens have a glossary, no raw `h1`–`h4` in screens, the retired name of the old hint component added
- [x] 1.7 Rule for future work: `CLAUDE.md` section and `.claude/skills/info-hints/`
- [x] 1.8 API restarted once; `/health` and a real screen checked; typecheck and audit green

## 2. Every screen

- [x] 2.1 Requirement (list, record, workflow tab, task)
- [x] 2.2 Pull requests (list, detail, branches) and repositories
- [x] 2.3 Clients, dashboard, alerts, budgets, audit trail, settings, prompts
- [x] 2.4 The Claude control center
- [x] 2.5 Onboarding, flow, task graph, code map, file compare
- [x] 2.6 One shared wording pass: no two concepts share a title any more (the six that did were renamed so each hint reads on its own), every explanation is under the limit (longest 154 characters, median 100), and no English title is left without a Hebrew alias
- [x] 2.7 API restarted (once per wave of registry changes, each time confirmed on /health and on a real screen); dashboard, requirements, requirement record, pull requests, repositories, budgets, settings and the control center opened and their "i" pressed; typecheck and audit green. Worth knowing: the web reads the registry once per page load, so after an API restart a tab that was already open keeps the old wording until it is reloaded

## 3. Keeping it true over time

The two questions the user asked once the wording was done: how will a **new**
element get an "i" by itself, and how will an **old** one be noticed when the
thing it describes changes. They have different answers — see `design.md` §6
and §9.

- [x] 3.1 `scripts/info-lint.mjs` — the one place that knows what "names something" means, read by both the audit and the hook so they cannot drift apart
- [x] 3.2 `audit:stale` gains completeness: a label, a table column or a figure that names something and opens no explanation is a failure. `{/* no-info: why */}` is the opt-out, and the audit counts them, so an opt-out cannot quietly become the norm
- [x] 3.3 The 56 elements the new check found, all resolved: an "i" where it adds meaning — 12 new concepts (סוג הפעולה, תוצאת הקריאה, עלות לשאלה, טוקנים לתור, גוף הפרומפט, מודל ברירת מחדל, כותרת / intent, המשך שנשאר, עומק הבדיקה, הפקודה, פערים שטופלו, שואלים על משהו שכבר מוסבר) — and an opt-out with a written reason where the name already is the explanation (29)
- [x] 3.4 `hooks/info-hint-check.mjs` — PostToolUse on Edit / Write of a screen, says it at save time so the fix costs one line, never blocks. Registered in `.claude/settings.json`; hook config is snapshotted at session start, so it starts firing in the next session
- [x] 3.5 `npm run info:drift` — from `git diff -U0`, the explanations sitting within three lines of what a change touched, printed with their current wording so a person answers the one question a check cannot: did the meaning change? A prompt, not a gate, and the reason why is in `design.md` §9
- [x] 3.6 The slow signal closed: an insight cluster now names the concept its repeated question is about, derived at read time with the chat's own matcher and never stored. The control center says in words that the explanation is the suspect rather than the screen
- [x] 3.7 Wired where it will be read: `CLAUDE.md`, the `info-hints` skill, and the `reviewer` subagent, for which a stale explanation is a blocking finding

## 4. After merge

- [ ] 4.1 The wishlist idea "פרויקט i" is deleted once its pull request has merged (the database move stays as its own entry)
