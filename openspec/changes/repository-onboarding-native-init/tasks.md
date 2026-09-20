# Repository onboarding (native `/init`) — tasks

Appetite: **large**. Order: record → data → core → API → web → docs →
verification. Tick each task as it lands.

## 0. Groundwork

- [x] 0.1 Spike: the interactive Claude Code under a pseudo-terminal from Node on Windows (`@lydell/node-pty`, native `claude.exe` resolved from the npm shim)
- [x] 0.2 Design record of the previous onboarding in `docs/history/repository-onboarding-v2.md`
- [x] 0.3 Delete the superseded OpenSpec changes (the record replaces them)

## 1. Database  ·  `@dcc/db`

- [x] 1.1 Migration `0034_onboarding_native_init.sql`: drop every table only the previous design used; recreate run + stage for the new shape (RLS, tenant policies, one live run per repo)
- [x] 1.2 Drizzle schema rewritten; `repo_ai_event` kept as the one event stream
- [x] 1.3 Applied to local PGlite (API stopped first); `dev:prove` still green — applied on its own: `dev:migrate` re-runs every file on a `dev:setup` database and trips over an unrelated older migration (pre-existing)

## 2. Engine  ·  `@dcc/core`

- [x] 2.1 Remove every file of the previous onboarding engine (and its security-profile config)
- [x] 2.2 `types.ts` — four stages (Hebrew copy), statuses, automation presets + custom, model choices
- [x] 2.3 `workspace.ts` — isolated worktree on `ai/onboarding/<run>`, baseline recorded
- [x] 2.4 `session.ts` — terminal channel, PTY spawn/resume/stop, replay log, subscribers, input, resize, shutdown kill
- [x] 2.5 `statusline.mjs` + monitor (`transcript.ts`) — cost/model/effort snapshot; transcript → events (messages, commands, answers), idempotent
- [x] 2.6 `runs.ts` — start, view, run stage, complete init, approve review, cancel, automation driver, boot recovery
- [x] 2.7 Review diff (`changes.ts`) — changed files vs baseline (tracked + untracked), per-file diff
- [x] 2.8 Delivery (`deliver.ts`) — commit as the acting user, push, PR or compare link, local-only repos, close the session
- [x] 2.9 Routing capability `onboarding_init` + `config/model-policy.json`; dropped what only the previous engine used from `routing.ts` and `ai-assist.ts`
- [x] 2.10 `index.ts` exports

## 3. API  ·  `apps/api`

- [x] 3.1 Remove the previous onboarding routes and boot hooks (prompt seeding, prompt drift, prompt library, refresh, executions)
- [x] 3.2 REST routes for the new run lifecycle; `OnboardingError` → 409 with the message
- [x] 3.3 WebSocket terminal (`@fastify/websocket`): auth message, replay, live output, input, resize — a wrong token closes with 4403
- [x] 3.4 Boot recovery + kill sessions on shutdown

## 4. Screen  ·  `apps/web`

- [x] 4.1 Remove the previous onboarding screens, client functions, prompt-library section and styles
- [x] 4.2 Run screen: header, four-card stepper (done = green), stage card with "▶ הרץ שלב" beside the title (selected, runnable stage only), stage bodies, explainer, next-stage link
- [x] 4.3 Terminal (`@xterm/xterm` + fit) over the WebSocket, always visible under the stage card
- [x] 4.4 Rail: automation, model and effort, run cost, decision and event log, previous runs
- [x] 4.5 Pre-start page (what happens, what gets written, automation, model) + Repositories status column
- [x] 4.6 Vite proxy forwards WebSocket upgrades

## 5. Docs and hygiene

- [x] 5.1 `CLAUDE.md` commands + the design-record exception; `npm run audit:stale` knows the retired names and exempts `docs/history/`
- [x] 5.2 `tsc -b` clean (web: only the unrelated `WorkflowTab.tsx:253` error that predates this change), `audit:stale` green, an independent `grep -rIn` sweep with a positive control finds the previous design's names only in `docs/history/` and applied migrations

## 6. Verification

- [x] 6.1 Live in the browser on ALTSHULER_TRADE (2026-09-19, Claude Code 2.1.278): prepare (worktree, 5,721 files, existing setup found) → init (`/init` in the embedded terminal: trust dialog, then "Review and improve", "No, nothing's changed", "Apply all") → review (1 file, `CLAUDE.md` +22 −7, diff rendered) — $0.72, 15 model calls
- [x] 6.2 API restarted twice mid-session: the run is recovered, the same conversation resumes with `--resume`, cost keeps accumulating across processes, and every answer is on the decision log. No `claude.exe` left behind after the stop
- [x] 6.3 Delivery on ALTSHULER_TRADE (2026-09-19): commit `64f526f` as the acting user, pushed to `ai/onboarding/66d471d4`; the repository has no `gh`-created PR, so the run shows the compare link. All four stages green, run Completed, session closed

## 7. Found and fixed while verifying

- A resize sent right after the auth message was judged before auth finished, so the server closed the socket and the screen reconnected (and replayed) every two seconds — messages are now handled one at a time, in order.
- A resumed process counts cost from zero — the session now keeps a `base` of what earlier processes spent, and the stale status file is removed before a new process starts.
- A resumed process drew over the previous process's screen — a resume starts on a clean screen (the full history stays in `terminal.log`).
- The terminal measured its width before the monospace font loaded (lines ran past the edge) — it refits once fonts are ready.
- An API restart that cuts a live session is now an event on the log, not only a state.
- The browser test tool's key presses carry no key code, so xterm ignores them; real keyboards are unaffected (keystrokes sent through the socket and from the page itself work).
- The review's file diff opened in one block below the whole file list, so a file near the top meant scrolling down to see it. Each diff now opens directly under its own row (one open at a time, brought into view if the row was near the bottom of the window). Checked in the browser against a real diff with the review stage's state simulated, since no run was waiting for review.
- Delivery pushed nothing when the session had already committed everything and no uncommitted file was left ("nothing to deliver"). It now counts what is on the branch since the run's baseline as work to deliver. Checked with `tsc` only; not yet run on a real delivery.
