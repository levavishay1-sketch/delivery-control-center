# Source: REQUIRED concept, single-Project-mechanism rule, Client screen structure

Received verbatim from the user on 2026-08-18, in the same session that
first surfaced (and then discarded, per the 2026-08-18 exchange preserved
below) an earlier unpersisted "client-tasks-section" proposal built on a
"Requirements/Tasks/Repositories" panel that had no roadmap backing.

This document is the durable source of truth for that scope. Nothing here
should be re-derived from conversation summary — cite this file.

## Context: why this was raised

Investigation (this session, prior turn) established:

- The Dashboard "Projects" section (`src/app/page.tsx`) and the only
  `Project`/`WorkItem` model in the schema are the same entities — there is
  one `Client → Project → WorkItem` hierarchy in the codebase, no
  duplicate.
- No "Requirements" product concept exists anywhere in code — the only
  hits for "requirement" were OpenSpec's own `### Requirement:` scenario
  markup inside spec files, unrelated to a UI feature.
- No "Repository" or "Connection" entity exists anywhere in the schema,
  domain layer, or specs.
- The previously-claimed `client-tasks-section` OpenSpec change and its
  roadmap source file were never actually created on disk in a prior
  session, despite a session summary claiming they were — confirmed absent
  from `openspec/changes/` and `docs/roadmap-sources/` before this file.

Given that, the user redefined the scope from first principles rather than
continuing the discarded proposal. What follows is that redefinition,
verbatim.

## Verbatim request

I want to define a new product capability for creating and managing REQUIRED requests for a Client.

First, understand and persist the following product model:

### Project model

There is only ONE Project mechanism in the system.

A Project belongs to a Client:

```
Client
  └── Projects
       └── Work Items
```

There must NOT be separate Project mechanisms for the Dashboard and the Client.

#### Dashboard

The Dashboard is a central, clickable place where users can view and navigate to Projects.

When Projects are displayed on the Dashboard, they are the SAME Projects that belong to Clients.

The Dashboard is only another view/access point to the existing Project entities.

It must NOT create:

- A separate Project entity
- A separate Project hierarchy
- A separate Project data model
- A separate Project lifecycle

The relationship remains:

```
Client
  └── Project
       └── Work Items
```

The Dashboard simply provides a central way to access these Projects.

Do not create or assume a separate Project mechanism for the Dashboard.

---

### REQUIRED

I want to introduce a new concept called **REQUIRED**.

A REQUIRED represents a new request submitted for a Client.

A REQUIRED can represent any type of request, including:

- Specification
- Project
- Task
- Bug
- Change
- Or any other type of request

Do not assume that REQUIRED is the same entity as the existing Project or existing WorkItem.

First determine the appropriate product/data model for REQUIRED and how it should relate to Client, Project, and WorkItem.

---

### Client screen

When entering a Client, the Client page should contain the following sections:

#### TASKS

This section should contain the top-level Tasks, Projects, Bugs, Changes, and other relevant items associated with the Client.

Only top-level/parent items should appear.

The rule is:

- If a Project is a top-level item, it appears in TASKS.
- Tasks belonging to that Project do NOT also appear in TASKS.
- If a Task is a top-level item, it appears in TASKS.
- If a Task has a parent, it does NOT appear in TASKS.
- The same rule applies to Bugs, Changes, and any other type of item.
- In general, only items with no parent should appear in the main TASKS list.

When the user clicks an item, they should navigate to the detailed screen for that item.

---

#### REPOSITORIES

This section should display all Repositories associated with the Client.

When the user clicks a Repository, they should navigate to its detailed screen and see its details.

---

#### CONNECTIONS

This section should display all Connections associated with the Client.

A Connection can be an MCP, CLI, or any other type of connection.

When the user clicks a Connection, they should navigate to its detailed screen and see the Connection details.

---

### Requirements on the Client screen

There should NOT be a Requirements section on the Client page.

Instead, there should be an:

**ADD REQUIRED**

button on the Client screen.

