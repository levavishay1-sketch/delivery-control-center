## Purpose

Gives a client a direct way to register a Repository by its Source and Link, alongside the
existing GitHub-Connector-driven evidence-linking path (`engineering-evidence`'s "A project can
link a GitHub repository as a source of evidence," unchanged) — both paths produce and manage the
same client-owned `Repository` entity, not two competing ones.

## ADDED Requirements

### Requirement: A Repository is creatable directly for a Client with a Source and a Link

The system SHALL allow a write-capable user to create a `Repository` for a client directly, from a
dedicated creation screen, with `source` (a free-form, extensible value — e.g. GitHub, GitLab,
Azure DevOps, Bitbucket, or any other future source) and `url` (a link to the repository), both
required, with no Connector required.

#### Scenario: Creating a Repository with Source and Link
- **WHEN** a write-capable user submits the Repository creation form with a `source` and `url`
- **THEN** a `Repository` is created for that client and appears in its REPOSITORIES section

#### Scenario: A read-only user cannot create a Repository
- **WHEN** a user without write access to the client attempts to create a Repository
- **THEN** the request is refused

### Requirement: A Repository is viewable, editable, and deletable from its detail screen

The system SHALL show a Repository's Source and Link on its detail screen, allow a write-capable
user to edit and save both, and allow deletion after an explicit confirmation that names the
consequence: the Repository's associations to Work Items are removed, but the Work Items
themselves are not deleted.

#### Scenario: Editing a Repository's Link
- **WHEN** a write-capable user changes a Repository's Link and saves
- **THEN** the Repository's Link is updated

#### Scenario: Deleting a Repository preserves its associated Work Items
- **WHEN** a write-capable user confirms deletion of a Repository that is associated with one or
  more Work Items
- **THEN** the Repository and its associations to those Work Items are removed, and the Work Items
  themselves remain, unaffected
