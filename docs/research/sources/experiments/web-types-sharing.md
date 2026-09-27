# Experiment 2 — sharing `apps/web/src/api.ts` types from `@dcc/core` instead of hand-copying them

Date: 2026-09-27. Repository: `/home/user/delivery-control-center`, branch `claude/busy-heisenberg-5n9a0s`, tree clean at the start.
Tools: TypeScript 5.9.3, vite 6.4.3, drizzle-orm 0.44.7, `@types/node` 26.5.0, Node 22.22.2. Single machine, no other heavy process during the timed runs
(a `tsx` API and a vite dev server were idle in the same folder). Every measurement was taken on a throwaway copy `apps/web-exp`
(package renamed to `@dcc/web-exp` so npm workspaces would not see two `@dcc/web`); the copy was deleted afterwards and `git status`
shows no change under `apps/` or `packages/`. All artefacts are in this directory (`api.ts.experiment`, `api-ts.diff`, `plan.json`,
`rewrite-api.cjs`, `type-comparison.md`, `type-diffs.md`, `*-extdiag.txt`, `*-files.txt`, `web-exp-tsconfig.approach{A,B}.json`, `dts/`).

## 1. Baseline vs experiment

Two variants were measured. **A** is the experiment as specified: `import type { … } from "@dcc/core"`, which — because
`packages/core/package.json` has `"exports": { ".": "./src/index.ts" }` — makes the web program type-check core's *sources*.
**B** is the same `api.ts` but with `@dcc/core` / `@dcc/db` mapped (via `paths`) to declaration files emitted once into the scratchpad,
i.e. what a consumer would see if core shipped `.d.ts`.

