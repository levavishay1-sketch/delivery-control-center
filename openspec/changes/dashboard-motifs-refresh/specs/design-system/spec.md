## MODIFIED Requirements

### Requirement: One accent color is reserved for actions and active state
The system SHALL use a single accent color across the product exclusively
for primary actions and active navigation/tab state, and SHALL NOT use the
accent color for purely decorative emphasis. The accent color MAY be
rendered as a tonal gradient (a range of shades of the same hue) rather
than a single flat value, provided it remains recognizably one accent
color and is still confined to primary actions and active state.

#### Scenario: Primary action button
- **WHEN** a primary action (e.g., "Approve," "Resolve Blocker") is
  rendered
- **THEN** it uses the accent color; non-actionable emphasis elsewhere on
  the same screen does not use that color

#### Scenario: A gradient primary button is still one accent color
- **WHEN** a primary action button renders with a tonal gradient instead
  of a flat fill
- **THEN** every color in the gradient is a shade of the single accent
  hue, not a second, unrelated color

### Requirement: Every surface uses one of exactly two elevation levels
The system SHALL render on-page content (panels, rows, cards) with the
flat elevation treatment (hairline border, no shadow) and SHALL render
transient overlays (drawers, dropdowns, modals) with the floating
elevation treatment (shadow plus backdrop dimming) — no third,
intermediate elevation level SHALL be used. A flat-elevation surface MAY
additionally carry a layered shadow or soft color glow as a depth accent
(e.g. behind an icon badge) without becoming a third elevation level,
provided it does not add a backdrop dimming or floating-style drop shadow
around the surface's own edges.

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

#### Scenario: A flat surface with a depth accent stays flat
- **WHEN** a stat tile on the Dashboard renders a soft color glow behind
  its icon badge
- **THEN** the tile is still categorized and behaves as flat elevation
  (no backdrop dimming, no edge drop shadow around the tile itself), not
  a new third elevation level

## ADDED Requirements

### Requirement: Semantic colors may be used prominently, not only in small badges
The system SHALL permit status colors and work-item-type colors to be
rendered at larger scale and higher visual weight (full-surface icon
badges, colored card accents, gradients) than a small inline badge,
provided every such use is still tied to the same real semantic meaning
(a status value or a work-item type value) defined elsewhere in the
product — never an arbitrary or decorative color choice with no
underlying meaning.

#### Scenario: A stat tile's icon badge uses a status color prominently
- **WHEN** the Dashboard renders a stat tile for the blocker count
- **THEN** its icon badge is rendered in the critical status color at
  full visual weight, not a muted decorative tint disconnected from the
  blocker status meaning

#### Scenario: An arbitrary decorative color is rejected
- **WHEN** a screen would render a color with no status, work-item-type,
  or accent meaning behind it (e.g. assigning a random hue with no
  identity or status basis)
- **THEN** that color use does not conform to this requirement

### Requirement: A stable per-project identity color aids visual scanning
The system SHALL derive a stable color for each project from the
project's own identity (e.g. its ID), drawn from a curated palette, so
the same project always renders with the same identity color across
visits and sessions, and SHALL NOT use this identity color to convey
status or work-item-type meaning (those remain governed by the semantic-
color requirement above).

#### Scenario: A project's identity color is stable across page loads
- **WHEN** a user views the Dashboard's project quick-access list twice,
  in different sessions
- **THEN** the same project renders with the same identity color both
  times

### Requirement: Interactive cards and stat tiles animate with restraint
The system SHALL apply a brief entrance animation when stat tiles or
project cards first render, and a hover response (lift or scale) on
interactive cards, and SHALL disable or substantially reduce all such
motion when the user's `prefers-reduced-motion` setting is set.

#### Scenario: Reduced motion is respected
- **WHEN** a user with `prefers-reduced-motion: reduce` set in their
  browser loads the Dashboard
- **THEN** stat tiles and project cards do not play an entrance or hover
  animation

### Requirement: A subtle atmospheric wash is reserved for hero/header sections only
The system SHALL permit a subtle gradient-mesh background wash behind a
page's header/hero section (e.g. the Dashboard's or Attention Center's
top summary area), and SHALL NOT apply it to dense content (tables, row
lists, the audit trail), where it would hurt scannability.

#### Scenario: The Dashboard's header carries the wash
- **WHEN** the Dashboard renders its heading and attention-summary stat
  tiles
- **THEN** that header area has a subtle gradient-mesh background wash

#### Scenario: Dense rows do not carry the wash
- **WHEN** the Dashboard renders its recent-activity row list or a
  project's work-item rows
- **THEN** no gradient-mesh wash is applied to those rows

### Requirement: The persistent navigation rail's active item renders as a solid colored pill
The system SHALL render the navigation rail's currently active
destination with a solid accent-colored (or accent-gradient) pill
background behind its icon and label, distinguishing it from the
inactive items' plain icon+label treatment.

#### Scenario: The active nav destination is visually distinct
- **WHEN** a user is on the Attention Center page
- **THEN** the nav rail's "Attention Center" item renders with a solid
  accent-colored pill background, while the other items do not
