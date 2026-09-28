# Users, sign-in and permissions — tasks

Appetite: **large**. Branch: `project/eyas`.

## 1. Data (migration 0056)

- [x] 1.1 `users`: kind, expiry, perm_version, must_change_password; entra_oid optional; unique lower(email)
- [x] 1.2 `user_identity`, `local_credential`, `team`, `team_member`, `permission`, `security_role`, `security_role_permission`, `security_role_assignment`, `agent_profile`, `user_token`, `audit_log` (append-only by trigger in `guards.sql`)

## 2. Server

- [x] 2.1 Permission catalog and built-in security roles in code, synced on start; the first Admin created with a one-time password written to `Server/.local/initial-admin.txt`
- [x] 2.2 Sign-in with a password: PBKDF2, the same answer for an unknown email and a wrong password, lockout after 5, forced change on first sign-in
- [x] 2.3 JWT (1 h, RS256, 4096-bit key — refused if shorter), perm_version check → `token_stale`; refresh rotation with reuse detection and a short grace for two tabs; sign-out
- [x] 2.4 `[RequirePermission]` — scope from the route; the check reads the database (cached per perm_version), never the token
- [x] 2.5 Directory API: users, teams, security roles, assignments (assignable scopes enforced, the last Admin protected), agents, API tokens, audit
- [x] 2.6 Delegated agents capped by their owner; an agent never holds Admin; independent mode off (`Agents:AllowIndependent`) — returns `requires_architecture_review`
- [x] 2.7 Entra ID sign-in, B2B guest invitation, directory sync — built, off until configured (404)
- [x] 2.8 Authenticated WebSocket: `auth` first (4401), resource check (4403), re-auth on expiry or permission change
- [x] 2.9 Tests: tampered token, stale token, refresh reuse, lockout, hashing, tenant wall, scope inheritance, teams, agents, API tokens, Entra off, WebSocket close codes

## 3. Client

- [x] 3.1 `auth/session.ts`: token in memory only, single-flight refresh, `authFetch`
- [x] 3.2 Login and password-change screens with their "i" (`page_login`, `page_change_password`, `new_password`)
- [x] 3.3 `useCan`, `<Can>`, `<RequirePermission>` ready, wired to no screen
- [ ] 3.4 Hide parts of each screen by permission (next step, on request)
- [ ] 3.5 Management screens: users, teams, security roles, assignments, agents, API tokens

## 4. Later

- [ ] 4.1 Register the application in Entra ID and switch it on (redirect URI behind the `/api` prefix)
- [ ] 4.2 The decision-02 amendment for independent agents, in `docs/architecture-review.md`; only then `Agents:AllowIndependent`
- [ ] 4.3 Google and Apple sign-in
- [ ] 4.4 Verify the token's signature in the browser (JWKS endpoint)
