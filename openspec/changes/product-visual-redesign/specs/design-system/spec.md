## MODIFIED Requirements

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

## ADDED Requirements

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
