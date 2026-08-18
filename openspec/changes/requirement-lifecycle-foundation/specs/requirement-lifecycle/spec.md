## Purpose

Gives a client a flexible, standalone-or-Project-linked intake point for new work — a
`Requirement` — that a human can later, explicitly, activate into a real SDD Pipeline, instead of
requiring a Project and WorkItem to exist before any work can be recorded.

## ADDED Requirements

### Requirement: A client-scoped Requirement can be created standalone or linked to a Project
The system SHALL allow a write-capable user to create a `Requirement` owned by a client, with a
type, title, and description, that is either standalone (no Project) or linked to one of that
client's existing Projects at creation time. The system SHALL NOT require a Requirement to belong
to a Project.

#### Scenario: Creating a standalone Requirement
- **WHEN** a write-capable user creates a Requirement for a client with no Project selected
- **THEN** the Requirement is created with no linked Project, in `OPEN` status

#### Scenario: Creating a Requirement linked to an existing Project
- **WHEN** a write-capable user creates a Requirement for a client and selects one of that
  client's existing Projects
- **THEN** the Requirement is created linked to that Project, in `OPEN` status

#### Scenario: A read-only user cannot create a Requirement
- **WHEN** a user without write access to the client attempts to create a Requirement
- **THEN** the request is refused

### Requirement: A Requirement's core fields can be edited before SDD activation
The system SHALL allow a write-capable user to update a Requirement's type, title, and description
while it is in `OPEN` status. The system SHALL refuse to edit a Requirement's type, title, or
description once it has reached `SDD_ACTIVE` status.

#### Scenario: Editing an open Requirement
- **WHEN** a write-capable user updates the title of a Requirement in `OPEN` status
- **THEN** the update is saved

#### Scenario: Editing an SDD-active Requirement is refused
- **WHEN** a write-capable user attempts to update the title of a Requirement in `SDD_ACTIVE`
  status
- **THEN** the request is refused

### Requirement: A Requirement can be declined
The system SHALL allow a write-capable user to move an `OPEN` Requirement to `DECLINED` status.
The system SHALL refuse to decline a Requirement already in `SDD_ACTIVE` status.

#### Scenario: Declining an open Requirement
- **WHEN** a write-capable user declines a Requirement in `OPEN` status
- **THEN** the Requirement moves to `DECLINED` status

#### Scenario: Declining an SDD-active Requirement is refused
- **WHEN** a write-capable user attempts to decline a Requirement already in `SDD_ACTIVE` status
- **THEN** the request is refused

### Requirement: A client's Requirements are listable and individually retrievable
The system SHALL allow a user with read access to a client to list that client's Requirements and
retrieve a single Requirement's detail, including its status and any linked Project.

#### Scenario: Listing a client's Requirements
- **WHEN** a user with read access to a client requests that client's Requirements
- **THEN** they receive every Requirement owned by that client, regardless of status

#### Scenario: Viewing a single Requirement's detail
- **WHEN** a user with read access to a client's Requirement opens its detail view
- **THEN** they see its type, title, description, status, and linked Project if any

### Requirement: A write-capable user can explicitly start SDD from an open Requirement
The system SHALL allow a write-capable user to explicitly activate SDD on a Requirement in `OPEN`
status. The system SHALL NOT start SDD automatically on Requirement creation or any other implicit
trigger. Activating SDD on a standalone Requirement SHALL create a new Project for it; activating
SDD on a Project-linked Requirement SHALL use that existing Project. In both cases the system SHALL
create a new root `WorkItem`, of the Requirement's type, under the resolved Project. On success the
system SHALL move the Requirement to `SDD_ACTIVE` status and record the created WorkItem as its
linked work item. Starting that WorkItem's Pipeline SHALL remain a separate action, subject to the
same Constitution-approval gate every other WorkItem's Pipeline start already requires — this
action is not required to, and does not, start the Pipeline itself.

#### Scenario: Starting SDD from a standalone Requirement
- **WHEN** a write-capable user starts SDD on a standalone Requirement in `OPEN` status
- **THEN** a new Project is created, a new root WorkItem of the Requirement's type is created
  under it, and the Requirement moves to `SDD_ACTIVE` status linked to that WorkItem

#### Scenario: Starting SDD from a Project-linked Requirement
- **WHEN** a write-capable user starts SDD on a Requirement in `OPEN` status that is already
  linked to an existing Project
- **THEN** a new root WorkItem of the Requirement's type is created under that existing Project,
  and the Requirement moves to `SDD_ACTIVE` status linked to that WorkItem

#### Scenario: Starting SDD twice on the same Requirement is refused
- **WHEN** a write-capable user attempts to start SDD on a Requirement already in `SDD_ACTIVE`
  status
- **THEN** the request is refused and no second Project or WorkItem is created

#### Scenario: Starting the created WorkItem's Pipeline is a separate, later action
- **WHEN** a write-capable user has just started SDD on a Requirement, and the resolved Project
  has no approved Constitution yet
- **THEN** the Requirement is still `SDD_ACTIVE` with its WorkItem created, and starting that
  WorkItem's Pipeline is available as the same explicit action used for any other WorkItem, once
  a Constitution has been drafted and approved for its Project

#### Scenario: A read-only user cannot start SDD
- **WHEN** a user without write access to the Requirement's client attempts to start SDD
- **THEN** the request is refused
