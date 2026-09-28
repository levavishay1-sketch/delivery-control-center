# Onboarding proves itself — design

## The decisions, and why

| | decided | because |
|---|---|---|
| D3 | the measurement's executor is the developer's model (Sonnet, high) | what is measured is what a developer will get, not what the strongest model can do |
| D4 | one run per task and arm first, then one more run of the tasks whose arms disagree; arms interleaved per task; a hard cap | 60 runs under $30 is $0.50 a run — action tasks that build cost more; interleaving leaves paired data at a stop |
| D6 | the judge is a separate call with Read/Grep/Glob on the copy; the diagnosis facts are hints; the code graders' report is its start | a judge without tools failed a right answer because the "facts" were narrower than the repository |
| D7 | a component is delivered only if verified AND its tasks did not get worse; a knowledge component with no gain is proposed for removal; a safety component earns its place by a block seen in the "with" arm | "same" is not success for a line every session loads |
| D8 | the draft session runs before the decisions, capped ($3 / 40 min, editable), is set aside and scanned on exit, and the scan's "drop ours" is applied as an undoable decline | 41% of the cost; six redundant cards were built because the approval came first and the verdict was a note |
| D9 | one record file, `.dcc/onboarding.json`, without profile, interview, costs, ids, paths or secret locations | four files nobody read, one exposing the operator's path and the secrets' map |
| D10 | deny rules by pattern plus every file a secret was found in; config files not denied, their content guarded by the hook | 40-of-138 by alphabet left a password readable and blocked legitimate edits |
| D11 | one new status, `configured` (mcp/lsp/plugin); text is verified or failed; `installed` is transient | "installed · not checked" is gone from the delivery |
| D12 | the spec keeps its eight steps; the bank and the judge are side sources with their prompt text | the diagram's rules are the user's |
| D13 | the standalone `eval:onboarding` records to a scratch database; inside a run everything is rows and events | no second process on the API's PGlite; no silent action |
| D14 | `repository-coach` stays done; names it used that are gone are retired | the change extends the coach, it does not replace it |

## The measurement

```
bank (tasks.json) ── when(profile) ── fill(profile, processes) ──▶ tasks
                                                                    │
      worktree "without" @ baseline ◀── run task ──▶ worktree "with" @ baseline + deliverable files
      (--setting-sources project, --strict-mcp-config, --max-budget-usd)
                                                                    │
      evidence: answer, stream-json events, git diff vs baseline, committed files
                                                                    │
      graders (code) ──▶ judge (model, only when the code passed and the task has one)
                                                                    │
      record per run ──▶ summary: pass^k per arm, verdict per task, delta per component
```

`tasks.ts`, `graders.ts` and `report.ts` are pure (vitest); `workspace.ts`,
`judge.ts` and `run.ts` reach git and the CLI through `ai-assist.ts`. A
task's `exercises` names components by key, prefix, kind, family or the
files they wrote; a placeholder with no fact behind it keeps the task from
firing rather than asking with a hole.

## Where a model is used, and where never

| the code alone | a model |
|---|---|
| choosing and filling the tasks; the two arms; what changed, what ran, what was blocked, what was claimed; pass^k; the per-component delta; removal proposals; every status; every file written or deleted; the plan's phases; the cap on the session; the ledger slices | the executor of a task; the judge only where the code cannot decide (and it must look); the author (with one fix attempt); the reviewer; the editor of the draft; the open search |

## Order of the plan step

`cards` (drawn, not shown) → `draft` (the person opens the capped session or
skips) → `aside` (the session's files kept under the run's folder; what it
built or installed deleted; empty folders removed) → `scan` (against the
clean copy; verdicts applied) → `decide` (one round). A build from the draft
phase sets aside first. A restart between `aside` and `decide` opens the
cards.

## What a restart cannot break

A running measurement's arms are throw-away worktrees removed at the end and
pruned on recovery; a running step is failed with its button to rerun; the
draft session's spend is sliced into the ledger before it is marked
disconnected.
