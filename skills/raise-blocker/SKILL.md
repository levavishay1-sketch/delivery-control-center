---
name: raise-blocker
description: Raise a structured blocker when you are stuck mid-task on a DCC WorkItem and cannot proceed without an answer — missing access, an unclear requirement you cannot resolve from the code, or a budget/scope concern. Routes the question to the WorkItem owner and pauses that task; other tasks continue.
---

# raise-blocker

Use when you are **stuck on a specific task** and cannot move forward:

- **missing_access** — you need a credential, an API, an environment, a
  permission you do not have
- **unclear_requirement** — an ambiguity you cannot resolve from the
  codebase or the Context Brief, and guessing would be expensive to undo
- **budget_exceeded** — the task is costing far more than its appetite;
  it may be under-specified

Do **not** use this for a gap in the requirement itself (use
`gap-report`) or for something you can figure out by reading more code.

## How

```bash
node <path-to>/skills/dcc.mjs blocker \
  --workitem <workitem-id> \
  --type missing_access \
  --question "Need read access to the ERP pricing API to verify the calculation matches the current system. Which credential / endpoint?"
```

Write the question so the owner can answer it **without reading the
code** — state what you need and why, concretely.

## After

The blocker is routed to the WorkItem owner (who may not be at a
terminal). Stop this task and pick up another one that is not blocked.
When the owner answers, the answer lands in the timeline and the
Context Brief; a later session continues from there.

## Sign-in

`dcc.mjs` acts as the person working, with their DCC API token
(`DCC_API_TOKEN`, or the one `dcc.mjs login` saved). If it answers
"no API token" or "token revoked or expired", stop and ask the person to run
`node <path-to>/skills/dcc.mjs login` in their own terminal — never ask for
the token in the conversation. A "forbidden" answer names the permission they
lack; retrying will not help.
