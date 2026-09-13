# Compiled components — function-level call-graph analysis

Status: **backlog** — captured for planning, not started. Supersedes the
project-reference-level fix already shipped in `task-checks-polish`.

## Why

The current `compiledComponents` instruction (in `buildBreakdownPrompt`,
`packages/core/src/ai-assist.ts`) asks Claude to walk the **project
reference graph** backward from a changed file's own `.csproj` — every
project that references it, transitively. That was already a real
improvement over "just the direct project," but the user's next
correction is sharper: project-level closure over-includes.

A BL project can hold many unrelated BL classes and functions. If we
mark the *whole project* as "affected" and then walk everyone who
references *that project*, we pull in every root caller of every
function in that project — not just the callers of the one function
that actually changed. Most of those roots are not really affected by
this change at all.

## What changes

The analysis moves from **project-level** to **function-level** (call
graph):

1. Identify the specific file(s) and function(s) actually changed.
2. Find every function that calls the changed function.
3. Walk UP the call chain from there — callers of callers — repeatedly.
4. Stop at root callers / entry points (a plugin's registered execute
   method, a WebJob's entry point, a controller action — whatever
   "root" means for this repo's architecture).
5. `compiledComponents` is the set of projects that CONTAIN those root
   callers — not the project the changed function itself lives in,
   and not every project that merely references that project.

Worked example from the spec: changing function `X` inside some BL,
where the real call chain is `X → B → C → D → EntryPoint`, means the
project containing `EntryPoint` is what matters — not just "the project
X's BL lives in." There can be multiple independent root callers
reaching the same changed function, in which case there are multiple
relevant projects, and all of them belong in `compiledComponents`.

## Explicitly out of scope

- Building a persistent, indexed call graph for the whole repo. This
  stays a per-task, on-demand analysis Claude does by reading/grepping
  the checked-out repo at breakdown time — same cost/scope model as
  every other breakdown-time analysis in DCC (see `design.md` on why
  headless `claude -p` calls stay self-contained rather than backed by
  infrastructure).
- Cross-repository call graphs (a WebJob in a different repo calling
  into this one, say). Single-repo only for the first pass.

## Impact

- `packages/core/src/ai-assist.ts` — rewrite the `compiledComponents`
  prompt section (the reverse-project-reference instructions just
  added) into an explicit function-level call-graph walk, with the
  worked example above included verbatim so the instruction is
  unambiguous.
- No schema change — `task.compiledComponents` already exists and
  already stores an array of project names; this only changes what
  goes into it.

## Exit gate

Re-running breakdown on a task that touches one function inside a
multi-purpose BL project reports only the project(s) containing that
function's actual root callers — not the BL project itself (unless a
root caller happens to live there too), and not every project that
merely references the BL project.
