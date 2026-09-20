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

- [x] 4.1 List (filters, grouping, hierarchy), one request with its blockers, next step, map, files, timeline and branches
- [ ] 4.2 Mark seen, per user
- [ ] 4.3 Refresh now

## 5. Screens · `apps/web`

- [x] 5.1 "בקשות מיזוג" in the sidebar with a count; the list with filters, client and repository grouping, nested children, and the "since you were away" strip
- [x] 5.2 One request: branch drawing, the freshness sentence in Hebrew, facts, checks, what it contains
- [x] 5.3 Live timeline
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

## 9. The code map — one drawing, everywhere git is involved

Built first, because every screen below depends on it and the user asked that a
change of design be one change, not one per screen.

- [x] 9.1 `packages/core/src/code-map.ts` — the model (lanes, dots, place badges, arrows), the git reading behind it (local commands only, memoised ~8s, no network on a screen poll), and the builder that turns facts into the picture plus its one Hebrew sentence
- [x] 9.2 `codeMapForWorkspace` (a working copy) and `codeMapForTask` (a branch read by name, without checking it out). Reading a screen never starts a clone: `existingCheckout` replaces `ensureCheckout` for read-only callers
- [x] 9.3 `apps/web/src/components/CodeMap.tsx` — the only place that draws it. Geometry and colour live in one `D` object at the top; screens pass a map and nothing else
- [x] 9.4 Added to every screen that touches git, as an addition — nothing existing was moved or removed: onboarding prepare, review and deliver, and the task screen beside push and rollback (refreshed after both)
- [x] 9.5 Verified: built from this repository's own git (3 commits, 12 uncommitted, pushed, base `master`, fetch time — matches `git` by hand) and rendered in the running app through Vite for the fresh, behind-by-12 and pushed cases. Three overlap bugs found and fixed there (labels on the line, the base badge under the arrow's landing, the arrow label over the branch name)
- [x] 9.6 Seen inside a real onboarding run on the trade repository (prepare stage): the map draws main's real last commits and the empty branch, and pressing the branch-point dot opens the real merge commit (PR #6) with its author, time and a link to it on GitHub
- [x] 9.7 Every dot is a real commit with subject, author, time, file count and host link; pressing one opens a floating panel beside it (keyboard and Escape work, the hit area is larger than the dot). Lives in the one shared component, so it applies everywhere the map appears

## 10. Found while building

- A clone interrupted by an API restart left 2.9GB of files with no HEAD; the next prepare reused it and failed with "ambiguous argument HEAD". Cloning is now atomic (into a temporary folder, moved into place only when it has a HEAD), a directory without a HEAD is discarded, and two callers for one repository share one clone instead of racing — a second press had started a second clone into the same folder. The prepare stage also refuses with a clear message instead of passing git's error text on as a revision.
- The local database corrupted twice in one session because probe scripts opened it while the API was running. The rule is now in CLAUDE.md next to the existing warning.
- The GitHub CLI was not on PATH for an API started before it was installed; it is now looked for in its install locations.
- Work that exists only on this computer now says where: a dot that is local-only (commits not pushed, unsaved files, an empty branch) carries its folder, and its panel shows the path with "open in file manager" and "copy path" — the counterpart of the host link on a commit. Opening goes through `POST /open-folder`, which resolves the path (symlinks and `..` included) and refuses anything outside DCC's own working folders: checked against `C:\Windows`, an escape through `..`, a missing folder and an ordinary user folder — all refused with a message; the run's own folder opened a real Explorer window. "Copy" uses the clipboard API and falls back to the older route; both are blocked in the preview pane (a scripted click is not a real user gesture), so it was not seen working there — a real click in the browser is the check that remains.
- The map printed git's own error text as if it were data ("fatal: not a git repository" as the base branch, a 40-character id on a dot) for a working folder whose parent clone had been deleted. It trusted the text of a git command without its exit code. The map now checks the folder is a git work tree before reading anything, uses a command's text only when it succeeded, and says in words when the folder cannot be read (with the folder and the buttons to open or copy it) instead of drawing something wrong. The branch-point fallback shows the short id like every other dot. One component, one place — so the fix applies to every screen at once, which is the point of having one map.

