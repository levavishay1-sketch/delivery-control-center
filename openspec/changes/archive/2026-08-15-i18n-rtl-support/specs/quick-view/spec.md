## ADDED Requirements

### Requirement: The drawer opens from the locale-appropriate edge and renders in the active locale
The system SHALL open the Quick View drawer from the trailing edge of the
active locale's reading direction (the right edge under English, the left
edge under Hebrew), and SHALL render every label, action button, and
panel inside it (blocker panel, decision panel, general detail, dates) in
the active locale.

#### Scenario: Drawer edge under Hebrew
- **WHEN** Hebrew is the active locale and a user opens the Quick View
  drawer
- **THEN** the drawer slides in from the left edge of the screen,
  mirrored from the right-edge position it uses under English

#### Scenario: Drawer content under Hebrew
- **WHEN** Hebrew is the active locale and the Quick View drawer is open
- **THEN** its blocker panel, decision panel, and field labels render in
  Hebrew
