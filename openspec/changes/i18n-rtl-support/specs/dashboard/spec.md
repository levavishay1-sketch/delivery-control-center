## ADDED Requirements

### Requirement: The dashboard renders fully in the active locale
The system SHALL render the attention-summary labels, the project
quick-access list, and the recent-activity feed (including every audit
event's description and timestamp) in the active locale, and SHALL
format the recent-activity timestamps per that locale's date/time
conventions.

#### Scenario: Dashboard summary in Hebrew
- **WHEN** Hebrew is the active locale and a user views the dashboard
- **THEN** the attention-summary labels (e.g. blocker and decision
  counts) and the recent-activity feed's text and timestamps render in
  Hebrew
