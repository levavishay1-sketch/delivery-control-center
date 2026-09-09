---
name: repo-contention
description: At the start of work on a DCC WorkItem, find out what else is active in the same repo and which files overlap; at the end, register the files this WorkItem actually touched. Overlap is a warning, not a gate — worktree isolation means work never collides; the decision is at merge time.
---

# repo-contention

Call this at **two points**.

## 1. Starting work

```bash
node <path-to>/skills/dcc.mjs contention --repo <repo-name>
```

Shows every file in the repo that an active WorkItem is touching, and
which ones are **contended** (more than one). If your task will touch a
contended file, that is not a stop — note it, and expect the Reviewer to
focus there at merge time. Work in your own branch / worktree as normal.

## 2. Declaring what you'll touch (early) and what you touched (at PR)

```bash
# early — from the plan / affected areas
node <path-to>/skills/dcc.mjs touches --workitem <id> --repo <repo-name> \
  --branch feature/WI-1284-x --kind declared \
  --paths src/pricing/engine.ts,src/pricing/tier.ts

# at PR — the real diff
node <path-to>/skills/dcc.mjs touches --workitem <id> --repo <repo-name> \
  --branch feature/WI-1284-x --kind branch \
  --paths $(git diff --name-only main | paste -sd,)
```

The response lists any **overlaps** with other active WorkItems — pass
those to the `reviewer` agent as its overlap region.

## 3. After merge

```bash
node <path-to>/skills/dcc.mjs touches-release --workitem <id>
```

Frees this WorkItem's files from the active-edit map.
