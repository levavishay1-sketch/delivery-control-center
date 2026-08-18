# Source: Client area product model (discovery request)

Verbatim user message, 2026-08-18. This is a discovery/product-model clarification request —
explicitly NOT an implementation request. No code, schema, routes, or OpenSpec changes were to be
created in response; only a findings report categorizing the existing system against this desired
model (EXISTS / PLANNED / MISSING / AMBIGUOUS).

---

I want you to understand and persist the following product model for the CLIENT area.

This is a discovery and product-model clarification task first.

DO NOT implement anything yet.

Before making any code changes, inspect the existing repository, architecture, OpenSpec specifications, roadmap, routes, components, database schema, domain layer, and navigation.

The repository and its persisted specifications are the source of truth.
Do not rely on assumptions from previous conversations.

==================================================
# CLIENT AREA
==================================================

The CLIENT area is accessed from the **CLIENTS** item in the main Navbar.

There is only ONE Client concept in the system.

When a user enters a Client, the Client area should conceptually contain exactly three sections:

1. WORK ITEMS
2. REPOSITORIES
3. CONNECTIONS

There is NO separate "Requirements" section.

There is also an **ADD REQUIRED** action/button on the Client screen.

IMPORTANT:

**REQUIRED is NOT a fourth section under Client.**

The conceptual structure is:

CLIENT
│
├── [ ADD REQUIRED ]
│
├── WORK ITEMS
│
├── REPOSITORIES
│
└── CONNECTIONS


==================================================
# 1. WORK ITEMS
==================================================

The WORK ITEMS section contains the work belonging to the Client.

Work Items may represent different kinds of work, for example:

- Project
- Specification
- Task
- Bug
- Change
- Any other supported work type

The exact supported types should NOT be invented yet.
Inspect the existing specifications and implementation first.

--------------------------------------------------
## Work Item hierarchy
--------------------------------------------------

The WORK ITEMS section should display only **top-level Work Items**.

A Work Item is top-level when it has no parent above it.

For example:

Client
│
├── Project A
│   ├── Task A1
│   ├── Task A2
│   └── Bug A1
│
├── Bug B
│   └── Task B1
│
└── Task C

The WORK ITEMS section should display:

Project A
Bug B
Task C

It should NOT display:

Task A1
Task A2
Bug A1
Task B1

because those items are children of another Work Item.

The rule is based on hierarchy, not on Work Item type.

Therefore:

- A top-level Project is displayed.
- A top-level Task is displayed.
- A top-level Bug is displayed.
- A top-level Change is displayed.
- Any other top-level Work Item is displayed.

When the user clicks a Work Item, they should navigate to the detailed screen for that Work Item.


==================================================
# 2. REPOSITORIES
==================================================

The REPOSITORIES section contains the Repositories associated with the Client.

A Repository is a separate concept from a Work Item.

For example:

REPOSITORIES

- delivery-control-center
- frontend
- backend

When the user clicks a Repository, they should navigate to the detailed Repository screen.

The Repository section represents the repositories associated with the Client.

Do NOT create a separate Project mechanism for Repositories.


==================================================
# 3. CONNECTIONS
==================================================

The CONNECTIONS section contains the Connections associated with the Client.

A Connection represents a connection/integration to an external system, tool, or execution mechanism.

Examples may include:

- MCP
- CLI
- GitHub
- Jira
- Azure DevOps
- Other supported integrations

The exact Connection types are NOT being defined yet.

Inspect the existing architecture and specifications before proposing the final model.

A Connection is a separate concept from:

- Work Items
- Projects
- Repositories

When the user clicks a Connection, they should navigate to the detailed Connection screen.


==================================================
# ADD REQUIRED
==================================================

There is an **ADD REQUIRED** button/action on the Client screen.

REQUIRED is NOT a fourth Client section.

There should NOT be:

CLIENT

- WORK ITEMS
- REQUIREMENTS
- REPOSITORIES
- CONNECTIONS

Instead, the Client should conceptually look like:

CLIENT

[ ADD REQUIRED ]

WORK ITEMS
...

REPOSITORIES
...

CONNECTIONS
...


==================================================
# WHAT IS REQUIRED?
==================================================

A REQUIRED represents a **new incoming request for a Client**.

It is an intake mechanism for introducing new work into the system.

A REQUIRED can represent any kind of request, including:

- Project
- Specification
- Task
- Bug
- Change
- Any other supported type

For example:

"We need Google Login"

This initially enters the system as a REQUIRED.

The minimum information required to create a REQUIRED is:

- Type
- Title

Additional information can optionally be provided:

- Description
- Specification
- Specification file
- Related Repositories

The user does NOT have to provide all of this information immediately.


==================================================
# REQUIRED CREATION FLOW
==================================================

When the user clicks:

**ADD REQUIRED**

they should be taken to a dedicated Requirement/REQUIRED creation screen.

The form should NOT be embedded directly inside the Client page.

The initial creation flow should require:

Type
Title

Additional fields may be optional.

After saving, the REQUIRED becomes part of the Client's work structure as a Work Item.

It should then appear in the Client's WORK ITEMS section if it is a top-level Work Item.

For example:

CLIENT

[ ADD REQUIRED ]

WORK ITEMS
├── New Website
├── Fix Login Bug
└── Add Google Login

REPOSITORIES
├── frontend
└── backend

CONNECTIONS
├── GitHub
└── MCP

There is NO separate Requirements list.


==================================================
# IMPORTANT: PROJECT MODEL
==================================================

