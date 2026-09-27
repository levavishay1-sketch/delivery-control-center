# DCC architecture and product survey (read-only)

**The report file was not written.** This session was restricted to reading: no file creation anywhere, `/tmp` included. So `/tmp/claude-0/-home-user-delivery-control-center/b2470b29-abd6-5f6c-8317-bcaed54a68e8/scratchpad/research/dcc-survey.md` does not exist. The full report is below and can be saved as-is.

## Summary

**Ten most important facts**
1. **Layers.** `db ← core ← api/mcp`. `apps/web` imports no `@dcc` package; it talks HTTP only and restates 126 server types by hand in `/home/user/delivery-control-center/apps/web/src/api.ts`. The api and mcp apps also query `@dcc/db` directly. For example, requirement creation is an INSERT inside `/home/user/delivery-control-center/apps/api/src/server.ts:1683-1735`.
2. **API.** 162 routes in one 1,813-line file. Auth is a shared token plus an email header. 24 GET routes and `/admin/shutdown` never check it, and there is no check of which clients a user may see.
3. **How Claude is called.** Only through the local `claude` CLI: headless `-p --output-format stream-json`, spawned in `/home/user/delivery-control-center/packages/core/src/ai-assist.ts:397-569`. Onboarding runs the interactive CLI in a pseudo-terminal. There is no Agent SDK and no API client, although `openspec/project.md` lists the Agent SDK.
4. **ai-assist.ts is the hub.** 2,708 lines holding CLI spawning, git/clone helpers, every AI step, task-status facts, approval, rollback/push/delete and spec mapping. 24 core files import it.
5. **Routing and ledger.** Every call is routed through `config/model-policy.json` and written to the append-only `claude_call` table. But the only routing signal ever passed is `mechanical`, the client/requirement policy layers are not wired, and per-call dollar caps are computed but never enforced.
6. **Prompts.** 22 prompt keys. Their text lives only in `prompt_template` rows seeded by SQL migrations. Edits overwrite in place: no version history, no event.
7. **Requirement phases.** Every assess run sets `shaping` without checking the current phase. `startBuilding` moves intake/shaping to building and is not blocked by open gaps. `review`/`done`/`archived` are reached only by manual PATCH or finishing a research requirement. The "close gaps before breakdown" rule exists only in the web, and "assess done" is detected by a Hebrew text prefix on a note.
8. **Tasks.** 6 stored states and 18 computed status keys. The server enforces two gates: closing a task (checks passed and dependencies done; an override is recorded) and starting development (task approved and already in TFS).
9. **Azure DevOps.** Every write is triggered by a person. There is no poller or webhook, the pull-from-ADO functions are never called, and the ADO access token is stored in a database column.
10. **Event log.** 48 production write sites; free-text `note.added` dominates. Creating a requirement, approving or rejecting a task, and editing a prompt write no event.

**Surprising**
- `flow_run` has no row-level security.
- Drizzle's migration journal lists 8 of the 54 migrations.
- Two `.ts` files contain literal NUL bytes, so `grep` treats them as binary.
- The chat's preview for assess uses a prompt key that was never seeded.
- The `notification` table is read but never written.
- Finishing a research requirement appears to hit the auto-added-checks gate; this is a code trace, nothing was run.
- The docs say the proofs have 9 and 8 checks; the code has 16 and 14.

---

# Full report

Path roots used below (all absolute):
- R = `/home/user/delivery-control-center`
- CORE = `/home/user/delivery-control-center/packages/core/src`
- DB = `/home/user/delivery-control-center/packages/db`
- API = `/home/user/delivery-control-center/apps/api/src`
- WEB = `/home/user/delivery-control-center/apps/web/src`
- MCP = `/home/user/delivery-control-center/apps/mcp/src`

## 1. Layering and dependencies

### Declared dependencies (package.json files)

| Workspace | Depends on |
|---|---|
| `@dcc/db` | drizzle-orm, @electric-sql/pglite, pg, zod. No `@dcc` import. |
| `@dcc/core` | `@dcc/db`, drizzle-orm, @lydell/node-pty, mammoth, unpdf |
| `@dcc/api` | `@dcc/core`, `@dcc/db`, fastify, @fastify/websocket, drizzle-orm, zod |
| `@dcc/mcp` | `@dcc/core`, `@dcc/db`, @modelcontextprotocol/sdk, drizzle-orm, zod |
| `@dcc/web` | react 18, @xyflow/react, @xterm/xterm. No `@dcc` dependency. |

- Root `tsc -b` references db, core, api, mcp only (R/tsconfig.json). The web app has its own tsconfig and is not in the build.

### Import graph

**core → db**
- About 40 core modules import `@dcc/db` (db, withTenant, withoutTenant, appendEvent, recordClaudeCall, usd) and `@dcc/db/schema` directly.
- Drizzle queries are written inline in the domain modules; there is no repository/data-access layer.

**api → core**
- One barrel import of 186 names from `@dcc/core` (API/server.ts:6-186).

**api → db, bypassing core**
- Imports: API/server.ts:4-5 and 188 (db, dbKind, withTenant, timeline, unassigned; schema client/repo/users/workitem/blocker/gap/task). API/context.ts:3-4.
- Direct queries:
  - server.ts:255-258 — GET /users.
  - server.ts:697-705 — GET /dev/workitems.
  - server.ts:777 and 806 — `timeline()` and `unassigned()` from db.
  - server.ts:810-830 — GET /workitems/:id assembles workitem, gaps and blockers with `tx.select`.
  - server.ts:891-904 — assign: select/insert users, then update `workitem.ownerId`.
  - server.ts:975-988 — client task search.
  - **server.ts:1683-1735 — POST /workitems: requirement creation is an INSERT in the API, with no core function.**
  - server.ts:1748-1757 — ado-link update.
  - context.ts:18-44 — `actingUser` (user lookup; auto-insert on PGlite).
  - context.ts:47-56 — `locateWorkItem` queries workitem with plain `db`, no tenant set.

**mcp → db**
- MCP/server.ts:5-6 imports db, timeline, withTenant and schema blocker/gap/workitem.
- Its own queries: 63-69, 82, 90-93, 106, 120.
- It also calls core functions (listClients, tasksFor, attachmentsFor, reposForRequirement, requirementCostSummary).
- Five read-only tools: list_clients, search_requirements, get_requirement, get_timeline, get_cost_summary.

**web → nothing**
- `fetch("/api…")` in WEB/api.ts:12-23; the vite proxy strips `/api` and forwards to :3001, WebSocket included (R/apps/web/vite.config.ts).
- WEB/api.ts has 126 `export type` declarations mirroring server shapes.
- Two more fetch helpers carry their own copies of the auth headers: WEB/forms.tsx:18-25 and WEB/screens/Record.tsx:18-24.

### Inside core
- **ai-assist.ts** is imported by 24 files: actions/index, chat/{index, proposals, gaps}, code-map, index, insights, manual-work, merge-verify, prove-kit, pull-request-{conflict, detail, review}, pull-requests, repo-branches, repo-onboarding/{changes, deliver, runs, workspace}, research-work, task-branch-repair, task-files, task-merge, tasks. Besides the AI steps it exports the shared `git()`, `ensureCheckout`/`existingCheckout`, `firstRepo`, `httpsRepoUrl`.
- **regenerateBrief** has 47 call sites across 16 files.
- **Import cycles:**
  - tasks.ts ↔ ai-assist.ts. tasks.ts imports ai-assist dynamically at tasks.ts:133 and 203, with the comment "Imported here, not at the top: ai-assist.ts imports this module".
  - chat/index.ts:15 imports from proposals.ts, and chat/proposals.ts:14 imports from index.ts.
- **Cross-feature links:**
  - actions/index.ts:5-6 imports repo-onboarding/runs and session.
  - chat/index.ts:12-13 imports repo-onboarding/runs and actions.
  - insights.ts imports chat/index and claude-center.

### Three ways to reach tenant data
- **`withTenant`** (DB/src/client.ts:90-110): `set local role dcc_app` plus `app.current_client`.
- **`withoutTenant`** (client.ts:112): no tenant set.
- **Plain `db`** (the connecting role). Used for tenant tables in:
  - dashboard.ts. Its comment (26-28): "On the dev DB the app connects as superuser so this just works; on a real Postgres it needs the admin role."
  - claude-center.ts, insights.ts.
  - chat/index.ts: resolveTopic 83-121, listConversations 594-620.
  - chat/proposals.ts loadCard; actions/index.ts:65-68 taskRow; tasks.ts:419-422 clientOfTask; context.ts locateWorkItem.
  - Every `flow_run` read (that table has no row-level security).

