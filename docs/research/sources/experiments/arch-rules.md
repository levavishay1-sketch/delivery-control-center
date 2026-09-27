# Experiment 1 — architecture rules as a tool (dependency-cruiser, read-only)

Date: 2026-09-27. Repository: `/home/user/delivery-control-center` (branch `claude/busy-heisenberg-5n9a0s`, tree clean; nothing was
installed into it). Tool: dependency-cruiser **18.4.0** fetched by `npx --yes` into `~/.npm/_npx/…`, parsing with the repository's
TypeScript 5.9.3. Scope: `packages/db/src packages/core/src apps/api/src apps/web/src apps/mcp/src` — **227 modules, 862 dependencies**
(`node_modules` resolved but not followed). Config: `depcruise.cjs` in this directory; the authoritative result is `depcruise.json`
(= `depcruise-ts-true.json`; `depcruise-ts-false.json` and `depcruise-ts-specify.json` are the other two modes, and the
`loose-*.json` files are the earlier, subtly wrong runs described under caveat A).

## The command and how long it takes

```sh
cd /home/user/delivery-control-center
# dependency-cruiser must be able to `import("typescript")` from where IT is installed (see caveat A);
# with it as a devDependency this is simply `npx depcruise …`.
node ~/.npm/_npx/8b2b02dfd972a5c3/node_modules/dependency-cruiser/bin/dependency-cruiser.mjs \
  --config /tmp/claude-0/-home-user-delivery-control-center/b2470b29-abd6-5f6c-8317-bcaed54a68e8/scratchpad/experiments/depcruise.cjs \
  --ts-config tsconfig.json \
  --output-type json --output-to /tmp/claude-0/-home-user-delivery-control-center/b2470b29-abd6-5f6c-8317-bcaed54a68e8/scratchpad/experiments/depcruise.json \
  packages/db/src packages/core/src apps/api/src apps/web/src apps/mcp/src
```

Wall time, whole graph plus all seven rules: **1.60 s** with `tsPreCompilationDeps: true` (TypeScript AST only), 4.44 s with `false`
and 4.95 s with `"specify"` (both add a transpile pass), after a one-off 3 s `npx` download. `--output-type err-long` gives the
human-readable report in the same time.

`--ts-config`: the root `tsconfig.json` (`files: []` + project references, no `compilerOptions`) did **not** confuse it — root, none and
`packages/core/tsconfig.json` give identical graphs, because this repository has no `paths`/`baseUrl`, which is all dependency-cruiser
reads a tsconfig for. The workspace packages resolve through the `node_modules/@dcc/*` symlinks and each package's `exports` map
(`enhancedResolveOptions.exportsFields` / `conditionNames` in the config) and are followed to their real paths (`@dcc/db` →
`packages/db/src/index.ts`, dependency type `undetermined`), which is what lets path rules such as `to: { path: "^packages/db/src" }`
work. `could-not-resolve: 0`.

## Results

