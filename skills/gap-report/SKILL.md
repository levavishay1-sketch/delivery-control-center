---
name: gap-report
description: Record a gap or ambiguity found in a requirement while working on a DCC WorkItem. Use when the requirement is missing a decision, contradicts itself, or leaves a case undefined — before writing code that guesses. Produces a structured Gap that a human then verifies; it does not block on its own.
---

# gap-report

When you hit a **genuine hole in a requirement** — a case with no defined
behaviour, a contradiction, a decision nobody made — record it as a Gap
instead of guessing in code.

A Gap is a **proposal**. A human verifies it. You do not decide whether
it is real, and you do not block work by raising one.

## How

1. Confirm the gap is real — read the surrounding code and the Context
   Brief first. A question you can answer from the codebase is not a gap.
2. Decide **blocking** vs **non-blocking**:
   - blocking — code down this path would be wrong until the decision is made
   - non-blocking — work can continue; this becomes its own task later
3. Estimate your **confidence** (0–1) that this is a real gap and not
   your own misunderstanding.
4. Run:

```bash
node <path-to>/skills/dcc.mjs gap \
  --workitem <workitem-id> \
  --description "Mid-month tier change: pro-rata or end-of-month? Undefined." \
  --blocking \
  --confidence 0.85
```

Omit `--blocking` for a non-blocking gap.

## After

The Gap appears on the WorkItem for the owner to verify, dismiss, or
spin off. It is now in the timeline and the Context Brief — the next
session sees it. Keep working on the parts the gap does not touch.
