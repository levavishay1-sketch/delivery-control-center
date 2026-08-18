## Purpose

Lets each pipeline stage's approval gate require a specific set of roles
to act on it, instead of any write-capable role being able to approve or
reject any stage regardless of type.

## ADDED Requirements

### Requirement: Each stage type names which roles may approve or reject its gate
The system SHALL determine, from configuration, which roles are permitted
to approve or reject a given stage type's gate, rather than applying one
uniform write-access check to every stage type.

#### Scenario: A configured role can approve its stage
- **WHEN** a user holding a role listed as permitted for a stage type attempts to approve that stage's gate
- **THEN** the approval succeeds

### Requirement: A user without a permitted role cannot act on that stage's gate
The system SHALL refuse an approval or rejection from a user whose role on
the client is not among the stage type's permitted roles, even if that
role would satisfy some other stage type's requirement.

#### Scenario: A role permitted for one stage type is refused on another
- **WHEN** a user holding a role permitted to approve the Plan stage attempts to approve a SPEC stage whose permitted roles do not include that role
- **THEN** the request is rejected
