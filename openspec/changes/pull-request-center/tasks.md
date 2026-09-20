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

## 14. A file opens as before and after; the line answers everywhere; the map speaks one language

Five things the user raised while in the onboarding's prepare stage and on the request screen.

- [x] 14.1 **The curve was not pressable.** A branch that sprang from its base with a single dot had a zero-length straight part, and the curve joining it to the base was not a target. The press target is now the whole connector, curve included. Checked with a real click on the prepare-stage map of ALTSHULER_TRADE: the panel opened with the branch name and its folder.
- [x] 14.2 **A file opens under its row as the old file and the new file, side by side, with the changes marked** — on the request's Files tab and in the onboarding review, through one shared component (`components/FileCompare.tsx`). Unchanged stretches fold away with a few lines of context and open on a press; inside a changed line, the part that differs is marked too. Binary and very large files (over 400 KB) say so instead of loading. The request's versions come from the host at the branch point and at the branch's last commit (`GET …/pull-requests/:n/file`); the review's from the run's baseline and the working copy (`GET …/onboarding/runs/:id/file`).
- [x] 14.3 **One rule for links on the map**: code that is on the host links to its page there; code that is in a folder on this computer shows the folder; code that is in both shows both. A commit that was never pushed no longer gets a host link that would lead nowhere. On a request's screen no folder is known, so only host links appear.
- [x] 14.4 **The wording that confused** ("already pushed to the cloud" next to a pull request) now says the two are different things: the branch was uploaded to GitHub, but its changes are still not in the main branch, and the request is the ask to put them there — not an upload. The map's legend carries the same one-line glossary, and arrows say "uploaded, no merge request yet" / "not yet uploaded to GitHub".
- [x] 14.5 **The branches tab shows every branch of the repository**, not only those with an open request: for each, whether what it holds is already in the main branch, how far the main branch moved since, its open or merged request, the last activity, how it came to exist (a Claude Code session, a DCC run, a project) and, in words, what is sensible to do. It reads and advises; deleting stays a decision on the host. One call to the host (GraphQL) returns all branches in about a second. The earlier list of only the branches with an open request is gone.
- Replaced and removed: the unified-text diff of the onboarding review (component, endpoint, client call, styles, server function), and the per-request `branches` list.
- Swept for the removed names (`getOnboardingDiff`, `getOnboardingFileDiff`, `fileDiff`, `DiffView`, `.ob-diff`, `BranchRow`): no hits outside history.
- [x] 14.6 **The dot a branch springs from answered as if the line had been pressed.** The branch's connector ends exactly on that dot, and its press target was drawn above the dot. The press targets of all lines are now a layer underneath every dot, and the visible lines let presses through to it. Checked with a real click on the branch-point dot of the prepare-stage map: the commit's panel opened (message, author, link, folder).

## 15. Branch rules

Agreed with the user after the repository's stray branches were cleared (three deleted; the open request's branch kept).

- [x] 15.1 Branch names and what happens to a branch are written in `CLAUDE.md` ("Branch names and what happens to a branch"): `<type>/<short-description>` with `project/`, `task/`, `fix/`, `ai/onboarding/<run>` and `claude/`; deleted after merge; a forgotten unmerged branch gets a request or is deleted after looking at it. The user declined a maximum lifetime for branches, so none is enforced — the branches tab no longer calls a branch forgotten because of its age, only because its request was closed unmerged.
- [x] 15.2 DCC's own task branches are now named `task/<key>-…` (they were `feature/…`), matching the flow; the work item is still resolved from the key in the name, whatever the prefix.
- [x] 15.3 The repository deletes a request's branch on merge by itself (setting turned on).
- [ ] 15.4 Protecting `master` (a request required, no force-push, no deletion) was attempted and refused by the environment's permission check; waiting for the user to allow it or set it in GitHub.

## 16. The branch is the headline; a commit says what its author wrote

