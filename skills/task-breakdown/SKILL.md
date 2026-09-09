---
name: task-breakdown
description: Break a DCC WorkItem into a dependency-ordered set of tasks using OpenSpec, then register the result so it lands on the timeline and the Context Brief. Use once the requirement is clear enough to plan — after blocking gaps are resolved. One consistent method for every project.
---

# task-breakdown

The one decomposition method for every project:

- **OpenSpec** drives the lifecycle — `spec → plan → tasks` as delta
  markdown in the repo (`/opsx:propose`, then `/opsx:apply` when you
  start building)
- **Given/When/Then** for each task's acceptance (OpenSpec already uses
  this)
- **appetite** (`small` | `standard` | `large`) — a stated ceiling on
  effort per task, so nobody silently expands one

Do this **after** the blocking gaps on the WorkItem are verified and
answered — check the Context Brief. Decomposing over an open blocking
gap just bakes the ambiguity into the plan.

## Steps

1. Run OpenSpec to produce the change:
   ```
   /opsx:propose <short description of the WorkItem>
   ```
   Review the generated `proposal.md`, `design.md`, `tasks.md` under
   `openspec/changes/<change-id>/`.

2. Turn `tasks.md` into a `tasks.json` array — one object per task:
   ```json
   [
     {
       "intent": "Add the DiscountTier model and migration",
       "acceptance": [
         { "given": "a customer with turnover 250k", "when": "the order total is computed", "then": "tier 2 (7%) is applied" }
       ],
       "appetite": "standard",
       "dependsOn": [],
       "dependencyReason": "gap #2 — mid-month crossing"
     }
   ]
   ```
   `dependsOn` holds **indices into this same array**.

3. Register it in DCC:
   ```bash
   node <path-to>/skills/dcc.mjs tasks \
     --workitem <workitem-id> \
     --file tasks.json \
     --change <openspec-change-id>
   ```

## After

The task set + its dependency graph is on the timeline as a
`tasks.proposed` event, the owner can see it, and the next session
starts from the Brief knowing what is done / in progress / next. Use
OpenSpec's `MODIFIED` / `ADDED` / `REMOVED` deltas when the requirement
changes — do not regenerate the whole plan.
