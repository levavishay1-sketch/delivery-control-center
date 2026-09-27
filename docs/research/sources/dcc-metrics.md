# Delivery Control Center — code-quality metrics

Measured 2026-09-27 on branch `claude/busy-heisenberg-5n9a0s` at commit `35b088a` (identical to `origin/master` history: 217 commits reachable). Repository: `/home/user/delivery-control-center`. Facts only; no tracked file was modified. All measurements exclude `node_modules`, `dist`, `.pgdata`, `.git` and `packages/db/migrations` (55 files) unless stated. Tool versions: cloc 2.06, ESLint 10.11.0 (typescript-eslint 8.x parser from the repo), vitest 5.0.1, vite 6.4.3, knip 6.38.0, TypeScript 5.7.x, Node 22.22.2, npm 10.9.7; jscpd and madge were run through `npx --yes` (latest, versions not captured). Raw tool output and JSON reports: `/tmp/claude-0/-home-user-delivery-control-center/b2470b29-abd6-5f6c-8317-bcaed54a68e8/scratchpad/metrics/`.

Nothing failed to run. Three adjustments were needed and are noted inline: (1) the ESLint "report every function" distribution pass used `max-lines-per-function: 1` because the rule rejects 0; (2) `grep` treats two core files as binary (a NUL character inside string literals at `packages/core/src/pull-request-detail.ts:454` and `packages/core/src/pull-request-conflict.ts:153,156`), so import counts were re-run with `grep -a`; (3) jscpd reports file names relative to the scanned `src` roots, resolved back to package paths here.

## Headline numbers

