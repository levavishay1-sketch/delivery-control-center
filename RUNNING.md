# Running DCC locally

The server is C# (ASP.NET Core Web API, `Server/`); the web client is React
(`Client/`). Both run on this machine against a local PostgreSQL.

## Once per machine

1. PostgreSQL 17 (installs as a Windows service that starts with the machine):

   ```bash
   winget install PostgreSQL.PostgreSQL.17
   ```

   Put the superuser's password in `Server/.local/postgres-superuser.txt`
   (`user=postgres`, `password=…`, `port=5432`, one per line). `Server/.local`
   is outside git.

2. Create the roles and the database — as the superuser, once:

   ```bash
   dotnet run --project Server/src/Dcc.Api -- db-bootstrap
   ```

   It creates `dcc_owner` (the API connects as it), `dcc_app` (the role RLS is
   enforced on) and the `dcc` database, and writes the connection string to
   `Server/.local/appsettings.local.json`.

3. `npm install` (for the web client).

4. What the server itself runs, under the Windows account that runs it: git
   2.38 or later with push credentials for the repositories DCC works on; the
   Claude Code CLI (`claude`), signed in; the GitHub CLI (`gh auth login`) for
   the pull-request centre and onboarding deliveries; Node.js and npm on PATH
   (the onboarding checks run hooks and a repository's own scripts). An Azure
   DevOps repository's pull requests come through its client's service
   connection instead.

## Every day

```bash
npm run server   # the API on http://localhost:5080 — applies new migrations on start
npm run web      # the web client on http://localhost:5173 (proxies /api to :5080)
```

Open http://localhost:5173 and sign in.

## The first administrator

On the first start with no administrator, the server creates
`admin@dcc.local` with the Admin security role everywhere, and writes a
one-time password to `Server/.local/initial-admin.txt` (it is never printed or
logged). The first sign-in asks for a new password; delete the file after.

Other users, teams, security roles and assignments are managed through the API
until their screens exist — `Server/src/Dcc.Api/Dcc.Api.http` has every
request ready to run from Visual Studio.

## Tests

```bash
dotnet test Server/DeliveryControlCenter.sln
```

The integration tests drop and recreate a database of their own, `dcc_test`,
so they never touch `dcc`; `DCC_TEST_DATABASE=dcc_test_<name>` gives a second
run its own. They use stand-ins for the Claude CLI, `gh` and Azure DevOps and
never reach the internet, but they do run git, node and npm.

While a dev server holds `Server/src/Dcc.Api/bin`, build the tests elsewhere:
`dotnet test Server/DeliveryControlCenter.sln --artifacts-path <folder>`.

## Entra ID (later)

Sign-in with Microsoft, B2B guests and the directory sync are built and off.
To switch them on, register the application in Entra ID (redirect URI
`…/api/auth/entra/callback`; Graph application permissions User.Read.All,
Group.Read.All, User.Invite.All with admin consent) and fill the `Entra`
section — in `Server/.local/appsettings.local.json`, not in the committed
`appsettings.json`.

## Wiring a real Claude Code session (optional)

The hooks (`hooks/`) record a Claude Code session in DCC — the brief at its
start, its commits and pushes, its summary at the end — and `skills/dcc.mjs`
lets a session raise gaps, blockers and tasks. Both authenticate with an API
token:

1. A token comes from `POST /tokens` (examples in `Dcc.Api.http`); the secret
   is shown once. Someone holding `tokens.manage_own` creates their own; for a
   developer, an administrator creates an agent the developer owns
   (`POST /agents` with `ownerUserId`) and that agent's token — the developer's
   sessions are then recorded as theirs, with the agent named. The token's
   person needs `requirements.read` on the client (the brief, sessions,
   commits), `requirements.edit` for notes, gaps and blockers, and `tasks.edit`
   for proposing tasks, file touches and the Reviewer's verdict.
2. On your machine, `node skills/dcc.mjs login` and paste it — it is checked
   and kept in `~/.dcc/credentials.json`, outside every repository. (Or put
   `DCC_API_TOKEN` in the `env` block of your user-level
   `~/.claude/settings.json`.) Never put it in a repository file.
3. The repository's `.dcc.json` names the API (`http://localhost:5080`) and the
   client. Details, and what each hook sends: `hooks/README.md`.

### The MCP server

`Server/src/Dcc.Mcp` gives a Claude session read-only tools over DCC (clients,
a requirement, its timeline and cost, search), answered as the token's person:

```bash
claude mcp add dcc --env DCC_API_TOKEN=dcc_pat_… -- dotnet run --project C:/path/to/delivery-control-center/Server/src/Dcc.Mcp
```

The project path is absolute because Claude Code starts the server in whatever
folder it runs in. `DCC_API_URL` defaults to `http://localhost:5080`.
