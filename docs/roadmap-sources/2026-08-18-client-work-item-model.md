# Source: Client Work Item / Repository / Connection model (implementation request)

Verbatim user message, 2026-08-18. This supersedes the discovery-only framing of
`2026-08-18-client-area-product-model.md` with an explicit, fully-decided implementation
specification — the user states the product decisions directly and instructs against asking
further clarifying questions. It also explicitly retires the "REQUIRED" terminology used in the
prior discovery request in favor of "WORK ITEM" (Requirement is to be reconciled into WorkItem,
not kept as a parallel concept).

---

I want you to implement the Client experience exactly as specified below.

IMPORTANT:
- Do NOT invent product decisions.
- Do NOT reinterpret existing concepts.
- Do NOT create duplicate entities or parallel mechanisms.
- Before changing code, inspect the existing project architecture, schema, domain layer, routes, specs, and existing Client implementation.
- Reuse existing mechanisms where they already match this specification.
- Do not create a second implementation of something that already exists.
- If an existing implementation conflicts with this specification, adapt it to this specification rather than creating a parallel mechanism.
- The goal is to make the existing product model consistent, not to create duplicate concepts.

==================================================
1. CORE PRODUCT MODEL
==================================================

There is exactly ONE Client mechanism in the system.

There is exactly ONE Project mechanism in the system.

The relationship is:

Client
  └── Projects
       └── Work Items

The Dashboard does NOT have its own Project mechanism.

The Dashboard is only a central, clickable place where users can see and navigate to the same Projects that belong to Clients.

Do NOT create:
- another Project entity
- another Project hierarchy
- another Project mechanism for the Dashboard

All Project references throughout the system must ultimately refer to the same Project entity.

==================================================
2. CLIENT PAGE
==================================================

The Client page is the main place for managing and navigating everything belonging to a Client.

The Client page must contain the following structure:

--------------------------------------------------
CLIENT HEADER
--------------------------------------------------

At the top of the page display:

- Client Name
- Client Identifier

The Client identifier should be the existing identifier used by the system for that Client.

Do not invent another identifier.

--------------------------------------------------
WORK ITEMS
--------------------------------------------------

This is the first main section.

Title:

WORK ITEMS

There must be an:

ADD WORK ITEM

button.

The section displays the Client's Work Items.

IMPORTANT HIERARCHY RULE:

Only Top-Level Work Items are displayed in the main WORK ITEMS list.

A Work Item is Top-Level when it has no Parent.

In other words:

parentId = null

Children must NOT also appear in the main Client WORK ITEMS list.

Example:

Project A
  ├── Task A
  ├── Bug A
  └── Change A

The WORK ITEMS section displays:

Project A

It does NOT separately display:

Task A
Bug A
Change A

because they are children.

The same rule applies to every Work Item type.

For example:

Task A
  └── Bug B
       └── Change C

The Client WORK ITEMS section displays only:

Task A

Bug B and Change C are not displayed in the Client's top-level list.

==================================================
3. WORK ITEM TYPES
==================================================

Currently there are exactly four Work Item types:

- PROJECT
- TASK
- BUG
- CHANGE

Do not add additional Work Item types at this stage.

The hierarchy is completely unrestricted by type.

Any Work Item type may be the parent of any other Work Item type.

Examples that are valid:

PROJECT
  └── TASK
       └── BUG
            └── CHANGE

TASK
  └── PROJECT

BUG
  └── CHANGE

There is NO type-based hierarchy restriction at this stage.

The only hierarchy rule is Parent → Child.

==================================================
4. WORK ITEM STATUS
==================================================

The Client WORK ITEMS section currently shows ALL Top-Level Work Items.

This includes:

- active Work Items
- completed Work Items
- closed Work Items
- any other existing Work Item status

There is NO status filter at this stage.

There is also NO Type filter at this stage.

Do not add filtering UI.

Filtering can be introduced in a future change.

==================================================
5. ADD WORK ITEM
==================================================

The Client page must have:

ADD WORK ITEM

When clicked, open a dedicated Work Item creation screen.

Do NOT display the creation form inline inside the Client page.

Do NOT use the old "Requirement" terminology.

The product terminology is now:

WORK ITEM

not:

REQUIREMENT

Therefore:

Requirement → Work Item
Add Requirement → ADD WORK ITEM
Requirement Detail → Work Item Detail
Requirements → WORK ITEMS

Do not create a separate Requirement entity.

The existing Requirement concept, if present in the codebase, must be reconciled with the Work Item model rather than creating two parallel concepts.

==================================================
6. WORK ITEM CREATION FORM
==================================================

The Work Item creation form has only two mandatory fields:

- Type
- Title

Everything else is optional.

Required:

Type *
Title *

Optional:

Source
Parent
Characterization
Attachments
Related Repositories

A Work Item must be creatable using ONLY:

Type + Title

Nothing else should be required.

