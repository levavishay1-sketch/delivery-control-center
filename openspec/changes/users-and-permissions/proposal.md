# Users, sign-in and permissions

Status: **in progress** — the server side and sign-in are built; see `tasks.md`.

Appetite: **large**.

## Goal

Every person, guest and AI agent signs in as themselves, and sees and does only
what someone gave them — on the whole system, on one client, or on one
requirement and everything under it. The Admin sees and does everything.

## What this change does

- **Kinds of principal** on `users.kind`: a person, a guest (usually with an
  expiry), an AI agent. `user_identity` holds the ways one person signs in —
  a local password now, Entra ID next, Google or Apple later — so a new
  provider adds rows, never columns.
- **Security roles** (`security_role` + `security_role_permission`): a named
  set of permissions from a catalog written in code (`Dcc.Domain.Permissions`,
  synced into `permission` on every start). Five are built in — Admin, מנהל
  לקוח, תורם, צופה, אורח-צופה — and custom ones sit beside them.
- **Assignments with a scope** (`security_role_assignment`): a user or a team
  holds a security role *globally*, *on a client*, or *on a requirement* (its
  subtree included). Admin is simply the Admin role at global scope.
- **Teams** (`team`, `team_member`): local, or mirroring an Entra group (the
  "permission group" of the organisation) through the directory sync.
- **Tokens.** An access token (JWT, one hour, RS256 with a 4096-bit key) that
  carries the user's own permissions so the client can show or hide parts of
  a screen; the server checks every request itself, from the database. Any
  change raises the user's `perm_version`, and an older token is refused as
  `token_stale` — so a revoked permission ends at once, open WebSockets
  included. A refresh token in an httpOnly cookie, rotated on every use;
  reuse ends the chain. API tokens (`dcc_pat_…`) for agents, hooks and MCP.
  Only hashes are stored (`user_token`).
- **AI agents** (`agent_profile`): *delegated* by default — acting for an
  owner and never exceeding the owner's permissions (decision 02 holds). An
  *independent* mode exists in the data but is switched off until an
  amendment to decision 02 is reviewed and approved. An agent never holds
  Admin.
- **Entra ID and B2B guests**: sign-in (Authorization Code + PKCE via
  Microsoft.Identity.Web), guest invitations (Graph) and the directory sync
  are built and stay off until the application is registered.
- **An audit record** (`audit_log`, append-only) of every change to identity
  and permissions.

## The client

Moves to `Client/`. It changes only where it must: `api.ts` sends the access
token and refreshes on `token_stale`; a login screen and a password-change
screen stand in front of the app. `useCan`, `<Can>` and `<RequirePermission>`
are ready but wired to no screen yet — hiding by permission is the next step,
one wrapper per element.

## Out of scope for now

Google and Apple sign-in; the management screens (users, teams, roles,
assignments, agents) — until then `Server/src/Dcc.Api/Dcc.Api.http`; verifying
the token's signature in the browser (JWKS).
