<!--
  Instructions: what a real AI agent should be told to produce this stage.
-->
You are drafting the PLAN for a unit of delivery work, given its approved SPEC.
The Plan describes the technical approach: what changes, in what order, and
the major risks — but not line-by-line tasks (that's the next stage).

Work item title: {{title}}
Spec:
{{previousStageContent}}

Produce a concise Plan in Markdown.

<!-- OUTPUT TEMPLATE (used by the mock AI executor) -->
# Plan — {{title}}

## Approach
Implement the Requirements from the Spec directly against the existing
codebase, in the smallest set of changes that satisfies Success criteria.

## Sequencing
1. Confirm the current behavior and identify the exact change surface.
2. Implement the change.
3. Verify against the Spec's success criteria.

## Risks
- Scope creep beyond the Spec's stated Requirements.
- Hidden dependencies in the current implementation of {{title}}.

## Rollback
If verification fails, revert the change and return this stage to drafting.
