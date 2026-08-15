## Purpose

Defines the shared visual and structural contract — color/type/spacing
tokens, elevation rules, and status-presentation rules — that every screen
in the product must use, so status, risk, and urgency read consistently
everywhere rather than each screen inventing its own treatment.

## ADDED Requirements

### Requirement: Status is always shown with color, icon, and a stated reason
The system SHALL present any attention-relevant status (blocked,
decision-required, at-risk, overdue) using a fixed combination of color,
icon, and a short textual label, and SHALL require an accompanying
human-readable reason wherever that status is shown in a list, card, or
detail view — never color alone, and never an unexplained status.

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

### Requirement: Every surface uses one of exactly two elevation levels
The system SHALL render on-page content (panels, rows, cards) with the
flat elevation treatment (hairline border, no shadow) and SHALL render
transient overlays (drawers, dropdowns, modals) with the floating
elevation treatment (shadow plus backdrop dimming) — no third,
intermediate elevation level SHALL be used.

#### Scenario: Quick View drawer overlay
- **WHEN** the Quick View drawer opens over the Dashboard or Attention
  Center
- **THEN** it renders with the floating elevation treatment (shadow,
  dimmed backdrop) while the page behind it remains at flat elevation

#### Scenario: An on-page detail panel
- **WHEN** the 360° Delivery Record's Overview tab renders its detail
  panel
- **THEN** it uses the flat elevation treatment (hairline border, no
  shadow), matching every other on-page panel

### Requirement: List-like collections render as rows, not cards
The system SHALL render collections of similar, comparable items (the
Attention Center feed, audit trail entries, work-item lists) as rows in a
bordered list, and SHALL reserve card treatment for collections of
dissimilar items being browsed (e.g., project quick-access tiles).

#### Scenario: Attention Center feed
- **WHEN** the Attention Center renders its list of decisions, blockers,
  risks, deadlines, and approval gates
- **THEN** each item renders as a row within a bordered list, not as an
  individual bordered card

### Requirement: One accent color is reserved for actions and active state
The system SHALL use a single accent color across the product exclusively
for primary actions and active navigation/tab state, and SHALL NOT use the
accent color for purely decorative emphasis.

#### Scenario: Primary action button
- **WHEN** a primary action (e.g., "Approve," "Resolve Blocker") is
  rendered
- **THEN** it uses the accent color; non-actionable emphasis elsewhere on
  the same screen does not use that color

### Requirement: Every list, panel, and tab defines its four data states
The system SHALL define and render a loading, empty, error, and
populated state for every list, panel, and tab in the product, using a
shared presentation pattern per component type rather than an ad hoc
treatment per screen.

#### Scenario: Attention Center with no items
- **WHEN** a user has no items needing attention
- **THEN** the Attention Center renders a defined empty state, not a blank
  section

#### Scenario: A 360° Record tab with no data at this scope
- **WHEN** a 360° Delivery Record tab (e.g., Configuration) has nothing
  configured at the work item's scope
- **THEN** it renders a defined empty state naming why (e.g., "inherits
  from Client"), not a blank tab
