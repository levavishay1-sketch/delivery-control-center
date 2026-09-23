# Checks lifecycle — design notes

## Routing each verdict back to its check

The development run writes the code and the tests for it and reports no
checks. The task's checks then run as calls of their own (`checks.run` on
the Prompts screen) — the build checks first, and the others only once the
build passes. Each check is listed by its `seq`, the same ordinal already
shown to users everywhere ("#3 בדיקה..."), with its kind when DCC added it:

```
#3 [build]: <check 3's instruction>
#4 [tests]: <check 4's instruction>
```

`ImplementResult.checks` is `[{seq, passed, detail, likelyCause, kind}]`.
Claude echoes back the same numbers it was given, so matching a response
entry to a DB row is a direct `seq` lookup within the task's own
checks — no fuzzy matching, no new schema for correlation.

## Why checks stay read-only

Considered letting a check write when it finds something trivial to
fix. Rejected: the moment a check can edit code, the line between "task"
(does the work) and "check" (verifies the work) stops being enforceable,
and a review has no way to tell which commit came from which intent.
Checks get `Read, Grep, Glob, Bash` only — Bash covers running tests or
a build, never covers changing what's under test. If a specific check
turns out to need write access, it was never a check; it should be
split out as its own small task.

## Why a failing check never raises a gap

Considered giving a check the same `gap-report` path already available
to every other Claude session in this codebase (it already has Bash,
so mechanically this would have been trivial). Rejected on reflection:
the entire reason assess + gaps exist is to close ambiguity *before*
breakdown. If a check — running after implementation — surfaces a real
ambiguity, that is not a new, independent gap; it is evidence that an
earlier stage under-specified something and needs to be revisited, not
patched around downstream. Baking in an automatic "check raises a gap"
path would let weak breakdowns slide through unnoticed until the most
expensive possible moment to catch them.

What ships instead: a failed check reports `detail` (what went wrong)
and a self-classification hint, `likelyCause: "implementation" |
"requirement_ambiguity"`. This is not a routing mechanism — it is a
hint that helps the human at the review step recognize "this isn't a
bug, the earlier stage needs to be redone" faster, without the system
silently continuing on the wrong foundation.

## Fact vs. decision, kept structurally separate

`checkResult` is set only from Claude's own structured report — it is
never itself a human decision. `checkResolvedBy` / `checkResolvedAt` are
set only when a human overrides (approves despite a failure, or
otherwise acts on the result directly) — mirrors `gap.resolvedBy`, the
same separation already used for gaps. A null `checkResolvedBy` with a
`checkResult` present means exactly what it says: this is what Claude
reported, untouched by a human. The UI must always be able to show
which one produced the current state — never blur "AI said it's fine"
into "a person verified it's fine".

## Approval cascade + immediate materialization

Approving a task's checklist item-by-item was the old model; it meant a
task could sit "approved" for a while with nobody having actually
looked at whether it should reach TFS yet, and the two-step
approve-then-separately-materialize flow made "מוכן להתחלה" lie about
what was actually true (it reflected the `approved` flag, not real TFS
existence). New model: approving a task approves every check under it
in the same action, and immediately calls the existing
`materializeTasksToAdo` for that workitem — reusing the function as-is
rather than writing a single-task variant, since it already filters
strictly to `approvedAt IS NOT NULL`. Status now has exactly two states
before "in progress": "ממתין לאישור הקמת משימה" (not yet approved) and
"מוכן להתחלה" (approved *and* confirmed to exist in TFS) — the
in-between "מאושר, טרם הוקם ב-TFS" state is retired because it no longer
describes anything real; the two actions are no longer separable by a
person.

## Completion gate

`progressTask(..., { to: "done" })` refuses when any non-dropped check
under the task has `checkResult !== "passed"` — unless the caller passes
an explicit override, which is exactly the `checkResolvedBy` write path
above, surfaced as a button at the review step ("אשר ידנית למרות
הכישלון"). The gate lives at the transition, not as a separate
validation pass, so there is exactly one place that can ever move a
task to `done`.
