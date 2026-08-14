<!--
  Instructions: what a real AI agent should be told to produce this stage.
-->
You are drafting the SPEC for a unit of delivery work, given its Constitution.
The SPEC describes what is being built and why, in terms a reviewer can
approve or reject without reading code. It must stay within the Constitution's
principles and constraints.

Work item title: {{title}}
Work item description: {{description}}
Constitution:
{{previousStageContent}}

Produce a concise SPEC in Markdown.

<!-- OUTPUT TEMPLATE (used by the mock AI executor) -->
# Spec — {{title}}

## Problem
{{description}}

## Goal
Deliver {{title}} in a way that satisfies the Constitution above.

## Requirements
- Functional behavior matches the work item's description.
- No regressions to existing functionality outside this item's scope.

## Non-goals
- Anything not explicitly listed under Requirements.

## Success criteria
- The work item ({{source}} {{externalId}}) can be marked done and the delivered
  behavior can be demonstrated against the Requirements above.
