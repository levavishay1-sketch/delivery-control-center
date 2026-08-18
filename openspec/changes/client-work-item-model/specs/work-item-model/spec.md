## ADDED Requirements

### Requirement: A Work Item is creatable directly for a Client, with only Type and Title mandatory

The system SHALL provide a dedicated Work Item creation screen (not embedded inline in the Client
page) that creates a `WorkItem` directly — there is no separate intake object and no
Requirement→WorkItem conversion step. Only `type` and `title` SHALL be required; `source`, a
parent Work Item, Characterization (description text and/or attachments), and Related
Repositories SHALL all be optional. When no parent is selected, the system SHALL resolve a Project
for the new Work Item by creating one for the Client (reusing the same Project-key-generation and
creation logic used elsewhere for a Project-less intake), so `WorkItem.projectId` remains always
set. When a parent is selected, the new Work Item SHALL be created under that parent's existing
Project.

#### Scenario: Creating a Work Item with only Type and Title
- **WHEN** a write-capable user submits the Work Item creation form with only a `type` and `title`
- **THEN** a `WorkItem` is created with no parent, a Project is created to hold it, and it appears
  in the Client's WORK ITEMS top-level list

#### Scenario: Creating a Work Item under an existing parent
- **WHEN** a write-capable user submits the form with a `type`, `title`, and an existing Work Item
  selected as parent
- **THEN** the new Work Item is created with `parentId` set to the selected parent, under that
  parent's Project, and does not appear in the Client's top-level WORK ITEMS list

#### Scenario: Any Work Item type may be selected as parent regardless of the child's type
- **WHEN** a write-capable user selects a parent Work Item whose type differs from the new Work
  Item's own type
- **THEN** the Work Item is created successfully with that parent, since hierarchy is unrestricted
  by type

### Requirement: A Work Item's Source identifies its origin, independent of any Connection

The system SHALL allow `source` to be set on Work Item creation from the existing
`IntegrationType` value set (`MANUAL`, `JIRA`, `AZURE_DEVOPS`, `GITHUB`, and the other named
values), defaulting to `MANUAL` when omitted. The system SHALL NOT require or offer selection of a
`Connection` on the Work Item creation screen — Source and Connection are distinct concepts.

#### Scenario: Creating a Work Item with an explicit Source
- **WHEN** a write-capable user selects `AZURE_DEVOPS` as the Source while creating a Work Item
- **THEN** the Work Item is created with `source: AZURE_DEVOPS`

#### Scenario: Omitting Source defaults to Manual
- **WHEN** a write-capable user creates a Work Item without selecting a Source
- **THEN** the Work Item is created with `source: MANUAL`

### Requirement: A Work Item's Characterization holds optional descriptive text and file attachments

The system SHALL allow a Work Item's descriptive text (its existing `description` field) and zero
or more file attachments to be provided at creation or added later, never required for creation or
for any status transition.

#### Scenario: A Work Item created with no Characterization
- **WHEN** a Work Item is created with only Type and Title
- **THEN** it has no description and no attachments, and remains fully usable

#### Scenario: Adding an attachment after creation
- **WHEN** a write-capable user uploads a file to an existing Work Item
- **THEN** the file is stored and listed among that Work Item's attachments

### Requirement: A Work Item may be associated with Repositories belonging to the same Client only

The system SHALL allow a Work Item to be associated with zero, one, or multiple Repositories, and
SHALL reject an association with a Repository that does not belong to the same Client as the Work
Item's Project — enforced in the domain layer regardless of what the UI offers.

#### Scenario: Associating a same-client Repository succeeds
- **WHEN** a write-capable user associates a Work Item with a Repository owned by the same Client
- **THEN** the association is created

#### Scenario: Associating a different client's Repository is rejected
- **WHEN** a write-capable user attempts to associate a Work Item with a Repository owned by a
  different Client
- **THEN** the request is rejected with a validation error, regardless of whether the UI exposed
  that Repository as an option

#### Scenario: Deleting a Repository removes the association, not the Work Item
- **WHEN** a Repository associated with a Work Item is deleted
- **THEN** the association is removed and the Work Item itself is unaffected
