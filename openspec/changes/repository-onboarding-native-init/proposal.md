# Repository onboarding — Claude Code's own `/init`, in one live session

Status: **done** — all tasks complete and verified live on a real repository, 2026-09-19 (see `tasks.md`).

Appetite: **large** (user-directed: replace the whole onboarding screen and
engine in one pass, no leftovers).

## Goal

Onboarding tailors Claude to a repository, component by component, so that
a developer who picks up a task has everything needed to work efficiently,
economically and to a high standard — from the first session. New needs
will appear later; stages can be added between the Claude session and the
delivery without touching the rest.

The content (CLAUDE.md, skills, hooks) comes from Anthropic's own `/init`
(`CLAUDE_CODE_NEW_INIT=1`), not from prompts DCC maintains — the user chose
this because Anthropic keeps improving it. DCC provides what `/init` does
not: an isolated copy of the repository, the person's review of every
change, delivery to git under the person's identity, and a record of
everything that happened.

## What changes

**Four stages, each started with its own "▶ הרץ שלב" button:**

1. **הכנת ריפו** — an isolated worktree on a new `ai/onboarding/<run>`
   branch, pinned to a recorded baseline commit. The developer's own
   checkout is never touched.
2. **הטמעה עם Claude (/init)** — the real, interactive Claude Code
   (`claude --session-id <uuid> "/init"` with `CLAUDE_CODE_NEW_INIT=1`) in
   a pseudo-terminal inside the workspace. The person answers its
   questions exactly as in a terminal.
3. **סקירת תוצרים** — every changed file as a diff against the baseline,
   read-only; the person approves. There is no way back into the
   conversation: the terminal stays on screen, locked.
4. **מסירה** — commit under the acting person's identity, push, open a
   pull request (or a compare link when `gh` is absent).

**One Claude Code session, for the `/init` stage.** A terminal under the
stage card is always visible. While `/init` runs it is the real PTY stream —
Claude's own screen, the person's keystrokes, slash commands (`/model`,
`/cost`, …) behave exactly as they do in a terminal. DCC's own git steps
appear in the same window, dimmed. When DCC sees `/init` finish it closes the
session and the stage, and the terminal stays as it was, locked; if the API
restarts while `/init` is still running, the same conversation is resumed
with `--resume <session-id>`.

**The rail keeps today's concept** so future stages slot in: automation
policy (presets + per-stage run/gate), model and effort, run cost, the
decision and event log, and previous runs. Cost, model and effort come
from Claude Code's status-line JSON; the person's messages and their
answers to `/init`'s questions are read from the session transcript into
the decision log ("no silent actions").

**Data** — the onboarding run and stage tables are recreated for this
shape; tables only the previous design used are dropped. `repo_ai_event`
stays the one event stream, written only through `appendRepoAiEvent`.

A record of the previous design, kept at the user's request for future
ideas, is in `docs/history/repository-onboarding-v2.md`.

## What does not change

Azure DevOps stays the source of truth; Claude Code keeps working as it
does — here literally, it is the same CLI; identity is the acting user on
every commit, push and decision; `client_id` + RLS on every new table; the
five foundational decisions are untouched.
