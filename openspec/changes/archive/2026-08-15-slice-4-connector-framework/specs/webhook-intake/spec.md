## Purpose

Lets a push-capable connector notify this system of external changes
in near-real-time via webhook, instead of relying solely on manual or
polled sync, without ever double-applying a redelivered event.

## ADDED Requirements

### Requirement: A webhook delivery triggers a sync
The system SHALL accept an inbound webhook delivery for a project's
push-capable connector and trigger a `SyncRun` for the affected work
item(s) as a result.

#### Scenario: A webhook delivery arrives for a connected project
- **WHEN** a push-capable connector's external system sends a webhook delivery for a project with a matching connected connector
- **THEN** a `SyncRun` is triggered, scoped to the item(s) named in the delivery

### Requirement: Webhook intake is idempotent per delivery
The system SHALL deduplicate webhook deliveries by a stable per-delivery
identifier supplied by the sending system, and SHALL NOT apply the same
delivery's effects more than once.

#### Scenario: The same delivery is received twice
- **WHEN** a webhook delivery with a given delivery id is received, and a delivery with that same id was already processed
- **THEN** the second delivery is accepted (not an error) but produces no additional sync effects

#### Scenario: A genuinely new delivery is processed normally
- **WHEN** a webhook delivery with a delivery id not seen before arrives
- **THEN** it triggers a sync as normal

### Requirement: An unrecognized or unverified webhook is rejected
The system SHALL reject a webhook delivery that does not match a connected
connector, or that fails the sending system's signature/authenticity check
where the adapter supports one, without triggering any sync effect.

#### Scenario: A webhook for a project with no matching connector
- **WHEN** a webhook delivery arrives that does not correspond to any project's connected connector
- **THEN** it is rejected and no sync is triggered

#### Scenario: A webhook that fails signature verification
- **WHEN** a webhook delivery's signature does not match what the adapter expects for its configured secret
- **THEN** it is rejected and no sync is triggered
