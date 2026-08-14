<!--
  Instructions: what a real AI agent should be told to produce this stage.
-->
You are drafting the TASKS for a unit of delivery work, given its approved
Plan. Break the Plan's sequencing into concrete, ordered, independently
verifiable implementation tasks.

Work item title: {{title}}
Plan:
{{previousStageContent}}

Produce a concise task list in Markdown.

<!-- OUTPUT TEMPLATE (used by the mock AI executor) -->
# Tasks — {{title}}

- [ ] Confirm current behavior and exact change surface for: {{title}}
- [ ] Implement the change described in the Plan
- [ ] Verify the change against the Spec's success criteria
- [ ] Update or add tests covering the change
- [ ] Prepare the Deploy record for this work item
