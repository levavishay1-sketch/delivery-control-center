# Pull request center — tasks

Appetite: **large**. Order: data → provider seam → sync → screens → actions →
Azure DevOps → verification. Tick each task as it lands.

## 0. Groundwork

- [x] 0.1 Five mockups approved with the user: list, request, live timeline, update-branch action, branch map
- [ ] 0.2 Spike: `gh` from the API process — list, compare and checks for one repository, and what each call costs in time

## 1. Database · `@dcc/db`

- [ ] 1.1 Migration: `pull_request`, `pull_request_event`, `pull_request_seen`, `repo_git_state` — each with `client_id`, RLS policy and the indexes the list query needs
- [ ] 1.2 Drizzle schema + `appendPullRequestEvent()` as the only writer of the event table
- [ ] 1.3 Applied to local PGlite with the API stopped; `dev:prove` still green

## 2. Provider seam · `@dcc/core`

- [ ] 2.1 `PullRequestProvider` type and the shared model (states, review decision, check state) that both hosts reduce to
- [ ] 2.2 `connectionFor(userId, repo)` — the operator's `gh` login and DCC's ADO connection today, a per-user token later, with the acting user on every call
- [ ] 2.3 GitHub provider: list, get, compare, checks
- [ ] 2.4 Freshness: `behind_by`, `ahead_by`, files the base moved that the branch also touches, branch point, local pull time

## 3. Sync · `@dcc/core`

- [ ] 3.1 Incremental sync per repository; writes rows and events for what actually changed; records `last_synced_at` and marks a host that could not be reached as stale rather than emptying it
- [ ] 3.2 Hierarchy: parent resolved from the base branch of open requests, at any depth, with a cycle guard
- [ ] 3.3 Links: onboarding run, task and work item, from DCC's own records (and from ADO's native work-item links)
- [ ] 3.4 Attention rules: conflict, parent not merged, waiting over the agreed time, no reviewer, unusually large request, build output committed
- [ ] 3.5 Timer on API boot (default 3 minutes, configurable) + on-demand refresh, sharing one path

## 4. API · `apps/api`

- [ ] 4.1 List (filters, grouping, hierarchy), one request, its timeline, the repository's branch map
- [ ] 4.2 Mark seen, per user
- [ ] 4.3 Refresh now

## 5. Screens · `apps/web`

- [ ] 5.1 "בקשות מיזוג" in the sidebar with a count; the list with filters, client and repository grouping, nested children, and the "since you were away" strip
- [ ] 5.2 One request: branch drawing, the freshness sentence in Hebrew, facts, checks, what it contains
- [ ] 5.3 Live timeline
- [ ] 5.4 Branch map for a repository
- [ ] 5.5 A card on the client screen and on the repository screen linking into the filtered list

## 6. Actions

- [ ] 6.1 Update branch from base: the "what will happen" screen, the run, and the conflict result with its way out (ask Claude, open in the host, undo)
- [ ] 6.2 Merge, guarded (not a draft, no conflict, approvals and checks satisfied, parent merged first), with an explicit confirmation naming what will change
- [ ] 6.3 Open a pull request for a branch that has none; request review; close
- [ ] 6.4 Every action writes an event with the acting person and shows its result on the screen

## 7. Azure DevOps

- [ ] 7.1 Provider: list, get, compare, checks — per-reviewer votes reduced to the shared review state
- [ ] 7.2 Actions, where the host supports them
- [ ] 7.3 The list shows both hosts together, with the host named on each row

## 8. Verification

- [ ] 8.1 `tsc -b` clean, `npm run audit:stale` green
- [ ] 8.2 Live against the real repositories: the list matches what the hosts show, the freshness numbers match a manual `git rev-list`, and the drawing matches the real branch layout
- [ ] 8.3 Each action run once against a real request, including a real conflict
- [ ] 8.4 Costs and timings of one sync cycle recorded here