- [x] 16.1 A request's header now leads with the branch's name, with the request's own title on one small line below it. What the branch is about is a panel ("על מה הענף") beside the code map on the overview — under it when the window is narrow — the first three OpenSpec changes in the accent colour. The list is worked out from where the branch's files are — each OpenSpec change it touches is a subject (its folder name, shown as words), the rest is grouped by part of the repository, and changes it only deleted or touched by a line or two are folded into one line each. No model is involved, so it costs nothing and needs no translation; it is in English, as the branch and the commits are.
- [x] 16.2 Pressing a commit shows the message its author wrote, in full (the first line as the heading, the rest under it), instead of a summary written by DCC. Also free.
- [x] 16.3 A commit's file count is shown only where it is that commit's own. The host answers a whole branch's files at once, so on a request's screen each dot used to claim every file of the request (139); those dots now show no count rather than a wrong one.
- Deliberately not built: Hebrew topics and Hebrew commit descriptions. They need a model to translate or summarise, which costs per call; the user chose English to keep this free.
- [x] 16.4 The branch's name is aligned to the right edge (the reading side) on a request's screen, and is the headline of each row in the requests list too, with `#number · title` under it. A row still opens the request's screen; a separate "על מה הענף" button on the row opens the same list of subjects nested under it, without leaving the list (it asks the host for the request's detail, which pointing at the row has usually already fetched). One shared component draws the list on both screens.

## 17. Requests already dealt with stay findable

The user expected the first request of this repository (merged) to appear in the list; the list only asked the host for open ones.

- [x] 17.1 The list asks the host for the most recent closed requests too (its "closed" includes merged; each row says which it is) and offers them under "מוזגו לאחרונה" and "נסגרו בלי מיזוג" beside "פתוחות". The tiles and the sorting still speak only of the open ones.
- [x] 17.2 A merged or closed request opens on its own screen: no blockers, a next step that says it is done, its files and timeline (with the merge itself), no live map (its branch may be gone and the base has moved on) and no side-by-side file comparison (open requests only), and the merge button stays disabled.
- [x] 17.3 The line under a row's branch name (`#number · title`) is gone from the list; the request's number and title remain on its own screen.
- [x] 17.4 A request's screen leads with the same two lines as its row in the list — the branch, then who opened it, when it was last updated and its target — and no line with the number and title. The review blocker no longer says a review can be requested "from here": the button is not built yet, so it says the review and approval happen on the host.

## 18. The review is written in DCC and sent to the host

The user does not want to open the host: DCC is the interface, the host is where things are recorded. Users will later enter DCC with their own accounts and see only what their permissions allow; who sees what, and notifications to the developer, come after this screen.

- [x] 18.1 A card "הסקירה שלך" on the request's overview: three choices — a comment, an approval, a request for changes (with the reasons a request for changes needs text) — and a box for the words. Sending writes a real review on the host through the operator's own login (`gh pr review`); the screen refreshes from the host afterwards, so what it shows is what the host holds.
- [x] 18.2 **The host refuses an approval, or a request for changes, from the request's own author.** DCC cannot change that, so for that person the card offers a comment and "אשר ב-DCC" instead: a comment review on the host that says who approved in DCC and is not the host's own approval, carrying an invisible mark. DCC reads the mark back from the reviews (so the host stays the only place the decision lives, and no table was added), counts it toward the review blocker (shown as "אושר ב-DCC", with the sentence that it is not the host's own approval), and it stops counting if somebody asks for changes after it. The refusals — an empty comment, an approval by the author — were checked against the API without touching the host.
- [x] 18.3 The timeline shows a review's own words (and a DCC approval as "… אישר ב-DCC"), so the developer reads what the reviewer wrote.
- [ ] 18.4 Not yet checked end to end: a real review was not posted, so as not to leave a test comment on the user's own request. The first real send is the check.
- [ ] 18.5 To come, by the user's own sequencing: each user acting as their own account on the host, permissions on who sees which requests, and notifications to the developer.
- [x] 18.6 The card speaks the way the person thinks: "מאשר מיזוג ל-master", "לא מאשר, צריך תיקון", "רק הערה" (the host's approve, request changes and comment). For the request's own author the internal approval is named "אישור פנימי של DCC (לא רשמי)" and the notice says why and what an official approval needs — the host account of another reviewer.