--------------------------------------------------
TYPE
--------------------------------------------------

The Type field currently supports exactly:

- PROJECT
- TASK
- BUG
- CHANGE

--------------------------------------------------
SOURCE
--------------------------------------------------

Source is OPTIONAL.

The user may leave Source empty.

Source identifies where the Work Item came from.

Examples:

- Manual
- Azure DevOps
- Jira
- GitHub
- another future source

Source must be designed as extensible.

Do NOT hard-code the product architecture around only today's sources.

IMPORTANT:

The user selects a SOURCE.

The user NEVER selects a CONNECTION when creating a Work Item.

--------------------------------------------------
PARENT
--------------------------------------------------

Parent is OPTIONAL.

The user may create a Work Item without a Parent.

If no Parent is selected:

parentId = null

The Work Item is Top-Level.

If a Parent is selected:

the new Work Item becomes a Child of that Parent.

Any Work Item can be selected as Parent regardless of Type.

--------------------------------------------------
CHARACTERIZATION
--------------------------------------------------

There is NO separate "Specification" concept.

Do NOT create a Specification field/model/concept.

The correct concept is:

CHARACTERIZATION

Characterization describes the Work Item.

Characterization is OPTIONAL.

It can contain:

1. Text / description
2. Attached files/documents

Therefore a Work Item can contain:

Characterization
  ├── Text
  └── Attachments

Characterization is not required during creation.

A Work Item may be created with only:

Type + Title

and Characterization can be completed later.

--------------------------------------------------
RELATED REPOSITORIES
--------------------------------------------------

A Work Item may be associated with multiple Repositories.

The user can select:

- zero repositories
- one repository
- multiple repositories

IMPORTANT:

Only Repositories belonging to the SAME Client may be selected.

A Work Item belonging to Client A must never be able to select a Repository belonging to Client B.

This must be enforced in the backend/domain layer, not only hidden in the UI.

==================================================
7. WORK ITEM SAVE
==================================================

When the user saves the Work Item:

The Work Item is created as a Work Item.

There is no:

Requirement → Work Item conversion step.

There is no separate Requirement object.

The object itself is the Work Item.

If it has no Parent, it immediately appears in the Client's WORK ITEMS top-level list.

If it has a Parent, it does not appear in the Client's top-level list.

==================================================
8. WORK ITEM DETAIL
==================================================

Clicking a Work Item in the Client WORK ITEMS section opens the Work Item's dedicated detail screen.

The Work Item detail screen should be the canonical place for viewing and managing that Work Item.

Do not create a separate Requirement detail concept.

==================================================
9. REPOSITORIES
==================================================

The second main Client section is:

REPOSITORIES

It displays all Repositories belonging to the current Client.

There must be:

ADD REPOSITORY

button.

Do not create a Repository mechanism separate from the existing Repository model if one already exists.

Reuse the existing Repository entity and functionality where appropriate.

--------------------------------------------------
ADD REPOSITORY
--------------------------------------------------

Clicking ADD REPOSITORY opens a dedicated Repository creation screen.

Do NOT place the creation form inline inside the Client page.

At this stage the Repository creation form has exactly two required fields:

Source *
Link *

Example:

Source:
GitHub

Link:
https://github.com/company/repository

Both are required.

--------------------------------------------------
REPOSITORY SOURCE
--------------------------------------------------

Repository Source is extensible.

Examples may include:

- GitHub
- GitLab
- Azure DevOps
- Bitbucket
- future sources

Do not design the model as a permanently closed list of today's providers.

--------------------------------------------------
REPOSITORY DETAIL
--------------------------------------------------

Clicking a Repository from the Client page opens a dedicated Repository Detail screen.

The detail screen displays the Repository information, including:

- Source
- Link

The Repository Detail screen is EDITABLE.

The user can:

- view
- edit
- save

Source and Link.

There must also be:

DELETE REPOSITORY

Deleting a Repository must require a confirmation.

If the Repository is linked to Work Items:

- the Repository is deleted
- its associations to Work Items are deleted
- the Work Items themselves are NOT deleted

The confirmation should clearly warn the user that the Repository associations will be removed but the Work Items will remain.

==================================================
10. CONNECTIONS
==================================================

The third main Client section is:

CONNECTIONS

There must be:

ADD CONNECTION

button.

Connections are Client-level objects.

They represent technical connections to external sources/services.

Examples include:

- Azure DevOps
- Jira
- GitHub
- MCP
- CLI
- other future sources

IMPORTANT:

Connection is NOT selected on a Work Item.

The Work Item contains Source.

Connection is the technical connection that allows the system to communicate with an external source.

Conceptually:

Client
  ├── Connections
  │     └── Azure DevOps Connection
  │
  └── Work Items
        └── Source: Azure DevOps

The same Connection may be used for many Work Items.

A Connection does NOT belong to a specific Work Item.

--------------------------------------------------
CURRENT CONNECTION SCOPE
--------------------------------------------------

