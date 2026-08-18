## MODIFIED Requirements

### Requirement: Status is always shown with color, icon, and a stated reason
The system SHALL present any attention-relevant status (blocked,
decision-required, at-risk, overdue) using a fixed combination of color,
icon, and a short textual label, and SHALL require an accompanying
human-readable reason wherever that status is shown in a list, card, or
detail view — never color alone, and never an unexplained status. The
icon/label/reason order SHALL follow the active locale's reading
direction rather than a fixed left-to-right order.

#### Scenario: A blocked work item in a list
- **WHEN** a work item with an active blocker appears in the Attention
  Center feed or the Dashboard
- **THEN** its row shows a status indicator with color and icon, plus the
  blocker's reason inline, not just a colored badge

#### Scenario: Status without a reason is rejected
- **WHEN** a screen attempts to render a status indicator with no
  accompanying reason text
- **THEN** the shared status component does not render a bare status —
  every use of it requires a reason value

#### Scenario: A status badge under RTL
- **WHEN** Hebrew is the active locale and a status indicator renders
- **THEN** its icon, label, and reason are laid out in right-to-left
  reading order, using the same component as the English/LTR rendering —
  not a separate locale-specific variant

## ADDED Requirements

### Requirement: Shared components mirror structurally under RTL, with no locale-specific variant
The system SHALL render every shared design-system component (status
indicators, rows/row-lists, panels, the persistent navigation rail, the
floating-elevation drawer) so its structural layout — content order,
start/end spacing, start/end borders, and alignment — mirrors correctly
when the active locale's direction is right-to-left, using the same
component implementation as the left-to-right rendering rather than a
second, locale-specific version of the component.

#### Scenario: A Row's content order under RTL
- **WHEN** Hebrew is the active locale and an Attention Center row
  renders
- **THEN** the row's status indicator, label, and reason text appear in
  right-to-left reading order, produced by the same `Row` component used
  under English, not a separate implementation

#### Scenario: A Panel's borders and spacing mirror under RTL
- **WHEN** Hebrew is the active locale and an on-page panel with a
  start-edge accent border renders
- **THEN** the accent border renders on the right edge (the reading-order
  start under RTL), mirrored from the left edge it uses under English