## 2. The API

- All routes are in API/server.ts (1813 lines); there are no route files.
- **162 registrations:** 70 GET, 66 POST, 10 PATCH, 4 PUT, 12 DELETE. This includes one WebSocket route (561) and two PGlite-only routes (GET /dev/workitems, POST /admin/shutdown).
- The error handler (201-216) maps typed refusals (OnboardingError, ActionRefused, ChatError, PolicyError, ReviewRefused, RepoRequired, AttachmentRefused, PromptRefused, FolderRefused) to 409/400. It maps Zod errors to 400.

### Routes by domain

**Requirement — 39 routes**
- Reads: GET /workitems/:id (810), /timeline (774), /brief (780), /cost (790), /cost-detail (1311), /calls (1319), /tasks (1534), /task-flow (1059), /spec (1071), /spec/preview (1079), /flow-run (1006), /assess-preview (923), /breakdown-preview (946), /bug-links (954), /attachments/:attId/content (1261); GET /requirements/:id/flow (1470).
- Create/edit/delete: POST /workitems (1683), PATCH /workitems/:id (834), DELETE /workitems/:id (1737).
- Repos and links: POST /repos (858), DELETE /repos/:repoId (877), POST /bug-links (959), DELETE /bug-links/:taskId (966), POST /depends-on (1475), DELETE /depends-on/:depId (1278), POST /attachments (1249).
- Lifecycle actions: POST /start (884), /assign (891), /assess (908), /breakdown (931), /research/start (991), /research/finish (997), /flow-run/stop (1015), /flow-run/message (1024), /spec/map (1088), POST /tasks (1540).
- Contention and review: POST /touches (1418), /touches/release (1434), /review (1449).

