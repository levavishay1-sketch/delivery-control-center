# event-log

## ADDED Requirements

### Requirement: Append-only event storage

The system SHALL store every event as an immutable row in `event_log`.
Rows SHALL NOT be updated or deleted. A correction SHALL be a new row
whose `supersedes` references the row it replaces.

#### Scenario: UPDATE is rejected

- **WHEN** any process attempts `UPDATE event_log`
- **THEN** the database raises an error and no row changes

#### Scenario: DELETE is rejected

- **WHEN** any process attempts `DELETE FROM event_log`
- **THEN** the database raises an error and no row is removed

#### Scenario: correction is a new row

- **WHEN** a recorded fact turns out wrong
- **THEN** a new event is appended with `supersedes` set to the original
  event's id, and both rows remain readable

### Requirement: Dual timestamps

Every event SHALL carry `occurred_at` (when the thing happened) and
`recorded_at` (when the system learned of it), both indexed.
`occurred_at` MAY be earlier than `recorded_at` and SHALL NOT exceed
`recorded_at` by more than 5 minutes of clock-skew grace.

#### Scenario: back-dated phone call

- **WHEN** a phone call at 09:30 is logged at 14:00
- **THEN** the event has `occurred_at = 09:30` and `recorded_at = 14:00`
  and appears in the timeline in its 09:30 position

### Requirement: Unassigned events

An event MAY have a null `workitem_id`. Such events SHALL be listed in an
"unassigned" view ordered by `recorded_at` and SHALL NOT appear in any
WorkItem timeline until assigned.

#### Scenario: message with no confident match

- **WHEN** an incoming message cannot be matched to a WorkItem with
  sufficient confidence
- **THEN** it is stored with `workitem_id = null` and appears only in the
  unassigned view

### Requirement: Payload validation by type

The system SHALL validate every event payload against a schema selected
by `type` and `schema_version` before insertion. An event whose `type`
has no registered schema SHALL be rejected.

#### Scenario: unknown type rejected

- **WHEN** `appendEvent` is called with a `type` absent from the payload
  registry
- **THEN** the call throws and nothing is written

#### Scenario: malformed payload rejected

- **WHEN** `appendEvent` is called with a payload that fails its type's
  schema
- **THEN** the call throws with the validation error and nothing is
  written

### Requirement: Single write path

All event writes SHALL go through `appendEvent()`. No other code path
SHALL INSERT into `event_log`.

### Requirement: Tenant isolation on events

`event_log` SHALL enforce Row-Level Security keyed on the
`app.current_client` session variable. A connection without that
variable set, or set to another client, SHALL neither read nor write a
client's events.

#### Scenario: cross-tenant read blocked

- **WHEN** a query runs under `withTenant(clientA)` against events owned
  by `clientB`
- **THEN** zero rows are returned
