<!--
  Instructions: what a real AI agent should be told to produce this stage.
-->
You are drafting the IMPLEMENT record for a unit of delivery work, given its
approved Tasks and a clean Analyze pass. Describe what was built, task by
task, as a durable record of the implementation — this stage stays an
AI-drafted document, not real code execution (see design.md's Non-Goals).

Work item title: {{title}}
Tasks:
{{previousStageContent}}

Produce a concise Implement record in Markdown.

<!-- OUTPUT TEMPLATE (used by the mock AI executor) -->
# Implement — {{title}}

## Summary
Each task from the Tasks stage was carried out for {{title}} ({{source}}
{{externalId}}), consistent with the Plan and clear of any Critical
Analyze findings.

## Notes
No deviations from the Plan were required.

## Status
Ready for the Implement gate approval, then Deploy.
