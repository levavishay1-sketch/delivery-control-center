# DCC Claude Code hooks

Capture is a **hook, not a skill** — it must be guaranteed, not
contingent on the model choosing to run it (session-capture spec).

Four hooks, all wired in this repository's `.claude/settings.json`:

| Hook | Event | What it does |
|------|-------|--------------|
| `session-start.mjs` | `SessionStart` | resolves the WorkItem from the branch (`GET /resolve`), prints its Context Brief (`GET /workitems/:id/brief`) to **stdout** — which becomes the session's context. Prints nothing when the branch matches no WorkItem |
| `session-end.mjs` | `SessionEnd` | POSTs a `claude.session` event (`POST /events`, `kind: "session"`): the last assistant text (up to 500 characters) as the summary and the transcript's path. No model, tokens or cost. Cannot block termination |
| `post-tool-use.mjs` | `PostToolUse` (Bash) | on `git commit` / `push` / `checkout -b` / `switch -c` / `gh pr create`, POSTs a `git.activity` event (`POST /events`, `kind: "git"`) |
| `info-hint-check.mjs` | `PostToolUse` (Edit / Write / MultiEdit) | **DCC's own repository only** — lints a screen file for missing "i" hints and hands the note back to Claude. It sends nothing anywhere, and it imports `../scripts/info-lint.mjs`, so it never ships to a client's repository |

`lib.mjs` holds what the three capture hooks share: the `.dcc.json` lookup,
the token lookup and the one function that calls the server.

## Setup

### 1. Per repository — `.dcc.json` at the root (committed)

```json
{
  "apiUrl": "http://localhost:5080",
  "clientId": "<the client uuid>",
  "repo": "CRM"
}
```

`apiUrl` is the DCC server's API root. A path prefix is kept
(`https://dcc.example.com/api` calls `https://dcc.example.com/api/events`).
`.dcc.json` holds no identity and no secret.

### 2. Per person — an API token

Identity comes from an **API token** (`dcc_pat_…`), and the server records
the token's person as the one who did the work. A token carries the full
powers of its user, so treat it like a password.

1. **Getting one.** An administrator creates it with `POST /tokens`
   `{ "name": "hooks — <laptop>", "expiresAt": null, "forAgentId": "<your user id>" }`
   (a holder of `tokens.manage_own` can create their own without
   `forAgentId`). The secret is shown once; only its hash is stored. It can be
   revoked with `DELETE /tokens/:id`.
2. **Putting it where the hooks find it** — one of:
   - `node skills/dcc.mjs login`, then paste the token. It is checked with
     `GET /auth/me` and saved in `~/.dcc/credentials.json` under the server's
     origin (`{ "http://localhost:5080": "dcc_pat_…" }`), readable by you only.
     One file serves several DCC servers.
   - `DCC_API_TOKEN` in the `env` block of your **user-level**
     `~/.claude/settings.json`. Claude Code hands that environment to the hooks
     and to its Bash tool, so `skills/dcc.mjs` sees it too. It wins over the
     file.
3. **Checking it:** `node skills/dcc.mjs whoami`.

**Never** put a token in `.dcc.json`, in a repository's `.claude/settings.json`,
or in its `.claude/settings.local.json` — a repository file can end up in git
(this repository ignores `.claude/settings.local.json`, but a client's may not). CI or a headless run uses an agent's token from the CI secret
store as `DCC_API_TOKEN`; the server records it as the agent acting for its
owner.

### 3. Wiring — `.claude/settings.json`

This repository wires the hooks through `$CLAUDE_PROJECT_DIR`. Elsewhere,
point at absolute paths (the user-level `~/.claude/settings.json`, or the
repository's own):

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

## What the server checks

Every call is made as the token's person, and only inside what that person
may see:

- `GET /resolve` — `requirements.read` on the client.
- `GET /workitems/:id/brief` — `requirements.read` on the requirement.
- `POST /events` — a session or git activity needs `requirements.read` on
  where it lands: the requirement the branch resolves to, else the client
  (its unassigned inbox). A note needs `requirements.edit` on its requirement.

## A hook never breaks or holds up a session

- Each call gives up after **5 seconds**; the hooks always exit 0.
- Anything that goes wrong is **one stderr line** (`[dcc-hook] …`):
  - no token → `no API token — set DCC_API_TOKEN or run node skills/dcc.mjs login`, and nothing is sent;
  - `401` → `token revoked or expired — run node skills/dcc.mjs login`;
  - `403` → the permission the token's person lacks;
  - an unreachable or silent server → the address and the reason.
- A branch that matches no WorkItem is not an error: session-start prints
  nothing, and the events land in the client's unassigned inbox.
- A detached HEAD sends no `branch` at all (never `null`).
- **`DCC_CAPTURE=off`** turns the three capture hooks off. DCC sets it on
  every Claude process it starts itself (`ClaudeRunner`): those runs already
  have their own ledger row, and capturing them again would count them
  twice. `info-hint-check` is not capture and is unaffected.

## Tests

`npm run test:hooks` — node's own test runner (`hooks/test/`), against a small
local stand-in server: what each hook and `skills/dcc.mjs` send, the timeout,
a refused token, `DCC_CAPTURE=off`, the missing branch, `login` and `whoami`.

## Caveats (from the hooks research)

- `SessionEnd` cannot block session termination — capture is best-effort.
- `SessionStart` fires on startup, resume, clear and compact, so the brief is
  injected again each time.
- Claude Code snapshots hook config at **startup**; editing `settings.json`
  mid-session has no effect until a new session.
- The branch convention is Phase 0's WorkItem resolver
  (`feature/WI-1284-slug` → `WI-1284`). A `.dcc` marker per worktree may
  replace it later.
