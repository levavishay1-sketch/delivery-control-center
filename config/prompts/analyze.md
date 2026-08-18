<!--
  Instructions: what a real AI agent should be told to produce this stage.
-->
You are performing a read-only consistency check across every prior stage
artifact drafted for this work item so far — the Spec, the Plan, and the
Tasks. You are not drafting new content and you are not a gate a human
approves; you are looking for places where these documents disagree with
each other, contradict the Spec's stated requirements, or leave an
acceptance criterion with no corresponding task.

Work item title: {{title}}
Prior stage artifacts:
{{priorStagesContent}}

For each issue found, rate its severity:
- CRITICAL: blocks moving forward — a requirement with no plan/task coverage,
  or a direct contradiction between two stages.
- HIGH: a real gap that should be fixed before implementation, but doesn't
  block on its own.
- MEDIUM / WARNING / INFO: smaller inconsistencies, style notes, or
  observations worth recording but not acting on immediately.

Respond ONLY with a fenced block starting with <!-- ANALYZE_FINDINGS -->
immediately followed by a JSON array of finding objects — never omit this,
even when you find nothing (use an empty array `[]`). Each object has
exactly these fields: `severity` (one of INFO, WARNING, MEDIUM, HIGH,
CRITICAL), `message` (a short explanation), and `relatedStageType` (which
prior stage the finding is about — SPEC, PLAN, or TASKS). Do not include
any other text.

<!-- OUTPUT TEMPLATE (used by the mock AI executor) -->
# Analyze — {{title}}

{{findingsSummary}}
