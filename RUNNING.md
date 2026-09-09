# Running the walking skeleton

No database install needed — `@dcc/db` uses embedded PGlite by default.

```bash
npm install

# 1. fresh DB + schema + guards, then seed the demo WorkItem
cd packages/db
npm run dev:reset && npm run dev:setup
cd ../core && npm run demo          # seeds WI-1284 + a full timeline

# 2. API  (terminal A)
cd ../../apps/api
DCC_HOOK_TOKEN=dev-secret npm start   # :3001

# 3. Web  (terminal B)
cd ../web
npm run dev                           # :5173  → open it
```

PGlite is single-process: only one of {demo, smoke, API} holds the DB at
a time. Seed with `demo`, then start the API.

## Proofs

```bash
cd packages/db  && npm run dev:prove   # 9 checks — RLS wall, append-only, validation
cd apps/api     && npm run smoke       # 8 checks — capture path + reads (needs a fresh dev:setup)
```

## Wiring a real Claude Code session (optional)

1. In a scratch repo, add `.dcc.json`:
   `{ "apiUrl": "http://localhost:3001", "clientId": "<uuid from /dev/workitems>", "repo": "scratch" }`
2. `export DCC_DEV_EMAIL=... DCC_HOOK_TOKEN=dev-secret`
3. Add the three hooks to `.claude/settings.json` (see `hooks/README.md`)
4. Work on a `feature/WI-xxxx-...` branch — sessions and commits land on
   the timeline; the next session starts from the Brief.