| metric | baseline `apps/web` | A: `import type` from `@dcc/core` (sources) | B: same, `paths` → prebuilt `.d.ts` |
|---|---|---|---|
| `npx tsc -p … --noEmit`, wall, 2 runs | **10.10 s / 9.42 s** | **14.40 s / 14.35 s** (+~48 %) | **10.59 s / 10.64 s** (+~9 %) |
| tsc errors | 0 | 0 (after one `lib` change, see §2) | 0 |
| `--extendedDiagnostics` total / check time | 8.93 s / 7.55 s | 13.80 s / 11.87 s | 10.01 s / 8.29 s |
| files in the program | 402 | 891 | 802 |
| lines of TypeScript / of definitions | 12,521 / 115,260 | 30,527 / 145,300 | 12,396 / 149,443 |
| symbols / types / instantiations | 203,609 / 47,427 / 137,307 | 506,223 / 142,833 / 741,081 | 245,331 / 47,799 / 137,697 |
| memory used | 310 MB | 592 MB | 369 MB |
| `vite build` wall (vite's own figure) | 3.81 s (3.31 s) | 4.06 s (3.41 s) | not rebuilt (tsconfig-only change) |
| `apps/web/dist` total bytes | 1,239,814 | **1,239,814 (identical)** | — |
| main JS chunk | `index-CfqU5QC3.js` 1,136,812 B (gzip 317.29 kB) | **same name, same hash, same size** | — |
| `api.ts` lines (`wc -l`) | 865 | 740 | 740 |
| `export type` declarations in `api.ts` | 126 | 59 (5 of them are one-line extensions of a core type) | 59 |
| types imported from `@dcc/core` | 0 | 72 | 72 |

Where the extra files in **A** come from (`--listFilesOnly`, grouped): `drizzle-orm` 303, `packages/core` 88, `unpdf` 53, `undici-types` 44,
`packages/db` 15, `zod` 14, `pg-protocol` 4, `@types/pg` 3, `@electric-sql/pglite` 2, `mammoth` 1. `@types/node` (83 files) is **not** new:
the baseline program already contains it because `vite.config.ts` is in the web tsconfig's `include` and `vite/dist/node/index.d.ts`
references `node` (`--explainFiles`). In **B** the program has 0 core sources, 74 emitted `.d.ts`, and still 300 `drizzle-orm` files —
the declarations keep `typeof task.$inferSelect` and `import { task } from "@dcc/db/schema"`, so Drizzle's types are loaded either way,
but they are no longer *checked* (skipLibCheck), which is why B's type/instantiation counts equal the baseline's.

Bundle leak check on A's `dist/assets/*.js`: 0 occurrences of `drizzle`, `@dcc/core`, `node:fs`, `child_process`, `pglite`, `withTenant`,
`appendEvent`. esbuild erases `import type` / `export type { … } from` completely; the emitted chunk is byte-identical to the baseline.

Diff of `api.ts` (`api-ts.diff`): 277 lines removed, 152 added — a 144-line `import type { … } from "@dcc/core"` + `export type { … }`
block (the web's other files keep importing these names from `./api.ts`), and five 1–4-line extension aliases.

## 2. What was needed to resolve `@dcc/core` from the web app

- **Resolution itself: nothing.** `apps/web/tsconfig.json` uses `moduleResolution: "bundler"`; the workspace symlink
  `node_modules/@dcc/core → packages/core` and core's `exports` map resolve straight to `packages/core/src/index.ts`. `verbatimModuleSyntax`
  is on, so every import had to be `import type` and every re-export `export type { … }` — both were accepted by `tsc` and erased by vite.
- **One compiler option (A):** `lib: ["ES2022", …]` → `["ES2023", …]`. Core is compiled with `ES2023` and uses `Array.prototype.findLast`
  (`packages/core/src/ai-assist.ts:1593`); with the web's ES2022 lib the first run produced exactly 2 errors (`TS2550` + the consequential
  `TS7006`), both *inside core*, i.e. the web's typecheck now reports core's problems under the web's compiler settings. Nothing else:
  no `Buffer`/`NodeJS.*` vs `lib: dom` conflicts appeared (Node's types were already in the program, see §1), `types: []` did not matter,
  and no `Date` vs `string` mismatch surfaced among the 72 imported types, because core's own view types already carry ISO strings — `Date`
  reaches core's exported types only through Drizzle rows (`PromptTemplateRow = typeof promptTemplate.$inferSelect`,
  `TaskDetail.task: typeof task.$inferSelect`), and those two types were left hand-declared (§3).
- **For B:** emit declarations for `packages/db/src` + `packages/core/src` (`dts-tsconfig.json`: `declaration` + `emitDeclarationOnly`,
  `rootDir: packages`, `outDir` in the scratchpad, `types: ["node"]` with an explicit `typeRoots`; 7.9 s, 133 `.d.ts`, 0 errors; a
  `node_modules` symlink next to the output so the `.d.ts` files' bare imports resolve), then in `apps/web-exp/tsconfig.json`
  `paths` for `@dcc/core`, `@dcc/db`, `@dcc/db/schema`, `@dcc/db/events`. In the real repository `npm run typecheck` (`tsc -b`) already emits
  `packages/core/dist/*.d.ts`, but nothing points at it: core's `main`/`exports` name `src/index.ts`, so the web would need either the
  `paths` trick or a `types` condition in core's `exports` — and would then depend on a build artefact that can be stale.

## 3. Types imported vs kept

**Starting point (checker-based comparison, `type-comparison.md`):** `api.ts` exports 126 types; `@dcc/core`'s index exports 118;
69 names exist in both; 34 are verbatim copies (comments and whitespace ignored) and 8 more differ only in formatting; the rest differ by
an inline union vs a named alias, by fields the API adds, or by real drift (below).

**Imported — 72 names** (`plan.json`):

- *61 as-is, same name:* RequirementCostSummary, ClaudeCallView, CenterBar, ClaudeOverview, ChatMessage, ConversationView, TopicRef, Concept,
  ScreenGlossary, InsightCluster, InsightCallRow, UnhelpfulRow, InsightsView, PolicyChange, StartBuildResult, AssessGap, AssessResult,
  BreakdownResult, TaskStatus, SpecPiece, SpecView, TaskFlowEdge, MaterializeResult, TaskBuiltOn, TaskDeleteNode, TaskDeletePrecheck,
  ImportResult, TaskRunRecord, ImplementResult, LinkedTaskRow, OnboardingStatus, OnboardingStageKey, OnboardingStageDefinition,
  AutomationPreset, AutomationPolicy, Effort, ModelChoice, ModelPolicy, OnboardingSession, CodeMapPlace, CodeMapNodeKind, CodeMapArrow,
  TaskOverlap, MergeResult, PullRequestRow, PullRequestList, NextStep, FileGroup, TimelineItem, ConflictFile, ConflictView,
  PullRequestDetail, ReviewDecision, ConflictSegment, ConflictFileContent, ConflictContent, CheckResult, VerifyResult, BranchHealth,
  RepoBranches, PullRequestQuick.
- *6 renamed on import (same shape, different name in core):* `ChatContext ← ScreenContext`, `TaskFlowStep ← FlowStep`,
  `SpecDocLine ← DocLine`, `SpecDocCell ← DocCell`, `SpecDocBlock ← DocBlock`, `PrBlocker ← Blocker` (core's `Blocker` is the pull-request
  blocker; the web's `Blocker` is the work-item question — a name clash the rename resolves).
- *5 imported as the base of a web-side extension:* `AdoTaskRow = core & { status: TaskStatus | null }` (the API adds the status),
  `DeleteTaskConfirm = DeleteTaskOptions & { clientId }`, and the code-map family `CodeMapNode = core & { heading?: string }`,
  `CodeMapLane = Omit<core, "nodes"> & { nodes: CodeMapNode[] }`, `CodeMap = Omit<core, "lanes"> & { lanes: CodeMapLane[] }` — `heading`
  is set only client-side (`apps/web/src/components/CodeMap.tsx:122`), so the server type cannot carry it; a core `CodeMap` is still
  assignable to the web one (the added field is optional), which is what lets `PullRequestDetail.codeMap` (core) flow into the component.

**Drift the comparison exposed** (hand copies that had silently diverged from the server type):

| type | what differs | verdict |
|---|---|---|
| `OnboardingSession.status` | core's `SessionStatus` also has `durationMs`, `modelId`, `updatedAt` | web copy stale (missing 3 fields) |
| `ImplementResult` | core also has `base?: FlowBase`, `pushedAt?`, `closedAt?` | web copy stale (missing 3 fields) |
| `Concept` | core also has `screens?: string[]` | web copy stale |
| `TaskStatus.key`, `TimelineItem.kind` | `string` in the web, closed unions (`TaskStatusKey`, 8 literals) in core | web copy looser than the truth; importing tightened it with 0 errors |
| `FileGroup.key`, `BranchHealth.status`, `PullRequestRow.state/review/checks` | inline unions in the web, named aliases in core, same literals | cosmetic |
| `CodeMapNode.heading` | exists only in the web | legitimately client-only |
| `PolicyDoc` (web) vs `Policy` (core) | the web models the `$comment` string entries the JSON file carries; core's `Record<string, ModelPrice>` does not | **the copy is more truthful than the source** — kept |

**Kept hand-declared — 54 names, five reasons:**

1. *Wire shape of a Drizzle row that core never names (10):* `EventRow`, `Gap`, `Blocker`, `Task`, `WorkItem`, `LinkedRepo`, `Attachment`,
   `Requirement`, `PromptTemplate` (core's `PromptView` is `PromptTemplateRow & {…}` with `updatedAt: Date`), `TaskDetail` (core's has
   `task: typeof task.$inferSelect` — `Date` columns — and the API adds nine more fields at `apps/api/src/server.ts:1118`). The API spreads
   rows straight into responses (`{ ...wi, ...full }`, `server.ts:820`); `Date` → ISO string happens implicitly in `JSON.stringify`
   (0 `toISOString` calls in `server.ts`), so the only honest description of these payloads is the hand-written one.
2. *Responses composed inside API routes with no named core type (20):* `WorkItemDetail`, `Initiative`, `Dashboard`, `AuditPage`, `FlowData`,
   `WorkListRow`, `ClientRow`, `ClientDetail`, `TaskFlowNode` (core's has `kind: string`, no `status`), `TaskFlow`, `AdoTasks`, `AllAdoTasks`,
   `ChatOpen`, `ChatAnswer`, `OnboardingRunView`, `OnboardingRunSummary`, `OnboardingCost`, `OnboardingRun`, `OnboardingStage`,
   `OnboardingEvent`. (`Awaited<ReturnType<typeof openChat>>` would work for some, at the price of binding the web to core's function
   signatures.)
3. *Deliberately different from core's type (6):* `PolicyDoc`, `PolicyView`, `PolicyCapability`, `PolicyPrice` (see the table above),
   `CenterQuery` (the query-string form of `CenterFilter`: `escalated: "1"`, strings everywhere), `FlowRun` (adds the `idle` state and a null
   id for "no run" — the API's answer, not core's `FlowRunView`).
4. *Declared in core but not exported from the package index (12):* `ExistingSetup`, `PrepareResult`, `InitResult`, `ReviewResult`,
   `DeliverResult`, `ChangedFile`, `StageAutomation`, `SessionState` (all in `repo-onboarding/types.ts`; `repo-onboarding/index.ts` re-exports
   only eight names from that file), `RequirementRung` (`flow.ts`), `PullRequestFile` (`pull-request-detail.ts`), `ProposalPayload` and
   `DeclaredCostPayload` (module-private in `chat/proposals.ts`). One export line in core would unlock these — out of scope for a
   web-only experiment.
5. *Small unions and results core keeps inline or in `@dcc/db`'s pg enums (6):* `ReqType`, `GapState`, `GapKind`, `TaskKind`,
   `RequirementType`, `AdoSyncResult`.

## 4. Estimate: a `@dcc/contracts` package (plain JSON-shaped types, no Drizzle)

From what the comparison showed, the 126 web types split as follows:

- **72 already exist as plain JSON shapes in core** (string dates, no Drizzle) — they would move to contracts unchanged, and core would
  import them back (core's view builders already produce exactly these shapes).
- **44 are plain JSON shapes that exist today only as object literals in API routes or as unexported core types** (groups 2–5 above):
  writing them down in contracts is mechanical; the value is that the routes would then be *annotated* with a return type, which nothing
  does today — the contract would finally be checked on the producing side.
- **10 are derived from database rows** (group 1): server-side they are `$inferSelect` rows or spreads of them, with `Date` columns
  serialised implicitly. In contracts they must be hand-written wire shapes (as the web writes them now) or produced by a
  `Serialized<T>` mapped type from the Drizzle row — which would make contracts depend on `@dcc/db` and drag drizzle-orm's 300 `.d.ts`
  into every consumer, defeating the point. Hand-written is the right call; it moves the drift risk from web↔core (126 types, found
  ~7 divergences) to contracts↔db (10 types), where a one-line `satisfies` check in each API route would catch it.
- Core itself uses `$inferSelect`/`InferSelectModel`/`$inferInsert` only 18 times and exports a single row-derived alias
  (`PromptTemplateRow`), so the package boundary is realistic: contracts ← core ← api, contracts ← web; nothing in contracts needs Node,
  Drizzle or `Date`.

Rough size: ~126 type declarations (~700 lines, mostly moved not written), plus return-type annotations on ~60 routes in
`apps/api/src/server.ts` (1,813 lines) if the contract is to be enforced where the data is produced.

## 5. Conclusions

1. **Sharing is mechanically free at runtime and cheap to do:** 72 of 126 types (57 %) were replaced by type-only imports with a single
   `lib` bump; `vite build` produced a byte-identical bundle, and no server code can leak while the imports stay `import type`
   (`verbatimModuleSyntax` makes a value import a compile error, and esbuild would fail loudly on Node built-ins).
2. **The cost is the web typecheck, and it comes from core's *sources*, not from the shared types:** importing from
   `@dcc/core` as configured today makes `tsc -p apps/web` check all of core and db (402 → 891 files, instantiations ×5.4, memory ×1.9,
   wall time +48 %, 9.4 → 14.4 s). With prebuilt declarations the same imports cost +9–12 % (10.6 s). If types are shared, core should
   publish `.d.ts` (it already emits them under `tsc -b`) or the web tsconfig must map to them — and then a stale-declaration
   guard is needed.
3. **The hand copies had already drifted:** three types were missing fields the server sends, two were looser than the server's unions,
   one is more accurate than core's own type. Roughly 7 of the 69 same-named types (10 %) disagreed with the server, none caught by any
   check today.
4. **The ceiling is the API, not the web:** the 43 % that could not be imported are responses the routes assemble inline (20) or Drizzle
   rows spread into JSON (10). No amount of importing from core describes them; only a typed contract on the producing side does
   (a contracts package with annotated routes, or `satisfies` on each response).
5. **A guard is needed the day this ships:** a lint rule restricting `apps/web` to type-only imports from `@dcc/*`
   (`no-restricted-imports` with `allowTypeImports`, or `@typescript-eslint/consistent-type-imports`), because the failure mode — a value
   import of a Node module — is only caught at build time. dependency-cruiser can express it too (`tsPreCompilationDeps: "specify"`
   plus a rule with `dependencyTypesNot: ["type-only"]`), provided it is installed where it can load TypeScript — see the
   installation trap in `arch-rules.md`.
6. **Caveats:** one machine, two timed runs per configuration; the web's tsconfig already pulled in `@types/node` via `vite.config.ts`, so
   the "Node globals in browser code" risk is pre-existing and not attributable to sharing; the copy renamed its package and was never
   installed, so npm-workspace effects (two packages resolving the same `@dcc/core`) were not exercised; approach B's declarations were
   emitted with a scratch tsconfig, not by the repository's own `tsc -b`.