For this implementation keep Connections intentionally simple.

The current creation form has:

Source *
Name *

Both are required.

Do NOT implement complex connection configuration yet.

Do NOT add:
- credentials management
- authentication configuration
- sync configuration
- MCP configuration
- CLI configuration
- advanced connection settings

Those will be expanded in future work.

--------------------------------------------------
CONNECTION DETAIL
--------------------------------------------------

Clicking a Connection opens a dedicated Connection Detail screen.

The screen contains:

Source *
Name *

The Connection is editable.

The user can:

- view
- edit
- save
- delete

Deletion requires confirmation.

==================================================
11. SOURCE VS CONNECTION
==================================================

This distinction is critical.

Do NOT merge Source and Connection.

SOURCE:

Describes where a Work Item or Repository originates.

Example:

Work Item
Source = Azure DevOps

CONNECTION:

Represents the technical connection the Client has to an external system.

Example:

Client
Connection = Azure DevOps Production

The user chooses SOURCE when creating a Work Item.

The user NEVER chooses CONNECTION from the Work Item creation screen.

In the future the system will use Connections to retrieve external data and Source information to map that external data into our internal Work Item model.

There will eventually be a mapping layer between external source structures and our internal Work Item structure.

That mapping is FUTURE scope.

Do not invent or implement that mapping now unless it already exists and is directly required by the current architecture.

==================================================
12. DASHBOARD
==================================================

The Dashboard is NOT another Project system.

There is only one Project entity/mechanism.

Projects belong to Clients.

The Dashboard is simply a central and clickable place to:

- see Projects
- navigate to Projects
- navigate to Clients / other relevant areas

If the Dashboard displays Projects, those are the SAME Projects that belong to Clients.

Do NOT create:

- Dashboard Projects
- Dashboard-specific Project records
- duplicate Project entities
- another Project hierarchy

The Client page and Dashboard must reference the same Project mechanism.

==================================================
13. CLIENT PAGE FINAL STRUCTURE
==================================================

The final Client page should conceptually look like:

CLIENT NAME
CLIENT IDENTIFIER

--------------------------------------------------

WORK ITEMS

[ ADD WORK ITEM ]

Top-Level Work Item
Top-Level Work Item
Top-Level Work Item
...

Only Work Items without a Parent are displayed.

No filters for now.

--------------------------------------------------

REPOSITORIES

[ ADD REPOSITORY ]

Repository
Repository
Repository
...

--------------------------------------------------

CONNECTIONS

[ ADD CONNECTION ]

Connection
Connection
Connection
...

==================================================
14. NAVIGATION
==================================================

The existing Client navigation in the Navbar remains the entry point to Clients.

Navbar:

CLIENTS

→ Client list

→ specific Client

The Client detail page contains the three sections:

WORK ITEMS
REPOSITORIES
CONNECTIONS

Each item is clickable and opens its dedicated detail screen.

Each ADD button opens a dedicated creation screen.

Do not embed the creation forms directly inside the Client page.

==================================================
15. IMPORTANT EXISTING SYSTEM RECONCILIATION
==================================================

Before implementation, inspect the existing code carefully.

Some of these concepts may already exist under different names or structures.

In particular:

- WorkItem
- Requirement
- Repository
- Connector / Connection
- Project
- Client

Do NOT blindly create duplicate models.

Where an existing model already represents the desired concept, extend/refactor/reuse it.

The final product should have ONE canonical concept for each of:

- Client
- Project
- Work Item
- Repository
- Connection

There must NOT be:

Requirement + WorkItem as two parallel product concepts.

There must NOT be:

Connector + Connection as two competing Client-level connection concepts unless the existing Connector is technically required internally. If an existing Connector is an implementation detail of the integration system, reconcile it appropriately rather than exposing two confusing product concepts.

==================================================
16. IMPLEMENTATION PROCESS
==================================================

Do NOT immediately start coding.

First:

1. Inspect the repository.
2. Inspect the current Prisma schema.
3. Inspect existing Client pages.
4. Inspect existing WorkItem implementation.
5. Inspect existing Requirement implementation.
6. Inspect Repository implementation.
7. Inspect Connector/Connection implementation.
8. Inspect Dashboard Project implementation.
9. Inspect relevant OpenSpec specs and archived changes.
10. Determine which existing code already satisfies this specification.

Then create/update the appropriate OpenSpec change.

Before implementation, provide me with:

1. Current architecture findings.
2. Existing entities that can be reused.
3. Changes required to reconcile the current system with this specification.
4. Exact database/model changes.
5. Exact routes/pages that will be created or changed.
6. Exact UI changes.
7. Any genuine conflicts with existing specifications.

Do NOT ask me questions about decisions that are already explicitly answered in this prompt.

Do NOT invent new product decisions.

If there is a conflict between existing code/spec and this specification, clearly identify it and explain the conflict before implementation.