**Task — 28 routes**
- Reads: GET /tasks/:id (1112), /runs/:runId/log (1122), /built-on (1141), /implement-preview (1147), /spec (1171), /flow-run (1184), /code-map (1204), /files (1214), /file (1220), /delete-check (1385), /overlaps (1592).
- Development: POST /checks/e2e (1130), /implement (1161), /rollback (1193), /push (1227), /merge-dependency (1599).
- Approval and status: POST /approve (1235), /reject (1242), /progress (1549), /active (1618), /ado-recheck (1628).
- Edit and delete: PATCH /tasks/:id (1367), DELETE /tasks/:id (1393), PUT /spec (1177).
- Manual development: PUT /manual (1571), POST and DELETE /manual-report (1578, 1585), POST /manual-result (1607; the id there is the check's id).

**Repository onboarding — 14 routes**
- GET /onboarding/stages (356).
- Under /repos/:id/onboarding: POST /runs (361), GET /latest-run (368), GET /runs (373), GET /runs/:runId (378).
- Under a run: POST /stages/:stageKey/run (384), /session/resume (390), /review/refresh (396), /review/approve (402), /cancel (408); PATCH /automation (414), /model-choices (421); GET /file (428); WebSocket /terminal (561).

**Chat — 12 routes**
- POST /claude/chat/open (446), /claude/chat/ask (452), /claude/messages/:id/helpful (458).
- GET /claude/conversations (465), /claude/conversations/:id (471).
- POST /claude/proposals/:id/run (480) and /cancel (484); GET /claude/proposals/:id/preview (488).
- POST /claude/messages/:id/run-code (532) and /run-code/cancel (536).
- GET /claude/glossary (542), /claude/glossary/:screen (547).

**Clients and repos — 12 routes**
- GET /clients (227), GET /clients/:id (228), PATCH (232), DELETE (243).
- GET /repos (229), PATCH /repos/:id (248), DELETE /repos/:id (260).
- POST /clients/:id/repos (601), DELETE /clients/:cid/repos/:repoId (609).
- GET /clients/:clientId/inbox (804), GET /clients/:id/tasks (975), GET /repos/:repo/contention (1442).

**Claude control center, insights, policy — 11 routes**
- GET /claude/insights (494), POST /claude/insights/analyse (500), POST /claude/insights/:id/task (505), POST /claude/insights/:id/dismiss (510).
- GET and PUT /claude/policy (514, 518); PUT /clients/:id/claude-retention (522); POST /claude/retention/run (528).
- GET /claude/overview (1506), /claude/calls (1511), /claude/calls/:id (1516).

**Azure DevOps and connections — 11 routes**
- GET /connections (230), POST /clients/:id/import/ado-csv (616), POST /connections/ado/projects (628).
- POST /clients/:id/connections/ado (634); PATCH, POST /check and DELETE on /clients/:cid/connections/:id (642, 649, 655).
- GET /ado-tasks (1043), GET /clients/:id/ado-tasks (1051), POST /workitems/:id/materialize (1097), POST /workitems/:id/ado-link (1748).

**Pull requests — 10 routes**
- GET /pull-requests (275).
- Under /repos/:id/pull-requests/:number: GET /quick (281), GET detail (287), GET /file (294), POST /review (302), GET /conflict (310), POST /conflict/verify (318), POST /conflict/resolve (327), POST /merge (336).
- GET /repos/:id/branches (343).

**Gaps and blockers — 9 routes**
- POST /workitems/:id/gaps (1293), POST /gaps/:id/verify (1326), PATCH and DELETE /gaps/:id (1343, 1349).
- POST /workitems/:id/blockers (1637), POST /blockers/:id/answer (1648), PATCH and DELETE /blockers/:id (1355, 1361), GET /clients/:clientId/blockers (1285).

**Dashboard, lists, audit — 6 routes**
- GET /dashboard (222), /list/workitems (661), /list/initiatives (682), /list/budgets (683), /list/alerts (684), /audit (686).

**Admin and misc — 6 routes**
- GET /health (218), GET /users (255), POST /open-folder (266), GET /dev/workitems (699), POST /admin/setup-client (1659), POST /admin/shutdown (1764).

**Prompts — 2 routes:** GET /prompts (665), PATCH /prompts/:id (670).

**Hook capture — 2 routes:** POST /events (740), GET /resolve (797).

### Auth and startup
- **Auth** is `actingUser` (context.ts:18-44): header `x-dcc-hook-token` must equal the env `DCC_HOOK_TOKEN`, and `x-dcc-dev-email` maps to a `users` row. The file calls this "Phase 0 request identity. NOT production auth — a pilot shim" (context.ts:7-13).
- **There is no global hook.** These 24 GET routes never call `actingUser`:
  - /health, /clients, /clients/:id, /repos, /connections, /users
  - /list/workitems, /list/initiatives, /list/budgets, /audit, /dev/workitems
  - /workitems/:id/timeline, /brief, /cost; /resolve; /clients/:clientId/inbox
  - /workitems/:id, /bug-links, /flow-run, /task-flow, /cost-detail
  - /repos/:repo/contention, /requirements/:id/flow, /workitems/:id/tasks
  - Also POST /admin/shutdown.
- **No per-user client authorization.** The tenant comes from locating the entity, or from a `clientId` in the request body (approve/reject/progress/active, gap/blocker/task PATCH and DELETE).
- **Startup jobs** (server.ts:1774-1790): recoverOnboardingRuns, recoverFlowRuns, backfillStandardChecks, resyncTaskStates, and `scheduleRetention` (a daily timer inside the API process).
- **Routes with no caller in web, hooks or skills:** /workitems/:id/cost-detail, /workitems/:id/ado-link, POST /workitems/:id/depends-on, GET and PUT /tasks/:id/spec, /claude/glossary/:screen, /claude/calls/:id. /inbox and /timeline are used only by smoke.ts.

## 3. The screens

### Routing and navigation
- Hash router in WEB/App.tsx: `useHash` at 29-37, an if/else chain at 58-88.
- Sidebar (App.tsx:40-52), 11 items: לוח בקרה `#/`, לקוחות `#/clients`, דרישות `#/requirements`, Azure DevOps `#/ado`, Repositories `#/repositories`, בקשות מיזוג `#/pull-requests`, קלוד `#/claude`, פרומפטים `#/prompts`, הגדרות `#/settings`, משתמשים `#/users` (a stub), יומן פעילויות `#/audit`.
- Reachable but not in the sidebar: `#/work`, `#/alerts`, `#/budgets` (comment at App.tsx:39).
- Old aliases: `#/project/:id` opens Record; `#/projects` opens RequirementList.
- The chat dock `ClaudeChat` is mounted once over every screen (App.tsx:127).
- Live updates are polling: Record every 2s (Record.tsx:133), WorkflowTab 1.5s (251), TaskDetail 1.5s (262), OnboardingScreen 2s (68). The only socket is the onboarding terminal.

### Screen files

Paths are under WEB/screens. Paths in the API column are relative to /api.

| File (lines) | Route | Shows | API calls |
|---|---|---|---|
| Dashboard (186) | `#/` | 4 stat tiles, top-level requirements, recent work items, alerts, quick actions | GET /dashboard |
| ClientList (36) | `#/clients` | Clients with spend and budget; "new client" form | GET /clients; POST /admin/setup-client (from forms.tsx) |
| ClientDetail (216) | `#/client/:id` | Client, its requirement forest, TFS task tree, connections, repos | GET /clients/:id, /clients/:id/ado-tasks; check/delete connection; delete/unlink repo; delete client; approve task |
| RequirementList (61) | `#/requirements` | Top-level requirements | GET /list/initiatives; DELETE /workitems/:id |
| WorkList (79) | `#/work` | All requirements; "new requirement" form | GET /list/workitems; POST /workitems and /events (from forms) |
| Record (682) | `#/wi/:id` | One requirement. Tabs: Overview (WorkflowTab plus gaps, blockers, attachments, repos, cost), Timeline, Dependencies | GET /workitems/:id, /brief, /cost, /calls, /flow-run (polled); POST /gaps/:id/verify, /blockers/:id/answer; DELETE gap, blocker, requirement; attachments; unlink repo; POST /events (note corrections); POST gaps/blockers through its own fetch (269, 394) |
| WorkflowTab (917; inside Record) | — | Step wizard: assess → gaps → breakdown → approve/TFS → start. Research type: assess → gaps → work | GET /task-flow, /flow-run (polled), /users, /prompts, /assess-preview, /breakdown-preview; POST assess, breakdown, start, assign, materialize, research start/finish, flow-run stop/message; approve/reject/active on tasks |
| FlowGraph (86; Record tab) | — | Requirement-to-requirement dependency graph | GET /requirements/:id/flow |
| FlowFullPage (29) | `#/flow/:id` | RequirementMap on a full page | GET /workitems/:id, /task-flow |
| RequirementMap (245) | — | Tasks (list or cards) beside the spec | GET /workitems/:id/spec, /spec/preview; POST /spec/map |
| SpecPane (199), TaskTree (177), TaskGraph (567), TaskBrief (84) | — | Spec document with marks; nested task list; flow cards; per-task brief | Props only; TaskGraph calls setTaskActive |
| TaskDetail (1495; 65 useState) | `#/task/:id` | One task: status, flow steps, prompt, dependencies, built-on, runs, checks, files, code map, overlaps, manual mode, edit/delete | GET /tasks/:id (polled) and 11 other task GETs; POST implement, approve, progress, rollback, push, checks/e2e, merge-dependency, active, ado-recheck, manual-result; PUT /manual; POST/DELETE manual-report; PATCH /tasks/:id; DELETE /tasks/:id |
| ManualWork (138) | — | Pieces of TaskDetail for manual development | none |
| AdoTasks (130) | `#/ado` | Org-wide TFS task mirror by client and requirement | GET /ado-tasks; POST /tasks/:id/approve |
| Repositories (87) | `#/repositories` | All repos, links to onboarding | GET /repos; latest onboarding run per repo |
| onboarding/OnboardingScreen (529), Terminal (108), rail (242), labels (98) | `#/repo/:id` | Four stage cards, live terminal, review diff, automation/model/cost/event panels | The 13 onboarding routes and WebSocket /terminal; GET /repos, /users |
| PullRequests (163) | `#/pull-requests` | Open and recent PRs, with flags | GET /pull-requests; prefetches detail |
| PullRequestDetail (549) | `#/pull-requests/:repoId/:n[/tab]` | Tabs: overview, files, timeline, branches | GET quick, detail, file, /repos/:id/branches; POST review, merge |
| PullRequestConflict (392) | `#/pull-requests/:repoId/:n/conflict` | Three-pane conflict decision | GET conflict; POST conflict/verify, conflict/resolve |
| ClaudeCenter (600) | `#/claude[/tab[/id]]` | Tabs: overview, calls, conversations, insights, policy | /claude/overview, /calls, /conversations, /insights (+ analyse, task, dismiss), /policy GET/PUT, claude-retention, GET /clients |
| Prompts (213) | `#/prompts` | Prompt library, with contract problems per prompt | GET /prompts; PATCH /prompts/:id |
| Settings (75) | `#/settings` | Connections and repos | GET /connections, /repos; DELETE connection, repo |
| AuditTrail (107) | `#/audit` | Cross-client event list with filters | GET /audit |
| Alerts (37), Budgets (44) | `#/alerts`, `#/budgets` | Notifications; per-client budget use | GET /list/alerts, /list/budgets |
| Stub (11) | `#/users` | "בבנייה" | none |

### Shared pieces
- **Chat dock:** claude/ClaudeChat.tsx calls /claude/chat/open, /claude/chat/ask, /helpful and /conversations/:id. ProposalCard.tsx handles proposals run/cancel/preview and run-code. Info.tsx loads GET /claude/glossary once.
- **Screens that register chat context** (`useClaudeContext`): Record, TaskDetail, OnboardingScreen, PullRequestDetail, PullRequestConflict, Dashboard, Budgets, ClaudeCenter.
- **Actions each screen offers the chat:** Record `["assess","breakdown"]` (Record.tsx:169); TaskDetail `["implement","approve_task"]` (313); Onboarding `["send_to_session"]` (91).

## 4. The requirement lifecycle

- **Phase enum** `workitem_phase`: intake, shaping, building, review, done, archived (DB/src/schema/enums.ts). Its comment says "Status is a spectrum, not a gate".
- **`requirement_type`**: development, research, testing.

### Every place that writes `phase`

| Transition | Where | Condition |
|---|---|---|
| Created as `intake` | POST /workitems (server.ts:1712-1732); setupClient (admin.ts:83); verifyGap spin-off (gaps.ts:122-131, new sibling of type task); openImprovementTask (insights.ts:248-253); importAdoCsv (state mapped) | Column default |
| → `shaping` | End of every `runAssess`: `const patch = { phase: "shaping", updatedAt: new Date() }` (ai-assist.ts:1058-1062) | **None.** The current phase is not checked, so a building or done requirement goes back to shaping. It also replaces titles of 6 characters or fewer with Claude's title (1059). |
| → `building` | `startBuilding` (start-build.ts:77-86): `const moved = wi.phase === "intake" \|\| wi.phase === "shaping";` then sets building and writes `status.changed` | Only the phase check. Open blocking gaps and open blockers are counted (50-57) and stored as the flag `startedWithOpenBlocker` (60, 80), not refused. Also assigns key `WI-<n>` if missing (35-48) and, if the requirement has `linkedAdoId`, calls `syncRequirementToAdo` (93). |
| → `done` | `finishResearchWork` → `updateRequirement({phase: "done"})` (research-work.ts:79) | Conclusion must be non-empty (57) |
| → any phase | PATCH /workitems/:id → `updateRequirement` (crud.ts:84-138) → `requirement.updated` event | Reopening records `decision.made` only if a reason is given (127-134). crud.ts:89-92 says "the route enforces it", but server.ts:834-856 passes `reopenReason` as optional; only the web form requires it (forms.tsx:563-567). |
| From ADO | `reconcileOne` (ado-pull.ts:73, 80-83) | Its entry points `pullFromAdo`/`pullOneFromAdo` have no callers |

- **No code sets `review` or `archived`** except the PATCH route (and the uncalled ADO mapping).

### Web-only gates (WEB/screens/WorkflowTab.tsx)
- `assessNote` (191-193) is the latest `note.added` event whose body starts with `"סיכום Claude"`. That is the note `runAssess` writes (ai-assist.ts:1033-1046).
- A gap counts as open if its state is proposed or verified (187).
- The step conditions (203-219), quoted:

```
done = isResearch
 ? [ !!assessNote, !!assessNote && openGaps === 0, wi.phase === "done" ]
 : [ !!assessNote,
     !!assessNote && openGaps === 0,          // "EVERY gap must be closed before breakdown — not just the blocking ones" (211-213)
     nodes.length > 0,
     nodes.length > 0 && pending.length === 0 && unsynced.length === 0,
     wi.phase === "building" || wi.phase === "review" || wi.phase === "done" ];
unlocked = done.map((_, i) => i === 0 || done[i - 1] === true);
```

- The header comment (24-25) says instead: "you cannot break down while blocking gaps are open".
- Assess and breakdown are sent only after the prompt-preview modal is confirmed (`pendingKick`, 177-179).

### Server-side gates
- **Assess and breakdown:** `allowed: async () => ({ ok: true })` (actions/index.ts:75, 84). No gap or phase check, and Record always offers both actions to the chat.
- **A development requirement needs a repo checkout** for assess and breakdown (`requireCheckout`, ai-assist.ts:861-884, throws `RepoRequired`). Research and testing may run on the text alone.
- **Re-breakdown** deletes `task.origin = 'ai' and linked_ado_id is null` (ai-assist.ts:1146-1148); approval state is not checked. With a reason it records `decision.made` "rebreakdown" (server.ts:936-940).
- **Materialize** requires an active ADO connection with a project and at least one approved, non-dropped task (task-ado-sync.ts:53-58, 73, 82).
- **Gaps:** proposed → verified | resolved | dismissed | spun_off through `verifyGap` (gaps.ts:82-159). Resolve/dismiss answers become a `note.added` plus `gap.answer`.
- **Blockers:** open → answered (blockers.ts:54-84), routed to the requirement owner (23, 34). The `abandoned` state is never set.

### Research and testing requirements
- `startResearchWork` (research-work.ts:29-50) creates one task (seq 1, origin human, adoType Task), then `approveTask` → materialize.
- `finishResearchWork` calls `progressTask(to "done")` with no override (76).
- **Code trace (not run):** `approveTask` always calls `ensureStandardChecks` (ai-assist.ts:2614), which adds build/tests/regression checks to a leaf task (1725-1745). `progressTask(done)` throws `ChecksNotPassed` while any active check result is not `passed` (tasks.ts:147-161). No test or proof covers this path.

## 5. The task lifecycle

### Rows and states
- One `task` table holds both `kind='task'` rows and `kind='check'` rows. A check is a leaf with a parent task (workitem.ts:218-226).
- **Stored `task_state`:** pending, in_progress, blocked, failed_checks, done, dropped. Check rows store passed → `done`, anything else → `pending` (ai-assist.ts:1827, 1872).
- Check fields: `checkResult` passed | failed | waiting | null; `checkKind` build | tests | regression | e2e | null; `checkCause` implementation | requirement_ambiguity | dependency_missing | environment.
- Other fields: `active`, `approvedAt`/`approvedBy`, `developedManually`, `wasDone`, `branch`, `baseTaskId`/`baseBranch`/`baseSha`/`builtWithout`, `linkedAdoId`/`adoUrl`/`adoType`.

### What writes the stored state
- **pending:** inserts by breakdown (ai-assist.ts:1161), `proposeTasks` (tasks.ts:45-110), `ensureStandardChecks`, research start; `rollbackTask` resets to pending (2244-2252).
- **in_progress:** set in these places:
  - `runImplement` after a commit that changed files (2093).
  - A manual report (manual-work.ts:113).
  - `mergeDependencyIntoTask` (task-merge.ts:130-133).
  - Leaving `failed_checks` (task-status.ts:190).
- **failed_checks:** `syncTaskStateAfterCheckChange` → `storedStateAfterChecks` whenever at least one active check failed (tasks.ts:216-226; task-status.ts:184-192). `wasDone` remembers whether the task was done before.
- **done:** `progressTask` (gate below), or a check row that passed.
- **blocked:** only `progressTask(to "blocked")` (manual).
- **dropped:** `rejectTask` (ai-assist.ts:2628-2635) or `progressTask`.
- **`active`:** `setTaskActive` (tasks.ts:280-322). Deactivating cascades to descendants and mirrors TFS state "Removed".
- **Approval:** `approveTask` (2596-2626) stamps the task and its unapproved child checks, adds the standard checks, regenerates the brief, then calls `materializeTasksToAdo` for the whole requirement if an ADO connection exists. It writes no event of its own.

### Computed status (never stored)
- task-status.ts:15-21 defines 18 keys: inactive, dropped, awaiting_approval, awaiting_tfs, ready, blocked, running, failed, build_pending, checks_pending, waiting_dependency, review, done, group_open, check_passed, check_failed, check_waiting, check_not_run.
- `phaseStatus` (88-151) checks in this order:
  1. inactive → dropped → done
  2. not approved → awaiting_approval
  3. running
  4. not in TFS and not developed → awaiting_tfs
  5. group rules
  6. failed checks → last-run error → blocked
  7. not developed → ready
  8. build not run → build_pending; other checks not run → checks_pending
  9. waiting_dependency (dependency available / base moved / open dependency / check waiting)
  10. review
- `dependencyTag` (213-220) is shown beside the status and is not a gate.
- The facts come from `statusFactsFor` (ai-assist.ts:1443-1495): task rows, `flow_run` rows, the in-memory live run phase (`liveTaskPhase`), and git in the existing clone.

### Flow steps (task-flow-steps.ts)
- Step kinds develop | dependency | checks | review; step states done | current | todo | failed | waiting.
- A new round starts when a run gained a dependency (`gainedDeps`, 92-98).
- `taskFlowOf` (ai-assist.ts:1552-1600) overlays the live check state on the last run (1582-1585).

### TFS types, relations, "built on"
- **TFS type by structure** (task-types.ts):
  - A leaf is a Task; a node holding Tasks is a User Story, then Feature, then Epic.
  - `requirementRung` applies when there are at least 2 top-level nodes of height 1 or more.
  - Maximum depth 4 (ado-map.ts:78).
- **Relations** (task-relations.ts:25-67):
  - A "group" is a task with active sub-tasks. It is never developed itself.
  - A dependency on a group expands to its sub-tasks; a dependency on a check expands to the check's task. A sub-task inherits its group's dependencies.
  - `waitingOn` is the reverse relation.
- **Built on:**
  - `chooseBase` (task-base.ts:39-54) picks the one dependency branch that is unmerged, has its own commits and contains the other candidates; otherwise the task builds from the default branch. The rest are listed as missing (not_developed or parallel).
  - The first implement run records the base (ai-assist.ts:2012-2031). Rollback clears it (2244-2249).
  - `mergeDependencyIntoTask` merges only after a clean `git merge-tree` preview and resets the checks (task-merge.ts:87-145).
  - `taskOverlaps` lists other developed tasks that changed the same files (50-76).
- **Branch naming** (task-branch.ts:18-23):
  - New task branches are named `task/<REQKEY|REQ>-t<seq>-<slug>`; `branchOf` prefers the stored `task.branch`.
  - `startBuilding` separately returns `task/<KEY>-<slug>` for a person's own session (start-build.ts:76).
  - The work happens in a cache clone `~/.dcc-repos/<repoId>` (ai-assist.ts:56); `repo.localPath` is never used for writes (1963-1967).

### Checks, builds, tests
- **Standard checks** build, tests and regression (ai-assist.ts:1709-1716) are added:
  - at breakdown (1225-1229)
  - at approval (2614)
  - at implement (2059)
  - by a startup backfill (1766-1772)
- e2e is added on request (server.ts:1130-1135).
- Each check stores a rendered copy of the `check.<kind>` prompt at creation (1734-1736).
- **`runImplement`** (1951-2145) runs three steps:
  1. **Develop.** CLI with Read, Grep, Glob, Edit, Write, Bash; acceptEdits; max 80 turns; prompt `implement.task`. Then `git add -A` and a local commit under the acting person's name (2081-2091).
  2. **Build.** No model (`runBuildStep`, 1800-1839). `build-recipe.ts` finds the project of each changed file plus declared components: SDK csproj → `dotnet build`, legacy csproj → classic MSBuild, package.json with a build script → `npm run build`. Projects build one at a time.
  3. **Other checks, only if the build passed** (`runChecksStep`, 1848-1887). One CLI call with Read, Grep, Glob, Bash and no edit tools, prompt `checks.run`, signal `mechanical: true`. Any change to tracked files is reverted (1859-1863). A `dependency_missing` cause becomes `waiting` (1870).
- A single check can be run by itself (2033-2049). A group's check merges all sub-task branches into `<branch>-together` (1928-1949).
- **Manual development:** a report is stored as a `flow_run` whose result has `manual` (manual-work.ts:106-112); checks are set by hand.

### Server gates on a task
- **Done** (tasks.ts:147-161). Unresolved checks are those under the task with `kind='check'`, `active`, not dropped, and `checkResult is distinct from 'passed'`. Then: `if ((unresolved.length > 0 || depBlockers.length > 0) && !input.overrideChecks) throw new ChecksNotPassed(...)`.
  - `depBlockers` comes from `taskDoneBlockers` (ai-assist.ts:1603-1611): open sub-tasks, open dependencies, work built without a dependency, a moved base.
  - An override writes `decision.made` "task_closed_override" when a reason is given; reopening writes "task_reopened".
- **Implement** (actions/index.ts:93-104) requires:
  - `approvedAt`
  - `linkedAdoId != null` ("not yet in TFS")
  - the task is not a group
  - the owner task is not developed manually

  `runImplement` checks approval again (ai-assist.ts:1956).
- **Push** (2301-2355): manual `git push -u origin` with the operator's credentials, 25s timeout, plus a compare URL.
- **Delete** (2401-2584): requires explicit confirmations; TFS items are never deleted, a history note is posted there instead.

### Reaching TFS and syncing back
- **To TFS** (task-ado-sync.ts:52-190):
  - Approved tasks are created top-down, with their structural type.
  - Parent links use Hierarchy-Reverse and dependencies use Dependency-Reverse.
  - Checks are not created as work items; they are posted as a checklist into the parent's System.History.
- **Back to TFS from edits:** title changes in `editTask` (203-257); Removed / restore state in `setTaskActive` (tasks.ts:249-264).
- **From TFS:** `checkAdoRemovedState` only, when a person presses the button (tasks.ts:330-350).
- `progressTask` never writes TFS state; `TASK_STATE_TO_ADO_STATE` is used only at tasks.ts:257.

## 6. How Claude is invoked

### Mechanism
- **The local `claude` CLI only.** ai-assist.ts:30-35: "LOCAL `claude` CLI — the user's own logged-in session (no API key)".
- **Flags** (`runClaudeRaw`, 397-569): `-p --output-format stream-json --verbose --permission-mode acceptEdits --allowed-tools … --max-turns N --model M --effort E`.
  - Steerable runs add `--input-format stream-json`.
  - "Lean" calls add `--system-prompt-file --tools <list|NoTools> --disable-slash-commands --strict-mcp-config --setting-sources local` and a session id/resume (455-461).
  - Deny rules go through a temporary `--settings` file (473-478).
- The prompt goes on stdin. Cost and usage come from the final result line (529-558). `runClaudeJson` extracts JSON from the text (591-603).
- **Onboarding** uses the interactive CLI in node-pty (repo-onboarding/session.ts:167-204): `--session-id`/`--resume`, a status-line `--settings`, `--model`, `--effort`, `/init`, with env `CLAUDE_CODE_NEW_INIT=1`.
- **No `@anthropic-ai` package, Agent SDK or ANTHROPIC_API_KEY** anywhere, although openspec/project.md:50-52 lists the Claude Agent SDK.
- **Live run state is in memory:** `buffers` (71), `runningProcs` (99), stop/steer (111-140). `flow_run` is written at the end (241-251). `recoverFlowRuns` marks orphaned runs as errors at startup (204-210).
- **Ledger:** `recordCall` (373-395) writes one `claude_call` row for every call, including refused, timed-out and stopped ones. `recordClaudeCall` also adds a thin `claude.call` timeline event when a requirement is set (DB/src/ledger/index.ts:103-113).

### Routing (routing.ts + R/config/model-policy.json, version 7)
- `route()` (167-202) is called only at ai-assist.ts:439, with `overrides` always undefined. A person's per-call model/effort choice wins.
- Tiers:

| Tier | Model | Cap per call |
|---|---|---|
| haiku | claude-haiku-4-5-20251001 | $0.05 |
| sonnet | claude-sonnet-5 | $0.75 |
| opus | claude-opus-5 | $4 |

- Capabilities (policy defaults):

| Capability | Tier / effort | Escalate / downgrade rules |
|---|---|---|
| gap_detection | sonnet / medium | escalate on ambiguity high |
| decomposition | sonnet / medium | escalate on breadth ≥ 4, openGaps ≥ 3, novelty high |
| execution | sonnet / high | escalate on breadth ≥ 5, ambiguity, novelty; downgrade to haiku when `mechanical` |
| onboarding_init | sonnet / high | — |
| chat | haiku / low | maxInputTokens 60000 |
| chat_code_read | sonnet / medium | — |
| onboarding_file_notes | haiku / low | — |
| conversation_summary | haiku / low | — |
| usage_insights | sonnet / medium | — |
| interactive_session | sonnet | ledger only |

- **Signals actually passed:** only `mechanical` (ai-assist.ts:1856 true, 2077 false, 2696 true). So `checks.run` downgrades to Haiku; `spec.map` does not (decomposition has no downgrade rule). ambiguity, breadth, openGaps and novelty appear only in routing.prove.ts.
- **Enforcement:** an input-token cap refusal exists (445-450). `budgetUsd` is computed but not enforced, and `guardrails` values are not read.
- **Editing the policy:** `savePolicy` rewrites R/config/model-policy.json and bumps the version (routing.ts:110-115). `updatePolicy` (policy-admin.ts:86-110) writes a `policy.changed` event.

### Prompt registry
- **Table** `prompt_template` (DB/src/schema/prompts.ts): key, title, description, body, body_he (Hebrew, shown in the preview only, never sent), default_model, sort_order, updated_at/by. No version column.
- **Text source:** SQL migrations 0020, 0021, 0022, 0023, 0037 (deletes the retired letter-to-requester prompt key), 0040, 0041, 0042 (adds checks, deletes the old in-prompt check key).
- `requirePrompt` throws when a row is missing (prompts.ts:57-61).
- `updatePrompt` (63-82) validates with `contractProblems`, overwrites in place, and writes no event.
- **prompt-contract.ts:** `PROMPT_USES` (35-82) defines 22 keys (capability, required and optional variables, `keeps` = strings parsed back from the answer); `renderPrompt` supports `{{X}}`, `{{#X}}` and `{{^X}}` (92-101).
- **Which feature uses which prompt:**

| Prompt key(s) | Built in | Capability | Triggered by |
|---|---|---|---|
| assess.readiness.{quick, standard, thorough, audit, custom} + assess.shared.output_contract (appended) | `buildAssessPrompt` (ai-assist.ts:941-975) | gap_detection; person may pick the model per run | POST /workitems/:id/assess, chat proposal |
| breakdown.tasks | ai-assist.ts:1085-1099 | decomposition | POST /workitems/:id/breakdown, chat proposal |
| implement.task | ai-assist.ts:1638-1675 | execution | POST /tasks/:id/implement, chat proposal |
| checks.run | ai-assist.ts:1681-1704 | execution, mechanical (→ haiku) | inside implement runs |
| check.build / .tests / .regression / .e2e | copied onto check rows (ai-assist.ts:1734-1736) | — | never sent on their own; the build check never reaches a model |
| spec.map | ai-assist.ts:2654-2678 | decomposition | POST /workitems/:id/spec/map |
| chat.system | chat/index.ts:281-284 | chat | chat questions step zero cannot answer |
| chat.rollover_summary | chat/index.ts:338-365 | conversation_summary | conversation roll-over |
| gaps.conversation | chat/index.ts:546-574 | chat_code_read | the gaps conversation |
| chat.code_read.{repo, pull_request, onboarding_run} | chat/proposals.ts:89-181 | chat_code_read | approved "declared cost" card |
| insights.clusters | insights.ts:194-231 | usage_insights | POST /claude/insights/analyse |
| onboarding.file_notes | repo-onboarding/runs.ts:568-575 | onboarding_file_notes | onboarding review |

- The onboarding `/init` itself is Claude Code's own command; it is recorded in the ledger as `onboarding_init` slices and is not routed through `route()`.
- **build-recipe.ts** is the deterministic, model-free build planner described in section 5.

## 7. The event log

### The table and its guards
- **`event_log`** (DB/src/schema/events.ts:44-93):
  - Primary key (client_id, id).
  - `workitem_id` nullable (the unassigned inbox).
  - `occurred_at` and `recorded_at`; `source` enum; free-text `type`; `schema_version`.
  - `actor` jsonb: user, delegated or system.
  - `payload`, `supersedes`, `links` (10 relation kinds).
  - Row-level security.
- **Append-only triggers:** DB/sql/guards.sql:18-51. The only update allowed is the foreign-key detach when a requirement is deleted. An `occurred_at` check is at 54-56.
- **Writer `appendEvent`** (DB/src/events/index.ts:38-74):
  - zod envelope validation;
  - a `system` actor may not write reasoning types (gap.proposed, tasks.proposed, claude.call, blocker.raised; 31-36);
  - per-type payload schema;
  - insert inside `withTenant`.

### Types
- **20 registered types** (payloads.ts:175-196): message.ingested, message.match_confirmed, claude.session, git.activity, gap.proposed, gap.verified, tasks.proposed, task.progressed, review.completed, blocker.raised, blocker.answered, status.changed, claude.call, ado.synced, note.added, requirement.updated, repo.linked, repo.unlinked, decision.made, policy.changed.
- **18 are written.** message.ingested and message.match_confirmed are never written.
- **`note.added` is the most common:** about 24 production sites. Its payload is just `{body, corrects?}`, so check verdicts, runs, rollbacks, pushes, deletions, merges, manual reports, spec reads and attachments are all Hebrew free-text notes.
- `linkWorkItems` writes a `status.changed` event whose payload is "no dependency" → "depends on <uuid>", with link rel `ado_workitem` pointing at a DCC id (flow.ts:38-46).

### appendEvent call sites: 52 total (48 production, 4 in DB/src/dev/prove.ts)

| Module | Sites |
|---|---|
| ai-assist | 11 |
| ado-pull | 4 |
| tasks, task-ado-sync, gaps, crud, capture | 3 each |
| policy-admin, import-ado, blockers, ado-sync | 2 each |
| task-merge, start-build, spec-map, research-work, manual-work (a `note` helper called 4 times), insights, flow, decisions, contention, db ledger | 1 each |

### Mutations that write no event
- Requirement creation: server.ts:1683-1735; no `requirement.created` type exists.
- Owner assignment (891-904) and ado-link (1748-1757).
- `approveTask` and `rejectTask`.
- `updatePrompt`.
- Gap, blocker, task and dependency edits and deletes (crud.ts:231-296); `deleteRequirement` (144-151).
- Client, repo and connection CRUD.

### Other append-only streams
- `repo_ai_event` (onboarding, 19 `onboarding.*` types, through `appendRepoAiEvent`).
- `claude_call` (append-only by trigger, guards.sql:63-89).

### Reads that come from the log
- `timeline()` and `unassigned()` (events/index.ts:77-104).
- The context brief's last 15 events (brief/generate.ts:53-63).
- Prompt context: `loadRequirementText` (ai-assist.ts:816-835, up to 40 notes) and `requirementContext` (1620-1631, up to 20 notes, cut to 6000 characters).
- The audit trail (dashboard.ts:214-238) and the last policy change (policy-admin.ts:72-73).
- The web's "assess done" check (WorkflowTab.tsx:191-193).

### Reads from mutable tables
- Phase and fields, gaps, blockers, tasks and statuses, approvals, check results, TFS links.
- Cost (`claude_call`), dashboard counts, chat, onboarding, spec.
- `context_brief` is a derived cache rebuilt synchronously after nearly every change (47 call sites; "never LLM-summarised", modelUsed "assembled/v0").

## 8. Azure DevOps

### Files
- **ado-http.ts:** walks API versions 7.1 → 4.1 and caches the working one per host; 20s timeout; treats a 404 as "resource missing" only when the body is a structured error.
- **ado-map.ts:** type and state maps.
- **ado-url.ts:** splits pasted URLs into org and project.
- **ado-sync.ts:** `activeAdoConnection`, `syncRequirementToAdo`, and uncalled helpers.
- **task-ado-sync.ts:** materialize and `editTask`.
- **ado-pull.ts:** reconcile (uncalled) and attachments.
- **import-ado.ts:** CSV import.
- **clients.ts:** add, check and list ADO connections and projects.

### What moves in which direction

| Direction | What | Trigger |
|---|---|---|
| DCC → TFS | Create tasks with types, hierarchy links, dependency links, check checklist | Approve (automatic when a connection exists) or POST materialize |
| DCC → TFS | Task title | Task edit |
| DCC → TFS | State Removed / restored | Deactivate / reactivate a task |
| DCC → TFS | History note on delete; items are never deleted | Task delete |
| DCC → TFS | Attachment upload plus AttachedFile link | Attachment add (ado-pull.ts:273-321) |
| DCC → TFS | Requirement title and state | `startBuilding`, only when the requirement has a `linkedAdoId` |
| TFS → DCC | "Removed" state | POST /tasks/:id/ado-recheck (button) |
| TFS → DCC | CSV import creates requirements keyed `ADO-<id>` | POST /clients/:id/import/ado-csv |

- **Never called:** `pullFromAdo`, `pullOneFromAdo`, `adoWorkItemExists` (ado-pull.ts:143-231) and `syncAllToAdo`, `trySyncNewRequirement`, `deleteAdoForRequirement` (ado-sync.ts:129-177).
- **No poller or webhook:** tasks.ts:325-329 and server.ts:1625-1627 say so.
- **Source of truth, as stated:**
  - project.md says "ADO is SoT for Work Items".
  - Code comments say requirements are DCC-only and never pushed (server.ts:623-625; task-ado-sync.ts:9-12), while start-build.ts:93 does push linked requirements.
  - Task state stays in DCC; only "Removed" is pulled.
  - Attachments: "TFS is the mirror, not the store" (ado-pull.ts:287-288).
- **PAT storage:** stored as-is in `service_connection.secret_ref` (clients.ts:175, "pilot: stored directly; prod: Key Vault path").

## 9. The chat

### Scope
- One active conversation per (client, topicKey, person) (chat/index.ts:133-140).
- The topic comes from the screen (web context.ts), never from the person. Topic keys: `wi:`, `gaps:`, `task:`, `pr:<repo>/<n>`, `run:`, `app`.
- `app` uses the "DCC Internal" client, else the clientId in `.dcc.json`, else the oldest client (65-79).
- Screen facts are resent only when their hash changes (444-455).

### Step zero: answers with no model call (237-253)
1. A regex asks "what is this screen?" → the screen's `about` text.
2. Hebrew regex templates over screen facts (222-235): next step, cost, owner, status, open gaps, conflict files, blocker.
3. `matchGlossary` with certainty "certain" (a question word and 12 words or fewer) → the concept text.
- These answers are stored as `source "system"` messages with no ledger row.
- The glossary has 223 concepts in 9 files (CORE/glossary/concepts); 8 screens have an `about` text (glossary/screens.ts).

### The model call (308-334)
- CLI in lean mode with the `chat.system` prompt file; the CLI session is resumed per conversation.
- Capability `chat` (Haiku, low effort), `MAX_THINKING_TOKENS=0`, max 3 turns, 120s timeout.
- The comment says about 1.9k input tokens instead of about 31k (ai-assist.ts:452-453).
- **Roll-over** (338-378): at 40k input tokens, after 14 quiet days, or when the chat rules' hash changes. A `conversation_summary` call carries the summary over.
- An in-memory `busy` set blocks concurrent questions on one conversation (383).

### What the answer can contain (blocks.ts:21-41; at most 12 actions)
- **`<action>` proposals:** checked against the registry (514-535). They run only when the person clicks (proposals.ts:50-67 → `runAction`, trigger "chat").
- **`<goto>`:** moves only within `PLACES` (screens/index.ts; 6 places).
- **`<needs_code>`:** a "declared cost" card. On a click it reads code with sonnet, Read/Grep/Glob, up to 10 turns; the card's estimate is $0.05–0.40 (proposals.ts:199-202).

### Actions (actions/index.ts:19, 70-187)
- assess, breakdown (topic wi); implement, approve_task (topic task); send_to_session (topic run); resolve_gap, dismiss_gap (topic gaps).
- The screen buttons use the same `runAction` with trigger "button".

### Gaps conversation
- Stateless: facts and transcript are resent each turn.
- Capability `chat_code_read`, reads the repo, up to 14 turns (546-574).

### Retention and "helpful"
- A daily in-process job blanks message text and deletes `~/.dcc-chat/<id>`; ledger rows stay (retention.ts).
- "Did this help": an explicit mark, or the same question asked again within 60s marks the answer unhelpful (413-418).

### Cost handling
- Every model call is a ledger row.
- The `declareCostAboveUsd` policy value can be edited but is never read.

## 10. Other modules

**insights.ts.** Groups each month's user questions by (client, screen, normalised text) in SQL, keeping groups asked at least twice (75-126). Groups above `insightsMinRepeats` (5) are "above threshold". `analyseInsights` sends up to 20 due groups to one `usage_insights` call and stores finding and recommendation in `claude_insight` (194-231). `openImprovementTask` creates a story on the internal client with a note (242-269); `dismissInsight` hides a group. The view also lists unanswered, unhelpful, failed and escalated calls. All reads cross tenants through plain `db`.

**claude-center.ts.** The control center's read model. Every number is an aggregate of `claude_call` and `conversation_message` for one month, with filters. `claudeOverview` returns tiles, bars by client/capability/model/screen/user, policy counts, cache share, chat measurements and escalation per capability (76-177). It also serves paginated calls, a call by id, and `callsForEntity` (the requirement cost detail). "Escalated" means the `policy_rule` text contains "escalated" or "model overridden" (35). The per-user bars return zeros for questions and percentages (165).

**decisions.ts.** `recordDecision` writes `decision.made` with trigger rebreakdown, task_closed_override, task_reopened, requirement_reopened or direction_changed. Callers: server.ts:939, tasks.ts:140/164/175, crud.ts:130. `direction_changed` has no caller.

**capture.ts.** Handles POST /events from hooks and web notes. `recordSession` writes `claude.session` plus a ledger row (interactive_session, trigger hook, sourceRef `event:<id>`). `recordGitActivity` writes `git.activity`. `recordNote` writes `note.added`, with `supersedes` for corrections. All three rebuild the brief.

**contention.ts.** `recordTouches` upserts `workitem_file_touch` rows and returns overlaps with other requirements; `releaseTouches`; `contentionFor` lists requirements per path. `recordReview` writes a `review` row and a `review.completed` event with actor "agent:reviewer". Reached only through skills/dcc.mjs and smoke.ts; not from the web.

**task-overlap.ts.** Pure helpers: `sharedFiles` and `readMergeTree` (parses `git merge-tree --write-tree --name-only`). Used by task-merge.ts `taskOverlaps` and `mergeDependencyIntoTask`.

**merge-verify.ts.** `verifyCommit` creates a git worktree at the commit under `~/.dcc-verify`, links node_modules from the shared clone (the repo's own workspace packages link to the copy), and runs the repo's own scripts from {typecheck, lint, test, audit:stale} (build only if none exist). It also runs `tsc -p <dir> --noEmit` for tsconfigs the root does not reference (113-153). 300s per check. Used by `verifyResolution` (pull-request-conflict.ts:215).

**Pull request modules (GitHub via the `gh` CLI):**
- **pull-requests.ts:** list across repos whose `ado_repo_ref` is a GitHub URL. ADO repos are listed as "not connected yet". A Provider seam holds only GitHub. Flags: conflict, failing checks, parent PR, draft, approved, waiting over 24h, changes requested, over 40 files. 60s cache.
- **pull-request-detail.ts:** quick view; full detail (grouped files, timeline, code map, local merge-tree conflict view) with a 45s cache; file versions; `writePullRequestCode` for chat code reading.
- **pull-request-review.ts:** `submitReview` and `mergeRequest` as the operator's `gh` account ("temporary way through").
- **pull-request-conflict.ts:** plumbing-only resolution (merge-tree, hash-object, commit-tree; no checkout). Pushes one merge commit as the person, never forced; `verifyResolution` runs merge-verify.

**Also worth knowing:**
- **code-map.ts:** one git picture of where a piece of work sits, shared by tasks, PRs and onboarding.
- **task-files.ts:** a task branch's changed files and before/after versions.
- **spec-doc.ts and spec-map.ts:** the spec document parsed into ids; the `spec_*` tables; the `spec.map` reading, which is rejected unless `checkSpecRead` passes.
- **repo-branches.ts:** branch health with advice.

## 11. repo-onboarding (CORE/repo-onboarding)

| File (lines) | Responsibility |
|---|---|
| types.ts (217) | Stages prepare (deterministic) → init (ai) → review (human, gated) → deliver (deterministic); run statuses; automation presets step_by_step / guided / automatic / custom and consent; model choices; session and result types |
| runs.ts (902) | The run lifecycle and stage runners; per-run queue; ledger "slices" from the session's status-line totals (68-94, capability onboarding_init); `/init`-finished detection; review approval; file notes; chat facts; `sendToOnboardingSession`; startup recovery. Writes 17 event calls through an `event()` helper (19 event types) |
| session.ts (232) | node-pty interactive `claude` (`/init`, `CLAUDE_CODE_NEW_INIT=1`, `--resume` after a restart); 2 MB replay; terminal.log; status-line settings file; stop, kill, mark disconnected |
| workspace.ts (145) | git worktree under `~/.dcc-repos-onboarding/<run>` on branch `ai/onboarding/<runId8>` pinned to a baseline; detects existing setup |
| transcript.ts (235) | Reads the Claude Code JSONL transcript with a cursor: typed prompts, commands, AskUserQuestion answers; status snapshot; digest; idle and turn-end detection |
| changes.ts (90) | Changed and untracked files against the baseline; summary; file versions |
| change-diff.ts (73) | Diff text for the chat and file notes; lock files without body; truncation |
| file-notes.ts (46) | Pure prompt and parse for one note per changed file (`onboarding.file_notes`) |
| deliver.ts (93) | Commit as the person, push, PR through `gh` or a compare link |
| events.ts (27) | `appendRepoAiEvent`, the only writer of `repo_ai_event` |
| statusline.mjs (22) | Status-line command that writes the session's cost, model, effort and transcript path to JSON |
| index.ts (13) | Barrel |

## 12. Data model (DB/src/schema/*.ts)

33 tables. RLS = row-level security policy on `client_id`.

| Table | Purpose | client_id | RLS |
|---|---|---|---|
| users (identity.ts) | A person; `claude_identity_ref` is never used in code | no | no |
| service_connection | External connection; the ADO PAT sits in `secret_ref` | yes | yes |
| client (tenancy.ts) | Tenant root; `connector_type`; retention days; soft `archived_at`; unique active name | (root) | no |
| repo | Repository; `client_id` nullable means org-shared; `ado_repo_ref` = git URL; `local_path`; name globally unique | nullable | no |
| client_repo | Client ↔ repo | yes | yes |
| repo_dependency | Cross-repo dependency map; no code uses it | no | no |
| workitem (workitem.ts) | Requirement tree; key, type, requirement_type, phase, priority, risk, executor, budget, `progress_pct` (never written), ADO link fields, `started_with_open_blocker` | yes | yes |
| workitem_repo | Requirement ↔ repo, declared or auto | yes | yes |
| gap | A proposed question: why, kind, who answers, options, blocking, confidence, state, answer, spun_off_to | yes | yes |
| task | Tasks and checks (all fields listed in section 5) | yes | yes |
| task_dependency | Task → task, with reason | yes | yes |
| bug_task_link | Bug requirement ↔ task | yes | yes |
| workitem_file_touch | Active-edit map | yes | yes |
| review | Reviewer findings | yes | yes |
| workitem_dependency | Requirement → requirement | yes | yes |
| blocker | Question routed to the owner | yes | yes |
| notification | Alerts; read by the dashboard, never inserted | yes | yes |
| client_budget | Monthly AI budget | yes | yes |
| context_brief | Derived markdown brief | yes | yes |
| attachment | File bytes plus extracted text; ADO mirror | yes | yes |
| flow_run | Background CLI run: log and result (assess, breakdown, implement, manual reports) | yes | **no** (by design, workitem.ts:667-674) |
| spec_document, spec_section, task_spec_link | Spec as it arrived; its pieces; task ↔ piece links | yes | yes |
| event_log (events.ts) | Timeline | yes | yes |
| prompt_template (prompts.ts) | Prompt library | no | no |
| repository_onboarding_run, repository_onboarding_stage, repo_ai_event | Onboarding | yes | yes |
| conversation, conversation_message, claude_call, claude_insight (claude.ts) | Chat, ledger, conclusions | yes | yes |

- **Totals:** 27 tables have RLS. 6 do not: users, client, repo, repo_dependency, flow_run, prompt_template. `client_id` is on 29 tables.
- The dev migrator adds its own table `_dcc_migrations`.
- **13 pg enums:**
  - event_source (9 values); workitem_type (epic, feature, story, bug, task, spike)
  - priority (4); connector_type (manual, ado, github, jira, dcc); risk_level (3); executor (human, ai, mixed)
  - workitem_phase (6); requirement_type (3); gap_state (5); blocker_state (open, answered, abandoned)
  - task_appetite (small, standard, large); task_state (6)
  - permission_level (propose_only, execute_notify, execute_silent) — never used in code
- Many enum-like columns are plain text: task.kind, check_*, origin, flow_run.kind/state, conversation.status, claude_call trigger/outcome/entity_kind (checked by zod in the ledger), onboarding statuses.

## 13. Tests and proofs

- **Unit tests:** 15 `*.test.ts` files, all in CORE, 1,279 lines, about 180 test cases. `npm test` runs `vitest run` (R/vitest.config.ts).
  - Files: task-types, task-flow-steps, ado-url, spec-doc, manual-report, task-base, ado-map, task-overlap, chat/blocks, chat/gaps-prompt, build-recipe, prompt-contract, task-relations, task-status, task-branch.
- **Proof scripts** (787 lines in core, run with tsx):

| Command | File | Checks |
|---|---|---|
| `prove:routing` | routing.prove.ts | 18 |
| `prove:built-on` | task-base.prove.ts | 36 check lines |
| `prove:checks` | task-checks.prove.ts | 61 |
| `prove:manual` | manual-work.prove.ts | 37 |
| `prove:retention` | chat/retention.prove.ts | about 11 |

  - prove-kit.ts gives each proof its own PGlite directory, a bare git host, and a fake `claude` CLI through `DCC_CLAUDE_BIN`. The fake recognises prompts by their text, for example "You are VERIFYING a change in this repository".
- **`@dcc/db dev:prove`** (DB/src/dev/prove.ts): 16 checks — the RLS wall, append-only `event_log` and `claude_call`, payload validation, supersedes, the ledger ↔ timeline link, walled conclusions.
- **`@dcc/api smoke`** (API/smoke.ts): 14 checks through `fastify.inject`.
- **Not wired to a script:**
  - API/scenario-altshuler.ts — it posts `projectName` and `firstWorkItem{…level}`, while /admin/setup-client expects `firstRequirement{key,title,type}` (server.ts:1672-1674).
- **Other scripts:** `demo` (core/demo.ts), `repair:branches`; root `typecheck` (without web), `lint`, `audit:stale`, `info:drift`, `sync`. There is no CI (CLAUDE.md:79).
- **Stale counts in docs:** CLAUDE.md:67-68 and RUNNING.md say 9 and 8 checks; the code has 16 and 14.

## 14. Size

- **15 largest source files (lines):**

| File | Lines |
|---|---|
| CORE/ai-assist.ts | 2708 |
| API/server.ts | 1813 |
| WEB/screens/TaskDetail.tsx | 1495 |
| WEB/screens/WorkflowTab.tsx | 917 |
| CORE/repo-onboarding/runs.ts | 902 |
| WEB/api.ts | 865 |
| WEB/forms.tsx | 792 |
| DB/src/schema/workitem.ts | 784 |
| WEB/screens/Record.tsx | 682 |
| CORE/chat/index.ts | 627 |
| WEB/screens/ClaudeCenter.tsx | 600 |
| WEB/screens/TaskGraph.tsx | 567 |
| WEB/screens/PullRequestDetail.tsx | 549 |
| WEB/screens/onboarding/OnboardingScreen.tsx | 529 |
| CORE/pull-request-detail.ts | 525 |

  - By bytes, ai-assist.ts is 157 KB.
- **Lines per package** (ts/tsx/mjs/css):

| Package | Lines | Files | Notes |
|---|---|---|---|
| packages/db | 2,654 | 22 | plus 3,001 SQL lines in 54 migrations and 110 in guards.sql |
| packages/core | 18,037 | 113 | includes 1,279 test lines, 787 proof lines, 463 glossary lines |
| apps/api | 2,150 | 4 | |
| apps/web | 13,624 | 54 | screens are 8,582 lines; theme.css is 1,146 |
| apps/mcp | 127 | 1 | |
| **Total** | **36,592** | | 379 tracked files |

## 15. Workarounds, TODOs, lessons, duplicated patterns

**Known-mismatch facts**
- actions/index.ts:77: the chat's assess preview defaults to `promptKey "assess.standard"`. No migration seeds that key; ai-assist.ts:931 uses "assess.readiness.standard". The chat declares no promptKey parameter (proposal parameters are filtered at chat/index.ts:519).
- WorkflowTab.tsx:191-193: "assess done" is a Hebrew prefix match on a note.
- WorkflowTab.tsx:24 says blocking gaps gate breakdown; 211-213 requires every gap closed. Neither is enforced on the server.
- server.ts:623-625 says requirements are "never pushed to TFS", but start-build.ts:93 pushes linked ones.
- The workitem.ts:761-766 comment says breakdown writes spec links. Only `mapSpecToTasks` ("mapping") and `setTaskSpecLinks` ("manual") write them; `source "breakdown"` is typed at spec-map.ts:151 but never passed.
- `check.*` prompt text is copied onto each check at creation (ai-assist.ts:1734-1736), so later prompt edits do not reach existing checks.

**Unused or unwired pieces**
- Exported but never called: ado-pull.ts:143-231 and ado-sync.ts:129-177.
- WEB/api.ts exports that nothing uses: getText, REQ_TYPES, getClaudeCall, getInbox, createRequirement, getTaskSpec, updateConnection, deleteDependency, updateGap, updateBlocker, updateTask.
- Schema and enums: `notification` is never inserted; `repo_dependency` and `permission_level` are unused; `workitem.progress_pct` is never written (Record.tsx:187 computes its own); blocker `abandoned` is never set.
- message.* event types and the `direction_changed` decision trigger have no writer.
- Policy: `declareCostAboveUsd`, `guardrails`, `maxUsdPerCall` enforcement, and the routing signals other than `mechanical` are not wired.
- claude-center.ts:165 returns hardcoded zeros per user.

**Lessons recorded in comments**
- ai-assist.ts:
  - 45-56: Windows 8.3 short TEMP paths silently block writes.
  - 199-203: an orphaned "running" run after restart, seen 2026-09-23.
  - 404-422: plan mode's ExitPlanMode tool is missing in headless mode.
  - 462-472: cmd.exe mangles inline JSON, so settings go through a file.
  - 665-675: a stale cache branch, 2026-09-16.
  - 780: EPERM on rename.
  - 2487: TFS items are never auto-deleted — "hard lesson from an earlier incident".
- merge-verify.ts:113-119: the web project, not reached by typecheck, "took the site down".
- DB/src/dev/setup.ts:16: an old migration broke on a dropped column.
- CLAUDE.md:151-153: a stale branch brought back an already-fixed bug.
- context.ts:7-13: "pilot shim" auth. server.ts:335: "temporary" merge without approval.
- ado-sync.ts:14 "Not yet"; flow.ts:12 "a later slice".
- Windows-specific code: 13 `win32` branches in core (claude.cmd via shell, a `NoTools` name as a workaround, taskkill tree kills, core.longpaths, MSBuild paths).

**Duplicated patterns**
- Process spawning implemented five times: ai-assist `git()` (1277), the CLI spawn (482), merge-verify `run()` (50), build-recipe `runBuildRecipe` (146), pull-requests execFile `run()` (~79), plus local-folder.
- Windows tree kill written three times: ai-assist.ts:106, 1299; merge-verify.ts:57.
- `gh` detection twice (pull-requests.ts:87-117 and deliver.ts:20); `claude` binary lookup twice (ai-assist.ts:40 and session.ts:130-141).
- The ADO connection → orgUrl/project/projBase boilerplate in about 10 places (ado-sync, task-ado-sync, tasks, ai-assist, ado-pull).
- The `tenantPolicy` helper copied in 4 schema files (tenancy, workitem, claude, repo-onboarding), plus inline copies in identity and events.
- Three web fetch helpers (api.ts, forms.tsx, Record.tsx); 126 mirrored types; Hebrew state-label maps duplicated (TaskDetail.tsx:27, onboarding/Terminal.tsx:7).

**State held in memory**
- `flow_run` buffers and processes; the chat `busy` set; clone de-duplication; PR caches (60s, 45s, 3 min); the ADO API-version cache; onboarding terminals. Only onboarding and flow runs are recovered at startup.

**Repository hygiene**
- Literal NUL bytes in string literals at pull-request-detail.ts:454 and pull-request-conflict.ts:153,156 make `grep` report these files as binary.
- `.tmp-perf.cjs` is a committed one-off search-and-replace script at the repo root, excluded in eslint.config.js.
- The Drizzle journal (DB/migrations/meta/_journal.json) has 8 entries (0000–0007) against 54 SQL files. PGlite uses its own `_dcc_migrations` tracker (dev/setup.ts, dev/migrate.ts), while `npm run db:migrate` runs `drizzle-kit migrate`.
- `@dcc/db` scripts run `.ts` files with `node`, not `tsx` (DB/package.json).
- Screen state is heavy: TaskDetail.tsx has 65 `useState` calls and WorkflowTab.tsx has 42.
- CORE/demo.ts inserts a gap directly, without `proposeGap`, and imports `appendEvent` without using it.