| # | rule | severity | violations (`tsPreCompilationDeps: true`) | with `false` (runtime edges only) | distinct `from` files | examples (up to 5) |
|---|---|---|---|---|---|---|
| 1 | no-circular | error | **14** | **2** | 7 | `apps/web/src/api.ts → components/FileCompare.tsx → claude/Info.tsx → api.ts`<br>`packages/core/src/ai-assist.ts → tasks.ts → ai-assist.ts`<br>`packages/core/src/chat/index.ts → chat/proposals.ts → chat/index.ts`<br>`packages/core/src/chat/index.ts → screens/index.ts → chat/index.ts`<br>`packages/core/src/glossary/concepts/admin.ts → glossary/index.ts → glossary/concepts/index.ts → concepts/admin.ts` |
| 2 | api-bypasses-core | error | **7** edges | 7 | 4 | `apps/api/src/context.ts → packages/db/src/index.ts`<br>`apps/api/src/context.ts → packages/db/src/schema/index.ts`<br>`apps/api/src/scenario-altshuler.ts → packages/db/src/index.ts`<br>`apps/api/src/server.ts → packages/db/src/index.ts`<br>`apps/api/src/server.ts → packages/db/src/schema/index.ts` (and `smoke.ts` → both) |
| 3 | mcp-bypasses-core | error | **2** edges | 2 | 1 | `apps/mcp/src/server.ts → packages/db/src/index.ts`<br>`apps/mcp/src/server.ts → packages/db/src/schema/index.ts` |
| 4 | chat-reaches-onboarding | error | **3** edges | 3 | 2 | `packages/core/src/chat/index.ts → repo-onboarding/runs.ts`<br>`packages/core/src/chat/proposals.ts → repo-onboarding/change-diff.ts`<br>`packages/core/src/chat/proposals.ts → repo-onboarding/changes.ts` |
| 5 | insights-reaches-chat | error | **1** edge | 1 | 1 | `packages/core/src/insights.ts → chat/index.ts` |
| 6 | core-reaches-db-directly (informational) | info | **86** edges | 86 | **44 of 89** core modules (49 %) | `packages/core/src/actions/index.ts → packages/db/src/index.ts`<br>`packages/core/src/actions/index.ts → packages/db/src/schema/index.ts`<br>`packages/core/src/admin.ts → packages/db/src/index.ts`<br>`packages/core/src/admin.ts → packages/db/src/schema/index.ts`<br>`packages/core/src/ado-pull.ts → packages/db/src/index.ts` |
| 7 | no-orphans (excluding `*.test.ts`, `*.prove.ts`, `*.d.ts`) | info | **0** | 0 | 0 | — |

