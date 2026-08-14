# domain-layer-boundary Specification

## Purpose
Keeps all database access and business rules behind a single domain layer,
so authorization and tenant scoping cannot be bypassed by a page or route
querying the database directly.

## Requirements

### Requirement: UI and routes do not access the database directly
The system SHALL confine all Prisma client imports to `src/domain/`. No
file under `src/app/` SHALL import the database client or the generated
Prisma client directly.

#### Scenario: A route imports Prisma directly
- **WHEN** a file under `src/app/` imports `@/lib/db` or `@/generated/prisma/client`
- **THEN** the build fails (enforced by lint), rather than the violation being merely a convention
