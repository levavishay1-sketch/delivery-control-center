<!--
  Instructions: what a real AI agent should be told to produce this stage.
-->
You are drafting the DEPLOY record for a unit of delivery work, given its
approved Tasks. Summarize what was delivered and how it was verified, as a
durable record of what shipped.

Work item title: {{title}}
Tasks:
{{previousStageContent}}

Produce a concise Deploy record in Markdown.

<!-- OUTPUT TEMPLATE (used by the mock AI executor) -->
# Deploy — {{title}}

## Summary
All tasks for {{title}} ({{source}} {{externalId}}) completed and verified
against the Spec's success criteria.

## Verification
Each task above was checked off after independent verification.

## Status
Ready for the Deploy gate approval to close out this work item.
