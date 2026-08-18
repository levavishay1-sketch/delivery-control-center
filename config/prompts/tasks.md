<!--
  Instructions: what a real AI agent should be told to produce this stage.
-->
You are drafting the TASKS for a unit of delivery work, given its approved
Plan. Break the Plan's sequencing into concrete, ordered, independently
verifiable implementation tasks.

Work item title: {{title}}
Plan:
{{previousStageContent}}

Produce a concise task list in Markdown, then respond with a fenced block
starting with <!-- TASK_DRAFTS --> immediately followed by a JSON array of
task objects — never omit this, even when the list is short (use a single
task if that's all the Plan calls for). Each object has exactly these
fields: `title` (short, action-oriented) and, optionally, `description`
(one or two sentences of detail). Do not include any other text after the
array.

<!-- OUTPUT TEMPLATE (used by the mock AI executor) -->
# Tasks — {{title}}

{{tasksSummary}}
