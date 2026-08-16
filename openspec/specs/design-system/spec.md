# design-system Specification

## Purpose

Defines the shared visual and structural contract — color/type/spacing
tokens, elevation rules, and status-presentation rules — that every screen
in the product must use, so status, risk, and urgency read consistently
everywhere rather than each screen inventing its own treatment.

## Requirements

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
dissimilar items being browsed (e.g., project quick-access tiles). A row
MAY render its content in an aligned column-grid layout (consistent
column widths across every row in the same list) for collections with
multiple comparable fields per item, without becoming a card or a
separate table element.

#### Scenario: Attention Center feed
- **WHEN** the Attention Center renders its list of decisions, blockers,
  risks, deadlines, and approval gates
- **THEN** each item renders as a row within a bordered list, not as an
  individual bordered card

#### Scenario: A multi-field row list renders in aligned columns
- **WHEN** a row list's items each carry multiple comparable fields
  (e.g., an activity feed showing actor, project, status, and time)
- **THEN** each row renders those fields in a consistent column-grid
  alignment shared across every row in the list, using the same row
  component and RTL behavior as a single-column row list, not a
  separate table implementation

### Requirement: One accent color is reserved for actions and active state
The system SHALL use a single accent color across the product exclusively
for primary actions, active navigation/tab state, and the persistent
application shell's branded surface (the sidebar), and SHALL NOT use the
accent color for purely decorative emphasis on page content. The shell
surface is a singular, structural, product-identity element — present
exactly once, in exactly one place — categorically distinct from
decorative emphasis, which this requirement continues to forbid anywhere
on page content itself.

#### Scenario: Primary action button
- **WHEN** a primary action (e.g., "Approve," "Resolve Blocker") is
  rendered
- **THEN** it uses the accent color; non-actionable emphasis elsewhere on
  the same screen does not use that color

#### Scenario: The application shell's sidebar carries the accent hue
- **WHEN** the persistent sidebar renders
- **THEN** its branded surface color derives from the same single accent
  hue as primary actions and active state (a shade of the same color, not
  an unrelated second brand color), and no other page-content surface
  outside the sidebar uses that surface treatment

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

### Requirement: Every screen uses the shared design-system component set
The system SHALL render every user-facing screen — not a subset — using
the shared token set and `src/components/ui/` primitives (or their
approved extensions) for status presentation, elevation, row/card
treatment, buttons, and form fields, rather than screen-local ad hoc
styling.

#### Scenario: A previously unmigrated screen is visited
- **WHEN** a user navigates to any product screen (e.g., Login, Audit
  Trail, Pipeline Detail, Project Settings, Constitution, Configuration
  Center)
- **THEN** its buttons, status indicators, panels, and form fields use
  the same shared components and tokens as the Dashboard and Attention
  Center, not a screen-specific implementation

### Requirement: Actions and form fields use shared Button and form-field primitives
The system SHALL render every actionable button (primary, secondary, and
destructive) and every text/select/textarea form field using one shared
`Button` primitive and one shared form-field primitive, rather than each
form defining its own colors, borders, or sizing.

#### Scenario: A destructive action across two different forms
- **WHEN** a "Reject" action renders on the Pipeline Detail page and a
  "Remove" action renders on the 360° Record's Dependencies tab
- **THEN** both use the same destructive-variant styling from the shared
  `Button` primitive, not two independently chosen red button styles

### Requirement: Duplicate status and action components are consolidated
The system SHALL NOT maintain more than one implementation of the same
UI pattern (a status badge, an approve/reject action pair, a draft-
trigger button) across the product. Where two or more components render
the same pattern for different underlying entities, they SHALL share one
parameterized implementation.

#### Scenario: Pipeline stage status and work-item status render identically
- **WHEN** a pipeline stage's status renders on the Pipeline Detail page
- **THEN** it uses the same `StatusBadge` component, tone system, and
  required-reason presentation as any other status shown in the product,
  not a separate status-badge implementation

#### Scenario: Approving a pipeline stage and approving a Constitution
- **WHEN** a user is presented an approve/reject control for a pipeline
  stage gate and, separately, for a Constitution approval
- **THEN** both render from the same underlying approval-gate component,
  parameterized by which entity they act on, not two independently
  maintained copies
