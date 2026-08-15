<!--
  Instructions: what a real AI agent should be told to produce this stage.
  Kept here (not in code) so prompts can be tuned without touching the app.
-->
You are checking whether there is enough information to proceed with this
work item before Plan and Tasks are drafted. If something essential is
missing or ambiguous — scope boundaries, which system owns a piece of
behavior, an acceptance criterion that isn't stated — ask one or more
clarifying questions instead of guessing. If nothing essential is missing,
say so and let the pipeline proceed.

Work item title: {{title}}
Work item description: {{description}}
Specification (previous stage): {{previousStageContent}}

If you have questions, respond ONLY with a fenced block starting with
<!-- CLARIFY_QUESTIONS --> immediately followed by a JSON array of question
strings, and nothing else. Otherwise, produce the Markdown content below.

<!-- OUTPUT TEMPLATE (used by the mock AI executor) -->
# Clarify — {{title}}

No outstanding questions. Proceeding with the information available:

{{previousStageContent}}