Totals: 27 errors + 86 info (`true`), 15 errors + 86 info (`false`). dependency-cruiser exits non-zero on errors, so as a check it fails
today on rules 1–5 either way. None of the 13 edges behind rules 2–5 is type-only (the tool's tags agree with reading the imports), so
those numbers do not depend on the mode; only cycles do.

### Rule 1 — the 14 cycles, and what they are

With TypeScript loaded, the tool tags `import type` edges as `type-only`; the per-edge tags (`depcruise-ts-true.json`) say:

| cycle | closing edge | nature |
|---|---|---|
| `apps/web/src/api.ts → components/FileCompare.tsx → claude/Info.tsx → api.ts` | `api.ts:1 import type { FileVersionsData } from "./components/FileCompare.tsx"` | type-only — harmless at runtime; a type layer importing from a component is still a smell |
| `core/ai-assist.ts → core/tasks.ts → core/ai-assist.ts` | `tasks.ts:133,203 await import("./ai-assist.ts")` (the comment at `tasks.ts:132` says it is deliberate) | value cycle by a lazy `import()` — real dependency, not a load-time cycle |
| `core/chat/index.ts → core/chat/proposals.ts → core/chat/index.ts` | `proposals.ts:14` imports `ChatError, chatDir, ensureSystemFile, messageView, resolveTopic, …` from `./index.ts`; `index.ts:15` imports `codeReadEstimate, codeReads` from `./proposals.ts` | **the one genuine static value cycle** |
| `core/chat/index.ts → core/screens/index.ts → core/chat/index.ts` | `screens/index.ts:1 import type { ResolvedTopic, TopicKind } from "../chat/index.ts"` | type-only |
| 10 × `glossary/index.ts → glossary/concepts/index.ts → glossary/concepts/<x>.ts → glossary/index.ts` (and the 2-cycle `concepts/index.ts ⇄ glossary/index.ts`) | every `concepts/*.ts` starts with `import type { Concept } from "../index.ts"` | type-only — all 10 vanish if `Concept` moves to a `glossary/types.ts` |

So: 14 reported, 12 closed by `import type`, 1 by a lazy `import()`, 1 genuine — exactly the 2 that `tsPreCompilationDeps: false`
reports. Lengths: 4 cycles of 2 modules, 10 of 3.

### Rules 2 and 3 — what "bypasses core" means in code

`apps/api/src/server.ts` (1,813 lines) imports `db, dbKind, withTenant, timeline, unassigned` from `@dcc/db` and the tables
`client, repo, users, workitem` (line 5) and `blocker, gap, task` (line 188) from `@dcc/db/schema`; it has 5 `withTenant(` blocks and 9
raw Drizzle calls (6 `tx.select/insert/update/delete`, 3 `db.*`) — e.g. `GET /workitems/:id` selects the row itself at line 818 and
spreads it into the response. `context.ts` resolves the dev user with `db.select(...).from(users)` (line 31) and re-exports
`withTenant`. `smoke.ts` and `scenario-altshuler.ts` are scripts, not the server — a `pathNot` on the rule would exempt them, leaving 2
offending files. `apps/mcp/src/server.ts`: 2 `withTenant`, 6 raw calls. Sizing the fix: about 15 query sites to move behind core
functions plus a core-side `withTenant`/`timeline` re-export — a day's work; the rule is then enforceable as written.

### Rules 4 and 5 — real, intended dependencies

Rule 4's three edges are value imports the chat needs to answer on the onboarding screen: `onboardingChatFacts` (`chat/index.ts:12`),
`changedFiles` and `writeChangesDiff` (`chat/proposals.ts:7–8`). Enforcing "the chat must not know onboarding" means inverting it —
onboarding registers its facts and proposal handlers with the chat, the way `actions/index.ts` already registers actions. Rule 5's
single edge is utility coupling: `insights.ts:8` imports `ChatError, ensureSystemFile, internalClientId`; moving those three helpers to
a shared module makes the rule pass without touching behaviour.

### Rule 6 — would a data-access layer be needed?

44 of the 89 non-test core modules import `@dcc/db` directly (all 44 take the client — `db`/`withTenant`/`appendEvent` — and 42 also
import tables from `@dcc/db/schema`; none of the 86 edges is type-only). A rule "core must not touch the database directly" would
need a data-access layer wrapping roughly half of core — a rewrite of core's query code, not a layer added beside it, and at odds with
the repository's SQL-first Drizzle design (`openspec/project.md`). The enforceable rule today is the inverse and cheaper one, "only
`packages/core` may import `@dcc/db`" (rules 2–3), with 9 edges in 5 files to fix. The 44 files are listed in `arch-rules-table.md`.

## What the tool needed — the caveats that matter for adopting it

**A. The install trap, in two layers.** dependency-cruiser loads TypeScript with an ESM `await import("typescript")` *from its own
location* (`src/extract/tsc/parse.mjs`, `src/extract/transpile/typescript-wrap.mjs`).

- Layer 1 — `npx --yes dependency-cruiser` puts the tool in an isolated `~/.npm/_npx/…` directory that cannot see the repository's
  `node_modules/typescript`. It then **silently skips every `.ts`/`.tsx` file**: `--info` shows `x typescript … x .ts`, the run cruised 2
  modules (`statusline.mjs` and `fs`) and reported **0 violations for all seven rules with exit code 0** — a CI step written that way
  passes vacuously forever.
- Layer 2 — `NODE_PATH=$PWD/node_modules` looks like a fix and is worse: `--info` now says `✔ typescript` and `.ts ✔`, because the
  availability check uses `require.resolve` (honours `NODE_PATH`), but the real loader is an ESM `import()` (ignores `NODE_PATH`), so
  the TypeScript AST and the TypeScript transpiler are both unavailable and every `.ts` file falls through to **acorn-loose, an
  error-tolerant JavaScript parser** (`src/extract/acorn/parse.mjs:50`). That run produced 225 modules / 854 edges with the *same*
  violation counts as the correct run — by luck — but dropped the two `export type { … } from` re-exports in
  `packages/core/src/index.ts` (lines 60, 64), `attachments/extract.ts → mammoth` and the `/// <reference types="vite/client" />`
  edge, and carried **no `type-only` tag at all**, so `tsPreCompilationDeps` true/false/`"specify"` all gave identical output
  (the `loose-*.json` files). Only when `typescript` was resolvable next to the tool (a symlink in the npx cache, removed afterwards;
  equivalent to installing both as devDependencies) did the counts become 227 / 862, 37 edges got `type-only`, and the modes started
  to differ (14 vs 2 cycles).
- Lesson, in the spirit of `CLAUDE.md`'s "don't trust an empty result without a positive control": a CI step should assert
  `--info` lists `typescript@…` **and** that the module count is above a floor, or the check is theatre. Installing dependency-cruiser
  as a devDependency (TypeScript already is one) removes both layers.

**B. `--ts-config` is irrelevant here** (no `paths`/`baseUrl`), but `enhancedResolveOptions` with `exportsFields: ["exports"]` and the
`conditionNames` are what make `@dcc/db/schema` resolve — without them the workspace edges would be `could-not-resolve` and rules 2, 3
and 6 would report nothing, the same false green one level down.

**C. Choose the mode per rule.** `tsPreCompilationDeps: true` is fastest (1.6 s) and right for layering rules (a type-level dependency on
`@dcc/db` is still a dependency), but it counts type-only cycles; `false` is right for `no-circular` (only runtime edges: 2 cycles) but
costs a transpile pass (4.4 s) and drops the type-level layering edges (none here, so rules 2–6 are unchanged); `"specify"` keeps
everything and tags it (37 `type-only`, 36 `pre-compilation-only`), so a single run can use `dependencyTypesNot: ["type-only"]` in the
cycle rule and plain `path` rules elsewhere — the configuration to adopt.

Minor: workspace edges carry `dependencyTypes: ["undetermined", "import"]` rather than `local`/`npm`, so rules should match on `path`.
The JSON is ~600 KB for 227 modules — fine for CI, keep it out of git.

## Adopting it (if the decision is yes)

`npm i -D dependency-cruiser`, `.dependency-cruiser.cjs` at the root (the config here works unchanged; set `tsPreCompilationDeps:
"specify"` and add `dependencyTypesNot: ["type-only"]` to `no-circular`), `"arch": "depcruise --config .dependency-cruiser.cjs
packages/db/src packages/core/src apps/api/src apps/web/src apps/mcp/src"` in `package.json`, and one `--output-type json >
.dependency-cruiser-known-violations.json` so that `--ignore-known` freezes today's errors as a baseline and only *new* violations fail —
the rules can be switched on before the 9 bypass edges, the 3 + 1 coupling edges and the one real cycle are fixed. Cost per run:
2–5 s, no database, safe next to the running API.

## Would eslint-plugin-boundaries or ts-arch express the same rules?

Yes for all seven, with different trade-offs. **eslint-plugin-boundaries** describes elements by path pattern (`api: apps/api/src/**`,
`db: packages/db/src/**`, `core-chat: packages/core/src/chat/**`, `core-onboarding: packages/core/src/repo-onboarding/**`,
`core-insights: packages/core/src/insights.ts`, …) and forbids pairs with `boundaries/element-types`; it resolves `@dcc/db` through
`eslint-import-resolver-typescript`, runs inside the existing `npm run lint` (ESLint 10 flat config) and per file in the editor, and sees
`importKind: "type"`, so it can allow `import type` from `@dcc/core` in `apps/web` while forbidding value imports — the guard experiment 2
calls for. It has no cycle or orphan detection; `import/no-cycle` from eslint-plugin-import covers cycles, slowly. **ts-arch** (TSArch) is
programmatic — `filesOfProject().inFolder("apps/api").shouldNot().dependOnFiles().inFolder("packages/db")`, `.should().beFreeOfCycles()`
— and would sit naturally in `npm test` (Vitest, no database), but it builds its own graph through the TypeScript API, is slower on
this size, and is weaker on `exports`-map resolution of workspace packages. dependency-cruiser is the only one of the three that gives
cycles, orphans, `reachable` rules, a known-violations baseline and a graph picture in one tool — provided it is installed where it can
load TypeScript, which is the whole of caveat A.
