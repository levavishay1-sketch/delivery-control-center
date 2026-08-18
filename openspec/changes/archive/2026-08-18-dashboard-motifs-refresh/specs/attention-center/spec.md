## ADDED Requirements

### Requirement: The Attention Center shows a stat-tile summary row
The system SHALL render, at the top of the Attention Center, a summary
row of stat tiles (an icon badge in that group's status color, the
count, and a label) for each of the page's groups, each linking to that
group's section, using the same `StatTile` treatment as the dashboard's
attention summary rather than a separate, differently-styled widget.

#### Scenario: A stat tile links to its group
- **WHEN** a user clicks the Attention Center's blockers stat tile
- **THEN** the page scrolls to (or otherwise navigates to) the Blockers
  group section

#### Scenario: The same component as the dashboard
- **WHEN** the Attention Center and the dashboard each render their
  summary counts
- **THEN** both use the same `StatTile` component and icon-badge
  treatment, not two separate implementations of a similar-looking
  widget
