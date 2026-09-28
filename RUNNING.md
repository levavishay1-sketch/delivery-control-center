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
so they never touch `dcc`.

## Entra ID (later)

Sign-in with Microsoft, B2B guests and the directory sync are built and off.
To switch them on, register the application in Entra ID (redirect URI
`…/api/auth/entra/callback`; Graph application permissions User.Read.All,
Group.Read.All, User.Invite.All with admin consent) and fill the `Entra`
section — in `Server/.local/appsettings.local.json`, not in the committed
`appsettings.json`.

## Wiring a real Claude Code session (optional)

The hooks (`hooks/`) and `skills/dcc.mjs` still use the old shared-secret
headers; they move to API tokens (`POST /tokens`) as part of
`openspec/changes/server-in-csharp` (task 5.1).