There is only **ONE Project mechanism in the entire system**.

A Project belongs to a Client.

Conceptually:

Client
└── Projects
    └── Work Items

The Dashboard does NOT have a separate Project mechanism.

The Dashboard is only a central, clickable place from which users can view and navigate to the SAME Projects that belong to Clients.

Therefore:

Dashboard
    ↓
Projects
    ↓
same Project entities belonging to Clients

Do NOT create:

- A second Project entity
- A second Project hierarchy
- Dashboard-specific Projects
- A separate Client Project mechanism

There is ONE Project system only.


==================================================
# IMPORTANT CONCEPTUAL DISTINCTIONS
==================================================

Keep these concepts separate.

## Client

The customer/entity that owns the work, repositories and connections.

## Project

The single Project mechanism in the system.

A Project belongs to a Client.

## Work Item

A unit of work such as:

- Project
- Task
- Bug
- Change
- Specification
- etc.

Work Items can have a hierarchy.

## REQUIRED

An intake/request mechanism used to introduce new work for a Client.

REQUIRED is NOT a separate Client section.

## Repository

A code repository associated with a Client and potentially related to Work Items.

## Connection

An external system/tool/integration connection associated with a Client.


==================================================
# DESIRED CLIENT STRUCTURE
==================================================

The final conceptual structure is:

CLIENT
│
├── [ ADD REQUIRED ]
│
├── WORK ITEMS
│   └── Top-level Work Items only
│
├── REPOSITORIES
│   └── Client repositories
│
└── CONNECTIONS
    └── Client connections


==================================================
# DASHBOARD
==================================================

The Dashboard is a central navigation and overview area.

It may display Projects for convenience.

However, the Dashboard must NOT introduce another Project mechanism.

If the Dashboard displays Projects, those must be the exact same Project entities that belong to Clients.

The relationship is:

Client
└── Project

Dashboard
└── displays/links to those same Projects


==================================================
# DISCOVERY TASK
==================================================

Before implementing anything, inspect the current repository thoroughly.

Specifically inspect:

1. Main Navbar
2. CLIENTS navigation
3. Existing Client routes
4. Existing Client pages/components
5. Dashboard
6. Existing Project routes/pages/components
7. WorkItem schema and domain layer
8. Repository-related code
9. Connection/integration-related code
10. Prisma schema
11. API routes
12. OpenSpec specifications
13. OpenSpec archived changes
14. docs/ROADMAP.md
15. docs/roadmap-sources/
16. CLAUDE.md
17. Relevant tests


==================================================
# VERY IMPORTANT: CLIENT NAVIGATION
==================================================

I know there is already a **CLIENTS** tab in the main Navbar.

Do NOT assume that `/clients/[id]` is the correct Client detail route.

First determine:

1. Where the CLIENTS Navbar item is defined.
2. Which route it opens.
3. Which page/component renders that route.
4. How Clients are listed.
5. What happens when a user clicks an individual Client.
6. Whether a Client detail screen already exists under another route/path.
7. Whether there is an existing Client UI that should be extended instead of creating a new page.


==================================================
# SOURCE OF TRUTH
==================================================

Separate your findings into four categories.

## EXISTS

Things that are actually implemented today.

## PLANNED

Things defined in OpenSpec/Roadmap but not implemented yet.

## MISSING

Things that do not currently exist.

## AMBIGUOUS

Things where the existing implementation or specification is unclear and require a product decision.


==================================================
# DO NOT INVENT PRODUCT DECISIONS
==================================================

If something is missing or ambiguous, do NOT silently invent a solution.

Explicitly identify it as an open product decision.

For example, do not independently decide:

- WorkItem types
- WorkItem status model
- Repository data model
- Connection data model
- REQUIRED persistence model
- WorkItem hierarchy model
- Project/WorkItem relationships
- Specification storage
- Repository relationships

unless these are already defined in the repository's persisted specifications.


==================================================
# FINAL OUTPUT
==================================================

After completing the discovery, provide me with a clear architecture map.

For example:

Dashboard
│
└── Projects
    └── existing Project entities

Clients
│
└── Client
    ├── Work Items
    │   └── top-level Work Items
    ├── Repositories
    └── Connections

REQUIRED
│
└── intake mechanism
    └── creates/introduces new work


Then explain the actual routes, files, components, database models and domain functions behind each part.

Explicitly answer:

1. Where is the current CLIENTS Navbar item?
2. What route does it open?
3. How do I currently enter a specific Client?
4. Is there already a Client detail page?
5. What is the existing Project mechanism?
6. Is there exactly one Project mechanism?
7. How does the Dashboard access Projects?
8. What is the existing WorkItem mechanism?
9. Does WorkItem currently support hierarchy?
10. Does WorkItem currently have a type?
11. Does WorkItem currently have a proper status model?
12. What Repository functionality already exists?
13. What Connection functionality already exists?
14. What parts of REQUIRED can reuse existing functionality?
15. What parts of REQUIRED genuinely require new architecture?
16. Which parts of the desired Client structure already exist?
17. Which parts are missing?
18. Which decisions require my approval?


==================================================
# CRITICAL RULE
==================================================

This is a **DISCOVERY ONLY** task.

Do NOT:

- Create files
- Edit files
- Change the database
- Create routes
- Implement REQUIRED
- Implement ADD REQUIRED
- Implement Work Items
- Implement Repositories
- Implement Connections
- Modify the Dashboard
- Create OpenSpec changes yet

First understand the existing system and report your findings.

Only after I review the findings will we decide what the first implementation task should be.
