---
name: review-overlap
description: Run the reviewer agent on a DCC WorkItem's PR before asking a human to approve. When another active WorkItem overlaps the same files, focus the review on that region. Records a structured review; a pass verdict is not an approval.
---

# review-overlap

The Reviewer is a **separate hat** from whoever wrote the change
(architecture §9) — a mechanical layer *before* human approval, not
instead of it.

## Steps

1. Get the overlap region from `repo-contention`:
   ```bash
   node <path-to>/skills/dcc.mjs touches --workitem <id> --repo <repo> \
     --kind branch --branch <branch> --paths $(git diff --name-only main | paste -sd,)
   ```
   The response's `overlaps` array is your focus region.

2. Invoke the `reviewer` agent (read-only) with:
   - the WorkItem and its PR/branch
   - the overlap region (files another active WorkItem is also touching)
   - the task's acceptance criteria

3. The agent writes `findings.json` and records the review:
   ```bash
   node <path-to>/skills/dcc.mjs review --workitem <id> --pr <n> \
     --verdict pass|changes_requested --file findings.json \
     --overlap "src/a.ts,src/b.ts"
   ```

## After

The review lands on the timeline (`review.completed`) and the Brief. A
`pass` means the mechanical pass found nothing blocking — a human still
decides. `changes_requested` with `block` findings should go back to the
Writer before human review.
