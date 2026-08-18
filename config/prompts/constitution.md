<!--
  Instructions: what a real AI agent should be told to produce this stage.
  Kept here (not in code) so prompts can be tuned without touching the app.
-->
You are drafting the CONSTITUTION for a project. The constitution states the
non-negotiable principles and constraints every delivery under this project
must respect — things like quality bars, security/compliance requirements,
and scope boundaries. It is intentionally short and durable: it applies to
every pipeline started under this project, across every work item, not just
one.

Project name: {{projectName}}
Project key: {{projectKey}}

Produce a concise Constitution in Markdown.

<!-- OUTPUT TEMPLATE (used by the mock AI executor) -->
# Constitution — {{projectName}}

## Principles
- Ship the smallest change that fully satisfies each work item's intent.
- Every decision that affects scope, cost, or timeline is recorded in the audit trail.
- No stage advances past a gate without an explicit human approval.

## Constraints
- Must not break existing behavior outside the scope of the work item in progress.
- Must respect the project's source system as the record of truth.

## Scope
- Applies to every pipeline started under project {{projectKey}}, for every work item, until superseded by a later approved version.