## 11. The six screens, agreed with the user

Six mockups were approved before this round: the list, the request (four tabs — סקירה, קבצים, יומן, ענפים), and the action screen. A seventh drawing, the map of how the screens connect, was explanation only and is not built.

- [x] 11.1 The request has a screen and an address of its own (`#/pull-requests/<repo>/<number>[/tab]`), with a back link and a breadcrumb. It no longer expands inside the list row, and every tab is its own address that can be sent to someone.
- [x] 11.2 "מה חוסם מיזוג" — four conditions (conflict, review, checks, a parent request), each with ✓ / ✗ / – and a sentence saying what it means. A draft adds a fifth. The merge button stays disabled while any is red.
- [x] 11.3 "הצעד הבא" — one sentence naming what to do and why, computed from the blockers and from how far the base has moved.
- [x] 11.4 Files grouped as code, instructions, config, docs, other and build output, with counts, per-group totals, a filter, and a note on files that are generated or should not be there.
- [x] 11.5 Timeline from the host: the opening, the commits, the base's own commits since the branch point — flagged when they touch the same files — plus reviews and comments.
- [x] 11.6 **The map now comes from the host, not from a local clone.** That was the bug behind the wrong drawing the user saw: this machine's copy held only `master`, so the branch read as empty and "on this computer only". Two compare calls give what each side gained, the merge base gives the branch point, and a third call brings a little of the base's history so a line reads as a line. When the host cannot answer, the screen says so instead of drawing.
- [x] 11.7 The drawing is capped at 560px wide, so its text cannot balloon on a wide screen, and a line ends at its last dot.
- [ ] 11.8 The action screens (update branch, request review, merge) are designed and their buttons are in place but disabled — the next piece of work.
- [x] 11.9 Verified live on this repository's own pull request #2: the blockers (draft, no review, no checks, no parent), the next step, 132 files in five groups, 9 timeline items, the map with the 8 commits and the request's node, and each tab's address.

## 12. Speed — a request took 12 to 18 seconds to open

Reported by the user from the browser's network tab: two calls to the same request, 5.5s and 12.4s, with the second waiting on the server for most of it. Measured cause: the three calls to the host ran one after another, one of them (`commits?sha=…`, listing the base's history before the branch point) took ~8s by itself, another (`compare`) returns a 1.2MB payload because it carries every file's patch, and every tab switch asked the server again — twice, because the screen mounted twice.

- [x] 12.1 The calls to the host that do not depend on each other run together (request, and what each side gained), and repositories are asked in parallel.
- [x] 12.2 The 8-second history call is gone. The drawing gives its base line a short lead-in instead, so one or two dots still read as a line.
- [x] 12.3 The server keeps a request's detail for 45 seconds (a forced refresh skips it); the screen keeps what it has fetched and shares one call between two mounts, so a tab switch costs ~0.2s instead of a full load.
- [x] 12.4 **Progressive loading.** The header, what blocks the merge and the next step come from the list the server already holds (~0.2s) and appear at once; the map, files, timeline and branches fill in behind them, each with a short "loading from GitHub" line. Pointing at a row in the list starts the heavy fetch, so the click often finds it ready.
- [ ] 12.5 What remains is the host itself: the `compare` call for a 132-file request is 1.2MB and 2 to 5 seconds, and GitHub offers no way to leave the patches out. For ordinary requests (a handful of files) it is a fraction of that.

## 13. Pressing the line says which branch it is

The user expected that pressing a line in the map would tell them the branch's name, as pressing a dot tells them the commit. Now each line is pressable (a wide invisible strip along it, keyboard-reachable) and opens the same floating panel: the branch's full name in a readable mono style, a sentence in Hebrew on what it is and where it lives (cloud and computer, or computer only), how many commits it holds that its base does not, a link to the branch on the host, and — for a branch that only exists on this computer — its folder with the open and copy buttons. Built in the shared component and the shared map builder, so it applies on every screen that draws the map. Checked live on this repository's request: both lines answer, with the right names and links.
