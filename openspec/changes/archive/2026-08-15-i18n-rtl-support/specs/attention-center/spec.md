## ADDED Requirements

### Requirement: The Attention Center renders fully in the active locale, in correct reading order
The system SHALL render every group heading, row reason, and required-
action text in the active locale, and SHALL lay out each row's status
indicator, label, and reason text in the order matching the active
locale's reading direction.

#### Scenario: Attention Center in Hebrew
- **WHEN** Hebrew is the active locale and a user views the Attention
  Center
- **THEN** every group heading and every row's reason/required-action
  text renders in Hebrew, and each row's status indicator appears at the
  reading-order start position for right-to-left
