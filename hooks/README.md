# DCC Claude Code hooks

Capture is a **hook, not a skill** — it must be guaranteed, not
contingent on the model choosing to run it (session-capture spec).

Three hooks:

| Hook | Event | What it does |
|------|-------|--------------|
| `session-start.mjs` | `SessionStart` | resolves the WorkItem from the branch, prints its Context Brief to **stdout** — which becomes the session's context |
| `session-end.mjs` | `SessionEnd` | reads `transcript_path`, summarises, POSTs a `claude.session` event. Cannot block termination. |
| `post-tool-use.mjs` | `PostToolUse` | on `git commit`/`push`/`checkout -b`/`gh pr create`, POSTs a `git.activity` event |

## Setup

### 1. Per repo — `.dcc.json` at the repo root (committed)

```json
{
  "apiUrl": "http://localhost:3001",
  "clientId": "<the client uuid>",
  "repo": "CRM"
}
```

### 2. Per developer — shell environment

```bash
export DCC_DEV_EMAIL="you@company.com"     # maps to your users row
export DCC_HOOK_TOKEN="<shared pilot secret>"
```

Missing any of these → the hooks no-op silently (they log to stderr).

### 3. `~/.claude/settings.json` (or the repo's `.claude/settings.json`)

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node /abs/path/to/dcc/hooks/session-start.mjs" }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "node /abs/path/to/dcc/hooks/session-end.mjs" }] }
    ],
    "PostToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node /abs/path/to/dcc/hooks/post-tool-use.mjs" }] }
    ]
  }
}
```

## Caveats (from the hooks research)

- `SessionEnd` cannot block session termination — capture is best-effort.
- Claude Code snapshots hook config at **startup**; editing `settings.json`
  mid-session has no effect until a new session.
- The branch convention is Phase 0's WorkItem resolver
  (`feature/WI-1284-slug` → `WI-1284`). A `.dcc` marker per worktree may
  replace it later.
