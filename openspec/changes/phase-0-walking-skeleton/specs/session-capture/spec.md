# session-capture

## ADDED Requirements

### Requirement: Session capture is a hook, not a skill

Claude Code session and git capture SHALL be implemented as hooks
configured in `settings.json`, never as skills. Capture MUST be
guaranteed, not contingent on the model choosing to invoke it.

### Requirement: Context Brief injection on session start

A `SessionStart` hook SHALL resolve the WorkItem for the current working
directory / branch, fetch its Context Brief, and print it to stdout so
it becomes the session's context.

#### Scenario: second task starts from the Brief

- **WHEN** a developer opens a new Claude Code session on a WorkItem that
  already has events
- **THEN** the session begins with the Brief in context and does not
  replay the full timeline

#### Scenario: no WorkItem resolved

- **WHEN** the working directory maps to no known WorkItem
- **THEN** the hook prints nothing and the session proceeds normally

### Requirement: Session summary on session end

A `SessionEnd` hook SHALL read `transcript_path`, produce a summary, and
POST a `claude.session` event to the API. The hook SHALL NOT attempt to
block session termination.

### Requirement: Git activity capture

A `PostToolUse` hook on git operations SHALL detect commits, pushes,
branch creation and pull requests and POST a `git.activity` event
linked to the WorkItem resolved from the branch name.

#### Scenario: branch-name convention resolves the WorkItem

- **WHEN** work happens on a branch named `feature/WI-1284-*`
- **THEN** the resulting git events are linked to WorkItem `WI-1284`

### Requirement: Actor is the acting developer

Events from these hooks SHALL record `actor` as
`{ kind: "user", userId, identityType: "interactive" }` for the
developer running the session — never a system or service identity.
