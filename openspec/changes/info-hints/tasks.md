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

- [ ] 2.1 Requirement (list, record, workflow tab, task)
- [ ] 2.2 Pull requests (list, detail, branches) and repositories
- [ ] 2.3 Clients, dashboard, alerts, budgets, audit trail, settings, prompts
- [ ] 2.4 The Claude control center
- [ ] 2.5 Onboarding, flow, task graph, code map, file compare
- [ ] 2.6 One shared wording pass: duplicates and near-duplicates merged, the length limit met, no term left unexplained
- [ ] 2.7 API restarted once; every screen opened and its "i" pressed; typecheck and audit green

## 3. After merge

- [ ] 3.1 The wishlist idea "פרויקט i" is deleted once its pull request has merged (the database move stays as its own entry)
