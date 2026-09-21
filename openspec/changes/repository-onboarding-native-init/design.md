# Repository onboarding — design

## Verified before building (2026-09-19)

- `claude -p "/init"` with `CLAUDE_CODE_NEW_INIT=1` runs the real `/init`
  (the slash command is listed in `system/init.slash_commands`). Headless it
  cannot ask structured questions and cannot write under `.claude/`, so the
  interactive CLI in a pseudo-terminal is the only way to get the same
  experience as a terminal.
- `@lydell/node-pty` (prebuilt `win32-x64`, no native build) spawns the
  native `claude.exe` behind the npm `claude.cmd` shim on this Windows
  machine; the interactive TUI streams as expected.
- Claude Code passes `session_id`, `transcript_path`, `model`, `effort`,
  `cost.total_cost_usd`, `cost.total_api_duration_ms` and
  `context_window.total_{input,output}_tokens` to a status-line command;
  `--settings <file>` (command-line scope) overrides any project status line.
- `--session-id <uuid>` fixes the conversation id; `--resume <uuid>`
  reopens it; `--model` and `--effort` set model and effort for the session.

## Session

`session.ts` owns one terminal channel per run:

- **Channel** — an append-only output buffer (last 2 MB in memory), mirrored
  to `~/.dcc-repos-onboarding/_runtime/<run>/terminal.log` so a reconnect or
  an API restart replays what was on screen. DCC writes its own lines
  (dimmed) into the same channel.
- **PTY** — `claude --session-id <uuid> --settings <runtime>/settings.json
  [--model m] [--effort e] "/init"`, `cwd` = the worktree,
  `CLAUDE_CODE_NEW_INIT=1`. Resume uses `--resume <uuid>` instead of the
  prompt. The executable is the native binary resolved from the npm shim,
  falling back to `claude` on PATH (`DCC_CLAUDE_BIN` overrides).
- **Status line** — `statusline.mjs` writes the JSON it receives to
  `<runtime>/status.json` and prints `DCC · $cost · model`; `refreshInterval`
  keeps it current while idle. Runtime files live outside the worktree, so
  they never show up in the diff.
- **Monitor** — every 3 s while a session is live: fold `status.json` into
  `run.session`, and scan new transcript lines into events (the person's
  messages, `AskUserQuestion` answers), idempotently via a line cursor.
- **Lifecycle** — PTY exit is recorded (event + dimmed line); the session can
  be resumed while the run is in `init` or `review`. When DCC sees `/init`
  finish it closes the stage (which cannot be reopened) but not the session:
  the terminal stays live through the review. Delivery sends `/exit` then
  kills; cancel and API shutdown kill every session.

WebSocket `GET /repos/:id/onboarding/runs/:runId/terminal`: the first
message authenticates (`{type:"auth", token, email}` — a browser cannot set
headers on a WebSocket); the server replies with `replay`, then streams
`output` and `state`; the client sends `input` and `resize`.

## Stages

| key | run | completes when |
|---|---|---|
| `prepare` | worktree + branch + baseline + inventory line | at once |
| `init` | starts (or resumes) the session | DCC sees Claude finish — a turn ended, the copy has changed, and the transcript stayed unchanged for ~6 s, or the session exited with the copy changed (`checkInitFinished`; the review then opens at once). There is no button for it |
| `review` | lists changed files vs baseline (tracked + untracked) | the person approves (or the automation gate does, with consent) |
| `deliver` | commit as the acting user, push, PR / compare link, close the session | at once |

A stage is runnable when it is `Pending` or `Failed` and every earlier stage
is `Completed`. Automation (`step_by_step` default, `guided`, `automatic`
with consent, `custom`) decides which stages start by themselves after the
previous one completes and whether the review gate waits for a person.
Interrupted `prepare`/`deliver` stages are marked `Failed` on boot (rerun
with the button); an interrupted `init` session is resumable.

Cost per stage = the session's cost at the stage's end minus at its start.

## Data

`repository_onboarding_run` — repo, client, status, current stage,
workspace path, branch, baseline, default branch, `automation`,
`model_choices`, `session` (id, state, exe args, last status snapshot,
transcript cursor), who/when. `repository_onboarding_stage` — key, order,
status, `result`, `errors`, `usage` (cost at start/end, model, effort),
timestamps. Both carry `client_id` and a tenant-isolation RLS policy; a
partial unique index allows one live run per repository.