When the user clicks **ADD REQUIRED**, the user should be taken to an appropriate interface for creating a new REQUIRED.

The Requirement form should NOT simply be embedded directly into the Client page.

Use UI/UX best practices to determine whether the appropriate experience is a dedicated page, modal, drawer, or another pattern.

Explain the reasoning before implementation.

---

### Creating a REQUIRED

A REQUIRED represents a new request for the selected Client.

The REQUIRED can represent:

- Project
- Specification
- Task
- Bug
- Change
- Or any other type of request

The minimum information required to create a REQUIRED is:

**Type**

**Title**

Everything else is optional at creation time.

#### Optional information

The user may optionally provide:

**Description**

A textual description of the REQUIRED.

**Specification**

The user may provide a specification as text or upload a specification file.

**Related Repositories**

The user may select Repositories related to the REQUIRED if they already know which Repositories are relevant.

This is NOT mandatory.

If the user does not know which Repositories are relevant yet, the REQUIRED can be created without any Repository association.

Repositories must be possible to associate with the REQUIRED later.

Therefore:

- Type is required.
- Title is required.
- Description is optional.
- Specification is optional.
- Specification file is optional.
- Repository association is optional.
- Missing information can be added later.

---

### REQUIRED creation flow

The minimum valid flow is:

```
Client
  ↓
ADD REQUIRED
  ↓
REQUIRED creation screen
  ↓
Type + Title
  ↓
Save
  ↓
REQUIRED belongs to the selected Client
  ↓
REQUIRED appears in the Client's TASKS section
```

For example:

Type: Bug

Title: Login button does not work

This should be valid without requiring:

- Description
- Specification
- Specification file
- Repository

These can all be added later.

---

### TASKS and REQUIRED relationship

REQUIRED requests created for a Client should ultimately be represented in the Client's TASKS section according to the hierarchy rules.

Only top-level items should appear in the main TASKS list.

If a REQUIRED has child items, those child items should not also appear separately in the top-level TASKS list.

Example:

```
Client
  └── REQUIRED: Build new authentication
       ├── Task: Implement login
       ├── Task: Implement registration
       └── Bug: Fix password reset
```

The TASKS section should display:

Build new authentication

It should NOT separately display:

- Implement login
- Implement registration
- Fix password reset

When the user clicks the top-level item, they should navigate to its detailed screen.

---

### Important architectural rule

There is only ONE Project mechanism in the entire system.

The Dashboard and Client screens must use the same Project entities.

The Dashboard is a central navigation/view layer.

The Client is the owner/context of the Project.

Do not create duplicate Project concepts.

---

### Important implementation rules

Do not silently invent product decisions.

Do not assume that REQUIRED is the same as the existing Project or WorkItem.

Do not assume that the current WorkItem model is sufficient.

First inspect the existing architecture, schema, components, queries, routes, and OpenSpec specifications.

Determine:

- What can be reused.
- What needs to be introduced.
- How REQUIRED should relate to Client.
- How REQUIRED should relate to Project.
- How REQUIRED should relate to WorkItem.
- How hierarchy should work.
- How the existing Dashboard Project view should use the same Project mechanism.

If the existing architecture cannot support these requirements correctly, do not create an approximation.

Instead, identify the required architectural/data-model changes and present them as open decisions.

---

### Before implementation

Create or update the appropriate OpenSpec proposal for this capability.

Before writing any code, show:

1. The proposed product model.
2. The relationship between Client, Project, REQUIRED, and WorkItem.
3. The relationship between Dashboard and Project.
4. The hierarchy model for REQUIRED and child items.
5. The proposed Client page structure.
6. The proposed Dashboard behavior regarding Projects.
7. The proposed REQUIRED creation UX and why it follows best practices.
8. The minimum and optional REQUIRED fields.
9. Which existing components/models can be reused.
10. Which new components/models are required.
11. All open product decisions that require approval.
12. The complete implementation scope.
13. The step-by-step implementation plan.

Do not implement anything yet. Wait for approval before starting
implementation.
