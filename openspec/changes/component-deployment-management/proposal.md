# Component deployment & environment management

Status: **backlog** — captured for planning, not started.

## Why

DCC currently tracks a task through code + TFS, but stops at "committed
on a branch." Nothing in the system knows how to actually get a changed
component out to where it runs — a CRM plugin, a web resource, an Azure
WebJob, and whatever else a given client's stack is built from. That gap
is manual today, client by client, with no record of it.

## What changes

- A configurable **component registry**, per client: each component
  (plugin, web resource, CRM Plugin Registration entry, Azure WebJob,
  and open-ended "whatever else is needed") gets a type and a deploy
  method.
- A configurable **environment registry**, per client: at minimum the
  three standard environments (exact names/count are client-specific —
  don't hardcode "dev/test/prod" as the only shape), each with its own
  connection/target details per component type.
- Each component × environment pair is configured once (where it goes,
  how to push it there), then reusable for every future deploy of that
  component.
- **Versioning is general-purpose, not CRM-specific** — the mechanism
  for "here is version N of component X, deploy it to environment Y"
  has to work for a WebJob or a web resource exactly as well as for a
  CRM solution, not assume CRM's own versioning model.
- The deploy action itself becomes something DCC can trigger and record
  — who deployed what, to which environment, when, and (ideally) from
  which task/commit.

## Explicitly out of scope (for this proposal — to be resolved during design)

- Which specific deploy mechanisms to support first (CRM Plugin
  Registration API, Azure WebJob deploy via zip/Kudu/CLI, web resource
  upload via the CRM Web API, etc.) — needs a survey of what the pilot
  client's stack actually requires before committing to specific
  integrations.
- Automatic deploy-on-approve or deploy-on-merge. This starts as an
  explicit, reviewed action — same "no silent actions" principle as
  everything else in DCC.

## Open questions for design

- Does a "version" here map to a DCC task, a commit, a manual upload,
  or all three depending on component type?
- Does environment configuration live per-client only, or can a
  component's environment list vary per requirement/project inside a
  client?
