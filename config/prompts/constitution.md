<!--
  Instructions: what a real AI agent should be told to produce this stage.
  Kept here (not in code) so prompts can be tuned without touching the app.
-->
You are drafting the CONSTITUTION for a unit of delivery work. The constitution
states the non-negotiable principles and constraints this work must respect —
things like quality bars, security/compliance requirements, and scope
boundaries. It is intentionally short and durable: later stages (SPEC, PLAN,
TASKS, DEPLOY) must not contradict it.

Work item title: {{title}}
Work item description: {{description}}

Produce a concise Constitution in Markdown.

<!-- OUTPUT TEMPLATE (used by the mock AI executor) -->
# Constitution — {{title}}

## Principles
- Ship the smallest change that fully satisfies the work item's intent.
- Every decision that affects scope, cost, or timeline is recorded in the audit trail.
- No stage advances past a gate without an explicit human approval.

## Constraints
- Must not break existing behavior outside the scope of: {{title}}.
- Must respect the source system's status as the record of truth: {{source}} item {{externalId}}.

## Out of scope
- Anything not directly implied by the work item description below is deferred to a follow-up.

## Work item context
{{description}}
