## Purpose

Lets a Project carry a default executor that new and unassigned WorkItems inherit, and lets a
project lead change that default and cascade it safely — automatically over WorkItems that never
had their own explicit executor, never silently over ones that did.

## ADDED Requirements

### Requirement: A Project has a default executor that unassigned WorkItems inherit
The system SHALL allow a Project to carry a default executor (`defaultExecutorType` and, when
`HUMAN`, a `defaultExecutorId`). A WorkItem created or left without its own explicit executor
SHALL inherit the Project's default executor, tracked with `assignmentSource=INHERITED`; a
WorkItem whose executor is set explicitly SHALL be tracked with `assignmentSource=EXPLICIT`.

#### Scenario: A new WorkItem with no explicit executor inherits the Project default
- **WHEN** a WorkItem is created in a Project that has a default executor set, without specifying
  its own executor
- **THEN** the WorkItem's executor is set to the Project's default and its `assignmentSource` is
  `INHERITED`

#### Scenario: A new WorkItem with an explicit executor is not overridden by the Project default
- **WHEN** a WorkItem is created in a Project that has a default executor set, with its own
  explicit executor specified
- **THEN** the WorkItem's executor is the one explicitly given and its `assignmentSource` is
  `EXPLICIT`

#### Scenario: A Project with no default executor leaves new WorkItems unassigned
- **WHEN** a WorkItem is created in a Project that has no default executor set, without specifying
  its own executor
- **THEN** the WorkItem's `executorType` is `UNASSIGNED`, matching today's behavior

### Requirement: Changing a Project's default executor never silently overwrites an explicit WorkItem executor
The system SHALL require a preview before applying a change to a Project's default executor,
showing every WorkItem the change would affect (those currently `INHERITED`) and every WorkItem it
would not affect (those currently `EXPLICIT`), and SHALL require the requester to choose one of two
explicit options with no option pre-selected: apply the new default only to the Project and its
`INHERITED`/unassigned WorkItems, or also reassign every `EXPLICIT` WorkItem to the new default.

#### Scenario: Previewing a default executor change
- **WHEN** a project lead proposes a new default executor for a Project that has WorkItems with
  both `INHERITED` and `EXPLICIT` assignment
- **THEN** the preview lists which WorkItems will change automatically (the `INHERITED` ones) and
  which will not unless explicitly included (the `EXPLICIT` ones), with no option pre-selected

#### Scenario: Confirming the cascade-only-inherited option
- **WHEN** a project lead confirms the "apply to Project and inherited/unassigned WorkItems only"
  option
- **THEN** the Project's default executor changes, every `INHERITED` or `UNASSIGNED` WorkItem in
  the project is reassigned to the new default and stays `INHERITED`, and every `EXPLICIT`
  WorkItem is untouched

#### Scenario: Confirming the reassign-everything option
- **WHEN** a project lead confirms the "also reassign explicit WorkItems" option
- **THEN** the Project's default executor changes and every WorkItem in the project — `INHERITED`,
  `UNASSIGNED`, and `EXPLICIT` alike — is reassigned to the new default; every reassigned
  `EXPLICIT` WorkItem's `assignmentSource` becomes `INHERITED`

#### Scenario: No default is pre-selected
- **WHEN** a project lead opens the preview for a default executor change
- **THEN** neither option is pre-selected — the requester must actively choose one before the
  change can be confirmed

### Requirement: Every assignment change is traceable
The system SHALL record an audit event for every change to a Project's default executor and for
every WorkItem executor reassignment that results from a cascade.

#### Scenario: Changing the Project default is audited
- **WHEN** a project lead changes a Project's default executor
- **THEN** an audit event records the change, including which cascade option was chosen

#### Scenario: A cascaded WorkItem reassignment is audited
- **WHEN** a WorkItem's executor changes as a result of a Project default-executor cascade
- **THEN** an audit event on that WorkItem records the old and new executor and that it resulted
  from a Project-level cascade, distinct from a direct manual edit