| metric | value |
|---|---|
| TypeScript code lines (cloc, no blank/comment) | 28,034 in 193 files (+ 984 CSS, 768 JS, 6,861 Markdown) |
| Raw TS/TSX lines (`wc -l`) | 35,436 (24,321 `.ts` + 11,115 `.tsx`) |
| Duplication (jscpd, 50 tokens / 5 lines) | 1.88 % of lines (663 / 35,360), 80 clones; 3.24 % at 30 tokens (142 clones) |
| Circular dependencies (madge) | 14 (13 in `packages/core`, 1 in `apps/web`, 0 in `db`; `api`/`mcp` only inherit core's) |
| Functions with cyclomatic complexity > 15 | 107 of 4,288 (2.5 %); max 244 |
| Functions > 120 lines | 23; max 1,334 lines |
| Dead code (knip) | 39 unused exports, 48 unused exported types, 8 "unused" files (6 are hook/skill entry points), 1 unlisted dependency |
| Unit tests | 15 files / 1,279 lines, 180 tests, all pass in 1.25 s; 3.9 % of source lines; 0 of 18 modules > 400 lines has a test |
| typecheck / lint / test / audit:stale / web tsc | all pass; lint 0 errors 32 warnings |
| Web build | 3.8 s; 1.24 MB dist, one 1,137 kB JS chunk (317 kB gzip) |
| TODO/FIXME/HACK/XXX | 0 |
| Git | 217 commits (80 merges) over 9 days, 4 author names / 3 e-mails, 197 commits in the last week |

## 1. Size

### 1a. Whole repository (cloc, excluding node_modules/dist/.pgdata/migrations/.git)

| language | files | blank | comment | code |
|---|---:|---:|---:|---:|
| TypeScript (`.ts` + `.tsx`) | 193 | 2,660 | 4,744 | 28,034 |
| JSON (includes `package-lock.json`) | 18 | 0 | 0 | 7,658 |
| Markdown (openspec, docs, skills, CLAUDE.md) | 77 | 1,817 | 0 | 6,861 |
| HTML (5 under `docs/`, 1 `apps/web/index.html`) | 6 | 129 | 17 | 1,691 |
| CSS (`apps/web/src/theme.css`) | 1 | 74 | 88 | 984 |
| JavaScript (`scripts/`, `hooks/`, `skills/`, configs) | 13 | 93 | 191 | 768 |
| SQL | 1 | 10 | 28 | 72 |
| YAML | 1 | 1 | 3 | 18 |
| **Total** | **310** | **4,784** | **5,071** | **46,086** |

Comment density for TypeScript: 4,744 comment lines / 28,034 code lines = 16.9 %.

### 1b. Per package (cloc code lines)

| package | TS files | TS code | TS blank | TS comment | other code |
|---|---:|---:|---:|---:|---|
| `packages/db` | 22 | 1,784 | 155 | 715 | SQL 72, JSON 44 |
| `packages/core` | 112 | 13,585 | 1,583 | 2,847 | JS 16, JSON 39 |
| `apps/api` | 4 | 1,714 | 219 | 218 | JSON 32 |
| `apps/web` | 53 | 10,851 | 693 | 935 | CSS 984, HTML 15, JSON 40 |
| `apps/mcp` | 1 | 93 | 9 | 25 | JSON 30 |
| support (`scripts/ hooks/ skills/ config/`) | — | — | — | — | JS 645 (10 files), MD 219, JSON 43 |

### 1c. Per package, raw lines by extension (`wc -l`, includes blanks and comments)

| package | `.ts` files / lines | `.tsx` files / lines |
|---|---|---|
| `packages/db` | 22 / 2,654 | — |
| `packages/core` | 112 / 18,015 | — |
| `apps/api` | 4 / 2,150 | — |
| `apps/web` | 8 / 1,363 | 45 / 11,115 |
| `apps/mcp` | 1 / 127 | — |

Repository-wide raw lines by extension: `.ts` 148 files / 24,321; `.tsx` 45 / 11,115; `.mjs` 11 / 898; `.cjs` 1 / 104; `.js` 1 / 50; `.css` 1 / 1,146; `.html` 6 / 1,837; `.md` 77 / 8,678; `.json` 19 / 7,668; `.sql` 1 / 110.

Structural counts: 33 `pgTable` definitions in `packages/db/src/schema` (38 `ENABLE ROW LEVEL SECURITY` statements in migrations, 6 `pgPolicy(` calls in schema); 163 Fastify route registrations in `apps/api/src/server.ts` (71 get, 66 post, 12 delete, 10 patch, 4 put; 162 distinct method+path); `apps/web/src`: 28 screen files + 4 under `screens/onboarding/`, 5 components, 8 files under `claude/`; `packages/core/src`: 74 top-level files plus `actions/` 1, `attachments/` 1, `brief/` 3, `chat/` 9, `glossary/` 2 + `glossary/concepts/` 10, `repo-onboarding/` 11, `screens/` 1; `packages/core/src/index.ts` has 51 export lines.

### 1d. 20 largest source files (raw lines)

| # | lines | file |
|---:|---:|---|
| 1 | 2,708 | `packages/core/src/ai-assist.ts` |
| 2 | 1,813 | `apps/api/src/server.ts` |
| 3 | 1,495 | `apps/web/src/screens/TaskDetail.tsx` |
| 4 | 1,146 | `apps/web/src/theme.css` |
| 5 | 917 | `apps/web/src/screens/WorkflowTab.tsx` |
| 6 | 902 | `packages/core/src/repo-onboarding/runs.ts` |
| 7 | 865 | `apps/web/src/api.ts` |
| 8 | 792 | `apps/web/src/forms.tsx` |
| 9 | 784 | `packages/db/src/schema/workitem.ts` |
| 10 | 682 | `apps/web/src/screens/Record.tsx` |
| 11 | 627 | `packages/core/src/chat/index.ts` |
| 12 | 600 | `apps/web/src/screens/ClaudeCenter.tsx` |
| 13 | 567 | `apps/web/src/screens/TaskGraph.tsx` |
| 14 | 549 | `apps/web/src/screens/PullRequestDetail.tsx` |
| 15 | 529 | `apps/web/src/screens/onboarding/OnboardingScreen.tsx` |
| 16 | 525 | `packages/core/src/pull-request-detail.ts` |
| 17 | 422 | `packages/core/src/tasks.ts` |
| 18 | 419 | `packages/core/src/flow.ts` |
| 19 | 412 | `packages/core/src/code-map.ts` |
| 20 | 392 | `apps/web/src/screens/PullRequestConflict.tsx` |

Next five: `apps/web/src/components/CodeMap.tsx` 370, `apps/web/src/ui.tsx` 367, `packages/core/src/spec-doc.ts` 334, `packages/core/src/ado-pull.ts` 321, `packages/core/src/crud.ts` 319. The two largest files together (`ai-assist.ts` + `server.ts`) hold 4,521 raw lines = 12.8 % of all TS/TSX lines.

## 2. Duplication (jscpd)

Command: `npx --yes jscpd packages/db/src packages/core/src apps/api/src apps/web/src apps/mcp/src --format typescript,tsx,javascript --pattern '**/*.{ts,tsx,mjs}' --min-tokens 50 --min-lines 5 --reporters console,json` (output in scratch `metrics/jscpd50/`; a second run with `--min-tokens 30` in `metrics/jscpd30/`).

| threshold | files | lines scanned | clones | duplicated lines | duplicated tokens |
|---|---:|---:|---:|---:|---:|
| 50 tokens / 5 lines | 187 | 35,360 | 80 | 663 (**1.88 %**) | 6,807 (1.71 %) |
| 30 tokens / 5 lines | 189 | 35,392 | 142 | 1,145 (**3.24 %**) | 8,931 (2.24 %) |

By format at 50 tokens: TypeScript 141 files / 24,222 lines / 60 clones / 513 dup lines (2.12 %); TSX 45 files / 11,116 lines / 20 clones / 150 dup lines (1.35 %); JavaScript (1 `.mjs`, 22 lines) 0. At 30 tokens: TS 91 clones / 773 lines (3.19 %); TSX 51 clones / 372 lines (3.35 %).

Clone locality at 50 tokens: 41 clones inside one file, 18 between files of the same package, 21 across packages. By package pair: web↔web 20, core↔core 20, **web↔core 17**, db↔db 13, api↔api 6, api↔db 2, core↔db 2. All 17 web↔core clones are type declarations in `apps/web/src/api.ts` that repeat types `packages/core/src/index.ts` exports (`InsightCluster`, `ClaudeOverview`, `ClaudeCallView`, `ChatMessage`/`ConversationView`, `PullRequestList`, `TaskRunRecord`, `PrepareResult`, `SpecPiece`/`SpecView`, `ImplementResult`, `TaskDeletePrecheck`, …); `apps/web` has no import from `@dcc/*` (see §3), so these are hand-maintained copies.

Files with the most duplicated lines (sum over both sides of each clone):

| dup lines | clone sides | file |
|---:|---:|---|
| 207 | 22 | `packages/db/src/schema/workitem.ts` |
| 170 | 17 | `apps/web/src/api.ts` |
| 134 | 15 | `packages/core/src/ai-assist.ts` |
| 114 | 14 | `apps/web/src/forms.tsx` |
| 91 | 14 | `apps/api/src/server.ts` |
| 41 | 4 | `packages/core/src/claude-center.ts` |
| 39 | 3 | `packages/db/src/schema/repo-onboarding.ts` |
| 36 | 6 | `packages/core/src/task-ado-sync.ts` |
| 30 | 5 | `packages/core/src/ado-sync.ts` |
| 28 | 4 | `apps/web/src/screens/WorkflowTab.tsx` |
| 28 | 4 | `packages/core/src/actions/index.ts` |
| 26 | 3 | `packages/core/src/flow.ts` |
| 26 | 4 | `apps/web/src/screens/ClientDetail.tsx` |
| 24 | 2 | `apps/web/src/screens/onboarding/rail.tsx` |
| 23 | 3 | `packages/core/src/spec-map.ts` |

### 2a. The 15 largest clones (50-token run, sorted by lines; both sides opened to describe them)

| # | lines / tokens | A | B | what the duplicated code is |
|---:|---|---|---|---|
| 1 | 25 / 58 | `packages/db/src/schema/repo-onboarding.ts:2-26` | `packages/db/src/schema/workitem.ts:31-53` | Import block (`client`, `repo` from `./tenancy.ts`, `users` from `./identity.ts`) followed by a file-level JSDoc; only 58 tokens, mostly comment lines |
| 2 | 20 / 294 | `apps/web/src/api.ts:261-280` | `packages/core/src/insights.ts:12-57` | `InsightCluster` / `InsightCallRow` / `UnhelpfulRow` / `InsightsView` type declarations (Claude Center conclusions) |
| 3 | 18 / 271 | `apps/web/src/api.ts:191-208` | `packages/core/src/claude-center.ts:51-76` | `CenterBar` + `ClaudeOverview` types (monthly cost/quality tiles, per-client/capability/model/screen bars, policy summary) |
| 4 | 18 / 209 | `packages/core/src/ai-assist.ts:2212-2229` | `packages/core/src/ai-assist.ts:2301-2318` | Opening of `rollbackTask` and `pushTask`: load the task row and workitem key under `withTenant`, `firstRepo`, `ensureCheckout`, compute the branch name |
| 5 | 13 / 210 | `packages/core/src/repo-onboarding/changes.ts:14-26` | `packages/core/src/task-files.ts:54-66` | Parse `git diff --numstat` and `--name-status` output into `ChangedFile[]` (path, status, additions, deletions) |
| 6 | 12 / 72 | `apps/web/src/forms.tsx:133-144` | `apps/web/src/forms.tsx:422-427` | Requirement-type option list (`epic/feature/story/bug/task/spike` with Hebrew labels) declared twice as `TYPE_OPTS` and `TYPES` |
| 7 | 12 / 66 | `apps/web/src/screens/onboarding/rail.tsx:79-90` | `apps/web/src/screens/onboarding/rail.tsx:145-156` | Save/cancel button row and closing JSX of the `AutomationEditor` and `ModelEditor` edit panels |
| 8 | 11 / 195 | `apps/web/src/api.ts:219-229` | `packages/core/src/chat/index.ts:48-60` | `ChatContext` / `ChatMessage` / `ConversationView` types |
| 9 | 11 / 190 | `apps/web/src/api.ts:180-190` | `packages/core/src/claude-center.ts:179-189` | `ClaudeCallView` type (one ledger row of a Claude call) |
| 10 | 11 / 141 | `apps/web/src/api.ts:748-758` | `packages/core/src/pull-requests.ts:47-66` | Tail of `PullRequestRow` and the `PullRequestList` type (rows, history, repos, problems) |
| 11 | 11 / 85 | `apps/web/src/api.ts:609-619` | `packages/core/src/ai-assist.ts:2148-2166` | `TaskRunRecord` type (one entry of a task's run history) |
| 12 | 11 / 83 | `packages/db/src/schema/workitem.ts:119-129` | `packages/db/src/schema/workitem.ts:422-432` | The `client_id` / `workitem_id` / `repo_id` foreign-key column trio in the `workitem_repo` and `workitem_file_touch` tables |
| 13 | 11 / 64 | `apps/web/src/api.ts:684-694` | `packages/core/src/repo-onboarding/types.ts:179-195` | `ExistingSetup` / `PrepareResult` / `InitResult` / `ReviewResult` onboarding types |
| 14 | 11 / 50 | `apps/web/src/api.ts:374-384` | `packages/core/src/spec-map.ts:22-33` | `SpecPiece` / `SpecView` types (requirement or decision marked in a spec document) |
| 15 | 10 / 108 | `apps/web/src/forms.tsx:457-466` | `apps/web/src/forms.tsx:486-495` | Modal footer of two client forms: ADO project-ref input, error line, save/cancel buttons |

Next five: 16. `packages/core/src/flow.ts:194-203` ↔ `flow.ts:323-331` (10 lines) — the recursive `level()` that computes a task's depth from `parentTaskId`; 17. `apps/web/src/api.ts:518-527` ↔ `packages/core/src/ai-assist.ts:2370-2389` — `TaskDeleteNode` / `TaskDeletePrecheck` types; 18. `apps/web/src/api.ts:625-633` ↔ `packages/core/src/ai-assist.ts:1236-1256` — `ImplementResult` type; 19–20. `packages/db/src/schema/workitem.ts:146-154` ↔ `:208-216` and ↔ `:454-462` — the `id` / `client_id` / `workitem_id` column header shared by the `gap`, `task` and `review` tables.

## 3. Dependency structure

### 3a. Circular dependencies (madge)

Command: `npx --yes madge --extensions ts,tsx --ts-config tsconfig.json --circular packages/core/src apps/api/src apps/web/src packages/db/src apps/mcp/src` — processed 191 files (1 warning, not itemised by madge). The root `tsconfig.json` (project references only) was sufficient; the per-package runs with each package's own `tsconfig.json` gave the same cycles.

**14 circular dependencies**, in four families:

| # | cycle |
|---:|---|
| 1 | `packages/core/src/ai-assist.ts` → `packages/core/src/tasks.ts` → back |
| 2 | `packages/core/src/chat/index.ts` → `packages/core/src/chat/proposals.ts` → back |
| 3–11 | `packages/core/src/glossary/index.ts` → `glossary/concepts/index.ts` → `glossary/concepts/{admin, claude, code, onboarding, overview, pages, pull-request, requirement, task}.ts` → back (9 cycles through one hub) |
| 12 | `packages/core/src/glossary/index.ts` → `glossary/concepts/index.ts` → back |
| 13 | `packages/core/src/chat/index.ts` → `packages/core/src/screens/index.ts` → back |
| 14 | `apps/web/src/api.ts` → `apps/web/src/components/FileCompare.tsx` → `apps/web/src/claude/Info.tsx` → back |

Per package: `packages/db` 0 (21 files); `packages/core` 13 (127 files incl. db); `apps/web` 1 (53 files); `apps/api` 13 and `apps/mcp` 13 — all inherited from core, none of their own.

Module-graph statistics (madge `--json`): `packages/core` 127 modules / 343 edges; highest fan-in `@dcc/db` (`packages/db/src/index.ts`) 48, `ai-assist.ts` 24, `brief/generate.ts` 18, `glossary/index.ts` 13, `routing.ts` 12, `repo-onboarding/types.ts` 10, `chat/index.ts` 7; highest fan-out `index.ts` 51, `ai-assist.ts` 20, `repo-onboarding/runs.ts` 15, `chat/index.ts` 12, `chat/proposals.ts` 10, `glossary/concepts/index.ts` 10, `tasks.ts` 9. `apps/web` 53 modules / 200 edges; fan-in `api.ts` 37, `ui.tsx` 31, `claude/Info.tsx` 30, `screens/onboarding/labels.ts` 12, `claude/context.ts` 10, `forms.tsx` 9; fan-out `App.tsx` 24, `screens/Record.tsx` 11, `screens/onboarding/OnboardingScreen.tsx` 9, `ClaudeCenter` / `PullRequestDetail` / `TaskDetail` / `WorkflowTab` 8 each. Orphans (nothing imports them): core 22 = 15 test files + 6 prove/run scripts + `demo.ts`; web 2 = `main.tsx` (entry) and `vite-env.d.ts`.

### 3b. Cross-package imports (`grep -a` over `from "@dcc/…"`; import lines / files)

| package | `@dcc/db` | `@dcc/db/schema` | `@dcc/db/events` | `@dcc/core` | files importing `drizzle-orm` directly |
|---|---|---|---|---|---|
| `packages/db` | — | — | — | 0 | 20 import lines |
| `packages/core` | 48 lines / 47 files (+1 dynamic `import("@dcc/db")`) | 45 lines / 44 files (+1 dynamic) | 0 | — | 43 of 112 files |
| `apps/api` | 4 lines / 4 files (+2 dynamic) | 4 lines / **3 files** (`context.ts`, `server.ts` ×2, `smoke.ts`) | 0 | 1 line / 1 file (`server.ts`) | 4 of 4 files |
| `apps/web` | **0** | **0** | 0 | **0** | 0 |
| `apps/mcp` | 1 | 1 | 0 | 1 | 1 |

- `apps/web` imports nothing from `@dcc/core` or `@dcc/db`, has no relative import reaching outside `apps/web`, and `vite.config.ts` defines no aliases (only the `/api` proxy). Its only cross-file type import at the top of `api.ts` is `import type { FileVersionsData } from "./components/FileCompare.tsx"`. It is a pure client by import graph; the cost is the 17 hand-copied types in §2.
- `apps/api` imports `@dcc/db/schema` directly in 3 of its 4 files (4 import lines); all 4 files import `drizzle-orm` directly; only `server.ts` imports `@dcc/core` (one import statement).
- `packages/core`: 47 of 112 `.ts` files (42 %) import `@dcc/db`; 65 do not. `@dcc/db/events` is not imported by anyone.
- `packages/db` imports nothing from `@dcc/core` (0).

Third-party import lines per package (top entries): `packages/db` — drizzle-orm 20, node:fs 4, node:url 4, zod 3, pg 1, node:crypto 1, node:async_hooks 1. `packages/core` — drizzle-orm 41, node:fs 23, node:path 18, vitest 15, node:os 8, node:child_process 8, node:crypto 6, node:url 4, zod 1 (not declared in `packages/core/package.json`, see §5), node:module 1. `apps/api` — drizzle-orm 4, node:crypto 3, fastify 2, zod 1, @fastify/websocket 1. `apps/web` — react 43, react-dom 2, @xyflow/react 2, @xterm/xterm 1, @xterm/addon-fit 1. `apps/mcp` — @modelcontextprotocol/sdk 2, zod 1, drizzle-orm 1.

## 4. Complexity (ESLint 10.11.0, typescript-eslint parser, scratch config)

Config: `metrics/eslint.config.mjs` with only `complexity: ["warn", 15]`, `max-lines-per-function: ["warn", 120]`, `max-depth: ["warn", 4]`, run as `npx eslint --config <scratch>/eslint.config.mjs --no-config-lookup packages/*/src apps/*/src`. 190 files parsed, 0 parse errors. A second pass with thresholds `0 / 1 / 0` reported every function for the distribution below (the rule rejects `max-lines-per-function: 0`).

| measure | value |
|---|---|
| functions counted (incl. arrow callbacks) | 4,288 |
| functions with complexity > 15 | **107** (2.5 %) — core 61, web 43, api 2, db 1, mcp 0 |
| complexity > 10 / > 20 / > 30 / > 50 / > 100 | 196 / 70 / 33 / 9 / 2 |
| complexity mean / median / p90 / max | 2.78 / 1 / 6 / 244 |
| per-package mean complexity | core 3.11 (n=1,949), web 2.72 (n=1,943), api 1.77 (n=216), db 1.22 (n=171), mcp 1.33 (n=9) |
| functions > 120 lines | **23** |
| functions > 30 / > 50 / > 100 / > 200 / > 300 / > 500 lines | 231 / 117 / 35 / 6 / 3 / 3 |
| function length mean / median / p90 / max (functions > 1 line, n=1,775) | 17.3 / 7 / 37 / 1,334 |
| `max-depth` > 4 violations | 5 (blocks at depth ≥ 4: 30; ≥ 5: 5; max depth 6) |

### 4a. The 15 most complex functions

| # | complexity | location | function |
|---:|---:|---|---|
| 1 | 244 | `apps/web/src/screens/TaskDetail.tsx:162` | `TaskDetail` (React component, 1,334 lines) |
| 2 | 115 | `apps/web/src/screens/WorkflowTab.tsx:137` | `WorkflowTab` (737 lines) |
| 3 | 80 | `packages/core/src/pull-request-detail.ts:264` | `pullRequestDetail` (async) |
| 4 | 77 | `apps/web/src/screens/PullRequestDetail.tsx:374` | `PullRequestDetailScreen` |
| 5 | 61 | `apps/web/src/screens/PullRequestConflict.tsx:147` | `PullRequestConflictScreen` |
| 6 | 60 | `packages/core/src/ai-assist.ts:1951` | `runImplement` (async, 195 lines) |
| 7 | 56 | `packages/core/src/chat/index.ts:385` | `askChat` (async) |
| 8 | 56 | `packages/core/src/code-map.ts:237` | `codeMapFrom` |
| 9 | 51 | `apps/web/src/claude/ProposalCard.tsx:14` | `ProposalCard` |
| 10 | 48 | `apps/web/src/screens/onboarding/OnboardingScreen.tsx:296` | `StageBody` |
| 11 | 46 | `packages/core/src/ai-assist.ts:397` | `runClaudeRaw` (async, 173 lines) |
| 12 | 43 | `packages/core/src/brief/render.ts:28` | `renderBrief` |
| 13 | 41 | `apps/web/src/components/code.ts:84` | `scan` |
| 14 | 41 | `packages/core/src/repo-onboarding/runs.ts:543` | `ensureReviewNotes` (async) |
| 15 | 41 | `packages/core/src/task-ado-sync.ts:52` | `materializeTasksToAdo` (async) |

Next ten: `repo-onboarding/transcript.ts:146 digestTranscript` 38; `screens/Record.tsx:60 Record` 36; `ai-assist.ts:2501 deleteTaskSurgical` 36; `code-map.ts:162 readCodeMapFacts` 36; `task-flow-steps.ts:122` (arrow) 36; `claude-center.ts:76 claudeOverview` 35; `screens/TaskGraph.tsx:169 Detail` 34; `ai-assist.ts:1142` (async arrow) 34; `chat/proposals.ts:89 runCodeQuestion` 34; `ai-assist.ts:1443 statusFactsFor` 33.

Functions over 120 lines per package: apps/web 17, packages/core 6 (total 23).

Files with the most functions over complexity 15:

| functions > 15 | file |
|---:|---|
| 15 | `packages/core/src/ai-assist.ts` |
| 5 | `apps/web/src/screens/TaskDetail.tsx` |
| 5 | `packages/core/src/pull-request-detail.ts` |
| 5 | `packages/core/src/repo-onboarding/runs.ts` |
| 4 | `apps/web/src/screens/Record.tsx` |
| 4 | `packages/core/src/repo-onboarding/transcript.ts` |
| 3 | `apps/web/src/screens/PullRequestDetail.tsx` |
| 3 | `apps/web/src/screens/TaskGraph.tsx` |
| 3 | `apps/web/src/screens/onboarding/OnboardingScreen.tsx` |
| 2 | `apps/api/src/server.ts` |
| 2 | `apps/web/src/claude/ClaudeChat.tsx` |
| 2 | `apps/web/src/components/CodeMap.tsx` |

### 4b. Functions over 120 lines (23; top 15)

| # | lines | location | function |
|---:|---:|---|---|
| 1 | 1,334 | `apps/web/src/screens/TaskDetail.tsx:162` | `TaskDetail` |
| 2 | 737 | `apps/web/src/screens/WorkflowTab.tsx:137` | `WorkflowTab` |
| 3 | 547 | `apps/web/src/screens/Record.tsx:60` | `Record` |
| 4 | 257 | `apps/web/src/screens/TaskGraph.tsx:311` | `TaskGraph` |
| 5 | 246 | `apps/web/src/screens/PullRequestConflict.tsx:147` | `PullRequestConflictScreen` |
| 6 | 239 | `apps/web/src/claude/ClaudeChat.tsx:38` | `ClaudeChat` |
| 7 | 195 | `packages/core/src/ai-assist.ts:1951` | `runImplement` |
| 8 | 188 | `apps/web/src/screens/RequirementMap.tsx:28` | `RequirementMap` |
| 9 | 187 | `apps/web/src/screens/ClientDetail.tsx:30` | `ClientDetail` |
| 10 | 186 | `apps/web/src/screens/onboarding/OnboardingScreen.tsx:27` | `OnboardingScreen` |
| 11 | 176 | `apps/web/src/screens/PullRequestDetail.tsx:374` | `PullRequestDetailScreen` |
| 12 | 173 | `packages/core/src/ai-assist.ts:397` | `runClaudeRaw` |
| 13 | 157 | `apps/web/src/screens/SpecPane.tsx:20` | `SpecPane` |
| 14 | 144 | `apps/web/src/screens/ClaudeCenter.tsx:457` | `PolicyTab` |
| 15 | 144 | `apps/web/src/screens/Dashboard.tsx:25` | `Dashboard` |

### 4c. `max-depth` > 4 (5)

`apps/web/src/screens/SpecPane.tsx:40` (depth 5); `packages/core/src/ado-http.ts:66` (5); `packages/core/src/repo-onboarding/runs.ts:602` (5 and 6); `packages/core/src/repo-onboarding/transcript.ts:159` (5).

## 5. Dead code (knip 6.38.0, `npx --yes knip` at the root, no config file in the repo)

| category | count |
|---|---:|
| unused files | 8 (6 are entry points knip cannot see, see below) |
| unused exports | 39 (web 21, core 16, api 1, db 1) |
| unused exported types | 48 (web 30, core 18) |
| unlisted dependencies | 1 — `zod` imported at `packages/core/src/policy-admin.ts:2` but absent from `packages/core/package.json` (resolves through npm hoisting) |
| unlisted binaries | 2 — `openspec` (root `package.json` `spec` script), `where` (`packages/core/src/repo-onboarding/session.ts`, Windows lookup) |
| unused dependencies / devDependencies / duplicate exports / enum members | 0 |

Unused files: `hooks/session-start.mjs`, `hooks/session-end.mjs`, `hooks/post-tool-use.mjs`, `hooks/info-hint-check.mjs`, `hooks/lib.mjs`, `skills/dcc.mjs` — false positives: the four hooks are wired in `.claude/settings.json` (lines 8, 18, 29, 38), `lib.mjs` is their shared module, and `skills/dcc.mjs` is invoked from five `skills/*/SKILL.md` and `.claude/agents/reviewer.md`. The other two have no code or script reference: `.tmp-perf.cjs` (104 lines, a one-off find-and-replace edit script; referenced only by the `eslint.config.js` ignore list; committed in `ce8013f`) and `apps/api/src/scenario-altshuler.ts` (176 lines, a manual pilot-scenario runner importing `./server.ts`; mentioned only in `openspec/changes/phase-0-walking-skeleton/tasks.md`; no npm script runs it).

15 examples of unused exports/types (file:line):

| export | file:line |
|---|---|
| `withTenant` | `apps/api/src/context.ts:58` |
| `getText`, `REQ_TYPES`, `getClaudeCall`, `getInbox`, `createRequirement`, `getTaskSpec`, `updateConnection`, `deleteDependency`, `updateGap`, `updateBlocker`, `updateTask` (11 functions) | `apps/web/src/api.ts:23,28,212,307,310,402,488,491,492,494,496` |
| `RichText`, `StatusPill`, `StatTile` | `apps/web/src/ui.tsx:34,189,356` |
| `Modal` | `apps/web/src/forms.tsx:27` |
| `StepRail` | `apps/web/src/screens/WorkflowTab.tsx:877` |
| `CodeMapDrawing` | `apps/web/src/components/CodeMap.tsx:213` |
| `gateOf` | `apps/web/src/screens/TaskTree.tsx:29` |
| `setClaudeContext`, `TRIGGER_HE`, `SCREEN_HE` | `apps/web/src/claude/context.ts:42`, `claude/labels.ts:38,50` |
| `ADO_API_VERSIONS`, `adoAuthHeader` | `packages/core/src/ado-http.ts:33,35` |
| `ADO_TYPE_TO_DCC`, `ADO_STATE_TO_PHASE` | `packages/core/src/ado-map.ts:6,31` |
| `retentionDaysFor`, `UNANSWERED_MARK` | `packages/core/src/chat/index.ts:154,264` |
| `splitConflicts`, `hasMarkers` | `packages/core/src/pull-request-conflict.ts:80,110` |
| `clusterQuestions` | `packages/core/src/insights.ts:75` |
| `claudeCallInput` | `packages/db/src/ledger/index.ts:26` |
| 28 unused types in `apps/web/src/api.ts` (e.g. `GapKind:40`, `TaskKind:47`, `TaskStatus:338`, `OnboardingRun:699`, `ConflictFile:765`) and 18 in core (e.g. `routing.ts:41 ModelPrice`, `pull-requests.ts:21-23 PullRequestState/ReviewState/ChecksState`, `actions/index.ts:20-25 ActionTopic/ActionEstimate/Allowed`) | see `metrics/knip.txt` |

Note on false positives: knip's "unused export" means no *other* file imports the name; a symbol used inside its own file is still flagged. The repo's own `npm run audit:stale` separately reports "no unused dependencies" and "1 known-inert" unreferenced table.

## 6. Tests

| measure | value |
|---|---:|
| `*.test.ts` files | 15 (all in `packages/core/src`: 13 top-level + 2 in `chat/`); 0 in `db`, `api`, `web`, `mcp` |
| test lines | 1,279 |
| source lines (raw `.ts`/`.tsx`, excluding tests, prove/smoke/demo/dev scripts, `.d.ts`) | 32,894 in 162 files (db 2,239 / core 16,037 / api 2,047 / web 12,444 / mcp 127) |
| test : source line ratio | 1,279 : 32,894 = **3.9 %** |
| lines of source that have a unit test beside them | 1,674 (15 modules) = 5.1 % of source |
| DB-backed check scripts (not vitest) | 9 files / 997 lines (`task-checks.prove.ts` 232, `db/src/dev/prove.ts` 185, `task-base.prove.ts` 157, `manual-work.prove.ts` 129, `api/src/smoke.ts` 103, `demo.ts` 71, `chat/retention.prove.ts` 71, `routing.prove.ts` 39, `task-branch-repair.run.ts` 10) — not run (they open the database) |
| `npm test` (vitest 5.0.1) | **15/15 files, 180/180 tests passed, 0 failed**; vitest duration 1.25 s (transform 61 %); 1.8 s wall including npm |

Modules with a test next to them (module lines): `task-types.ts` 69, `task-flow-steps.ts` 184, `ado-url.ts` 55, `spec-doc.ts` 334, `manual-report.ts` 88, `task-base.ts` 57, `ado-map.ts` 95, `task-overlap.ts` 33, `chat/blocks.ts` 41, `chat/gaps-prompt.ts` 105, `build-recipe.ts` 159, `prompt-contract.ts` 123, `task-relations.ts` 61, `task-status.ts` 229, `task-branch.ts` 41. None of these 15 modules imports `@dcc/db` (0 each), consistent with the repo rule that tests stay database-free. Largest tested module: `spec-doc.ts` (334 lines).

Modules over 400 lines with no test beside them — **18 of 18**: `packages/core/src/ai-assist.ts` 2,708; `apps/api/src/server.ts` 1,813; `apps/web/src/screens/TaskDetail.tsx` 1,495; `apps/web/src/screens/WorkflowTab.tsx` 917; `packages/core/src/repo-onboarding/runs.ts` 902; `apps/web/src/api.ts` 865; `apps/web/src/forms.tsx` 792; `packages/db/src/schema/workitem.ts` 784; `apps/web/src/screens/Record.tsx` 682; `packages/core/src/chat/index.ts` 627; `apps/web/src/screens/ClaudeCenter.tsx` 600; `apps/web/src/screens/TaskGraph.tsx` 567; `apps/web/src/screens/PullRequestDetail.tsx` 549; `apps/web/src/screens/onboarding/OnboardingScreen.tsx` 529; `packages/core/src/pull-request-detail.ts` 525; `packages/core/src/tasks.ts` 422; `packages/core/src/flow.ts` 419; `packages/core/src/code-map.ts` 412.

## 7. Health (run sequentially, wall-clock including npm start-up)

| check | result | timing |
|---|---|---:|
| `npm run typecheck` (`tsc -b`: db, core, api, mcp) | pass, 0 errors | 12.1 s |
| `npm run lint` (`eslint .`, 204 files) | pass (exit 0): **0 errors, 32 warnings** | 6.9 s |
| `npm test` (vitest) | pass: 15 files, 180 tests | 1.8 s |
| `npm run audit:stale` | pass — "All checks passed" (223 concepts, 270 "i" uses, 30 deliberate opt-outs, 8 chat glossaries, 1 known-inert table) | 0.6 s |
| `npx tsc -p apps/web --noEmit` | pass, 0 errors | 10.4 s |

Lint warnings by rule: `@typescript-eslint/no-unused-vars` 13, `react-hooks/exhaustive-deps` 5, `no-useless-assignment` 4, `@typescript-eslint/no-explicit-any` 4, `@typescript-eslint/no-unused-expressions` 2, `no-useless-escape` 2, `prefer-const` 1, `preserve-caught-error` 1. Files with most warnings: `apps/api/src/server.ts` 3, `apps/web/src/forms.tsx` 3, `packages/core/src/repo-onboarding/transcript.ts` 3, `packages/core/src/ai-assist.ts` 2, `packages/core/src/demo.ts` 2, `packages/db/src/schema/tenancy.ts` 2.

Suppressions and escape hatches in source: `eslint-disable` 6 (all `react-hooks/exhaustive-deps`, all in `apps/web`: `components/FileCompare.tsx:200`, `forms.tsx:510`, `claude/context.ts:54`, `claude/ClaudeChat.tsx:103`, `screens/ClaudeCenter.tsx:316`, `screens/Record.tsx:101`); `@ts-ignore` 0; `@ts-expect-error` 0; `as any` 2; `: any` 3; `as unknown as` 16. `tsconfig.base.json` has `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules` on.

## 8. Build

`npm run -w @dcc/web build` (vite 6.4.3): **3.8 s** wall (vite: "built in 3.28s"), 240 modules transformed. Output `apps/web/dist` = 1,239,814 bytes (1.2 MB): `index.html` 0.71 kB; `assets/index-DbSWwbWi.css` 102.29 kB (gzip 18.61 kB); `assets/index-CfqU5QC3.js` 1,136.81 kB (gzip 317.29 kB). The whole app is one JS chunk; vite emits its ">500 kB after minification" warning. (`dist/` and `*.tsbuildinfo` created by typecheck and build were removed afterwards; neither existed before and both are git-ignored.)

## 9. Comments and markers

| marker | count in source (`ts/tsx/mjs/js/cjs/css/html`) |
|---|---:|
| `TODO` / `FIXME` / `HACK` / `XXX` (word-boundary) | **0** / 0 / 0 / 0 (also 0 in `.md`/`.json`/`.yml`) |
| "found live" (case-insensitive) | 6 |
| "hard lesson" | 1 |
| "workaround" / "work-around" | 0 |

The 7 lesson comments: `packages/db/src/dev/setup.ts:16` (found live, 2026-09-20); `packages/core/src/ai-assist.ts:45` (`os.homedir()` not `os.tmpdir()`); `ai-assist.ts:410` (headless `-p` mode); `ai-assist.ts:464` (Windows `claude.cmd` spawning); `ai-assist.ts:665` (real bug found live 2026-09-16: reusing an existing cache clone); `ai-assist.ts:2487` (hard lesson: never auto-delete); `apps/web/src/forms.tsx:79`. Three more such phrases sit in `.md` docs, and 5 lines match "confirmed live" / "seen live" / "bit us" / "lesson" in source.

## 10. Git

| measure | value |
|---|---|
| total commits (HEAD and `--all` agree) | **217**, of which 80 merge commits (137 non-merge) |
| first commit | `575a3b7`, 2026-09-19 08:33:12 +0000, author "Claude" |
| last commit | `35b088a`, 2026-09-27 09:06:22 +0000 — 9 days of history |
| distinct author names (`git log --format=%an \| sort -u`) | **4**: Avishay Lev (114), levavishay1-sketch (83), Claude (17), lev.avishay.1 (3) — 3 distinct e-mails (`avishayl@aman-global.com`; `lev.avishay.1@gmail.com` under two names; `noreply@anthropic.com`) |
| committers | Avishay Lev 114, GitHub 66 (web-UI merges), levavishay1-sketch 17, Claude 17, lev.avishay.1 3 |
| `Co-Authored-By` trailers | 134 commits: Claude Sonnet 5 93, Claude Opus 5 22, Claude Opus 5.5 10, Claude Fable 5.1 8, Claude 1 |
| branches / tags | `origin/master`, `origin/claude/busy-heisenberg-5n9a0s`; 0 tags |

Commits per week (Monday–Sunday, author date), last 6 weeks:

| week | commits |
|---|---:|
| 2026-08-17 – 08-23 | 0 |
| 2026-08-24 – 08-30 | 0 |
| 2026-08-31 – 09-06 | 0 |
| 2026-09-07 – 09-13 | 0 |
| 2026-09-14 – 09-20 | 20 |
| 2026-09-21 – 09-27 | 197 |

Most-changed files (`git log --name-only`):

| commits touching | file |
|---:|---|
| 45 | `apps/web/src/api.ts` |
| 32 | `apps/web/src/theme.css` |
| 32 | `apps/api/src/server.ts` |
| 29 | `packages/core/src/index.ts` |
| 28 | `packages/core/src/ai-assist.ts` |
| 28 | `apps/web/src/screens/TaskDetail.tsx` |
| 22 | `CLAUDE.md` |
| 20 | `apps/web/src/screens/PullRequestDetail.tsx` |
| 15 | `apps/web/src/ui.tsx` |
| 15 | `apps/web/src/screens/WorkflowTab.tsx` |

Next five: `apps/web/src/screens/Record.tsx` 14, `packages/core/src/chat/index.ts` 13, `packages/core/src/pull-request-detail.ts` 12, `packages/core/src/glossary/concepts/task.ts` 12, `apps/web/src/screens/onboarding/OnboardingScreen.tsx` 12. Seven of the ten most-changed files are also among the ten largest (§1d) or the most complex (§4a).

## Appendix — raw outputs

All in `/tmp/claude-0/-home-user-delivery-control-center/b2470b29-abd6-5f6c-8317-bcaed54a68e8/scratchpad/metrics/`: `cloc-*.txt`, `largest-files.txt`, `jscpd50/jscpd-report.json`, `jscpd30/jscpd-report.json`, `madge-circular-*.txt`, `madge-core.json`, `madge-web.json`, `cross-package-imports.txt`, `eslint.config.mjs`, `complexity-15.json`, `complexity-all.json`, `knip.json`, `knip.txt`, `tests-inventory.txt`, `typecheck.txt`, `lint.txt`, `lint.json`, `test.txt`, `audit-stale.txt`, `tsc-web.txt`, `web-build.txt`, `comments-todos.txt`, `git-stats.txt`, `extras.txt`.
