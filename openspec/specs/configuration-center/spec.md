# configuration-center Specification

## Purpose

Lets a write-capable role see and change a configurable value's effective
setting at any scope in the Organization → Client → Project hierarchy —
where that value actually comes from, what changing it will affect before
it's saved, and a durable history of who changed it and when — rather
than a value silently overwritten with no visibility into inheritance or
blast radius.

## Requirements

### Requirement: A scope's effective value shows its source
The system SHALL show, for a configurable value at a given scope, its
effective value, which scope that value is actually set at (this scope,
or the nearest ancestor with its own value), and whether this scope has
its own override or is inheriting.

#### Scenario: Viewing an inherited value
- **WHEN** a user views a project's AI budget and the project has no override of its own
- **THEN** they see the effective value inherited from the client (or organization), labeled as inherited and naming the scope it comes from

#### Scenario: Viewing an overridden value
- **WHEN** a user views a scope that has its own override set
- **THEN** they see that value labeled as this scope's own override, not inherited

### Requirement: Changing a value at Organization or Client scope previews its impact before saving
The system SHALL show, before saving a change to a value at the
Organization or Client scope, how many descendant clients and/or projects
have no override of their own and would see their effective value change
as a result, and SHALL require explicit confirmation before applying it.

#### Scenario: Previewing an Organization-level change
- **WHEN** an org admin is about to change the Organization's AI budget
- **THEN** they see a count of clients and projects with no override that would be affected, before confirming

#### Scenario: Previewing a Client-level change
- **WHEN** a write-capable user is about to change a Client's AI budget
- **THEN** they see a count of that client's projects with no override that would be affected, before confirming

#### Scenario: A Project-level change needs no impact preview
- **WHEN** a write-capable user changes a Project's own AI budget
- **THEN** the change saves directly, since a project has no descendant scope for it to affect

### Requirement: A scope's override can be explicitly reset to inherited
The system SHALL let a write-capable role clear a scope's own override
through an explicit "reset to inherited" action, distinct from saving an
empty value, after which that scope shows the effective value it now
inherits from its nearest ancestor.

#### Scenario: Resetting a Project's override
- **WHEN** a write-capable user resets a project's AI budget to inherited
- **THEN** the project's own override is cleared and it now shows the client's (or organization's) effective value

### Requirement: Every value change is recorded in a durable, queryable history
The system SHALL record a version-history entry for every configured
value set or cleared at any scope, capturing the scope, the old and new
value, who made the change, and when.

#### Scenario: A budget change appears in the scope's history
- **WHEN** a user changes a scope's AI budget
- **THEN** a history entry records the scope, the old value, the new value, who made the change, and when

#### Scenario: Viewing a scope's change history
- **WHEN** a write-capable user views a scope's configuration
- **THEN** they can see every past change to its value, most recent first
