## Purpose

Gives users a fast, keyboard-driven way to jump to any work item or
project they can access from anywhere in the product, closing a
previously named and unaddressed gap (global search / Ctrl+K) rather
than leaving navigation to page-by-page browsing alone.

## ADDED Requirements

### Requirement: The command palette opens via a keyboard shortcut from any page
The system SHALL open a command palette overlay when the user presses
Ctrl+K (or Cmd+K on macOS) from any authenticated page, and SHALL close
it on Escape or an outside click, matching the product's existing
overlay-dismissal pattern.

#### Scenario: Opening from any page
- **WHEN** an authenticated user presses Ctrl+K while on the Attention
  Center
- **THEN** the command palette opens as a floating-elevation overlay over
  the current page

#### Scenario: Closing with Escape
- **WHEN** the command palette is open and the user presses Escape
- **THEN** the palette closes and the underlying page remains unchanged

### Requirement: Search results are scoped to the user's accessible clients
The system SHALL search only work items and projects belonging to
clients the requesting user can access (all clients for an org admin),
using the same tenancy scoping already enforced elsewhere in the
product, and SHALL NOT return a result the user could not otherwise
reach.

#### Scenario: A result from an inaccessible client is excluded
- **WHEN** a user searches for a term that matches a work item in a
  client they have no membership on and are not an org admin for
- **THEN** that work item does not appear in the results

### Requirement: Selecting a result navigates directly to it
The system SHALL, when a user selects a work item result, navigate to
that work item's Quick View or 360° Record, and, when a user selects a
project result, navigate to the dashboard scrolled to that project —
closing the palette in either case.

#### Scenario: Selecting a work item result
- **WHEN** a user selects a work item from the command palette's results
- **THEN** the palette closes and the user lands on that work item's
  Quick View or 360° Record

### Requirement: The command palette renders in the active locale
The system SHALL render every label and placeholder in the command
palette (search input placeholder, empty-results message, group
headings) in the active locale, and SHALL lay out its content correctly
under the active locale's reading direction.

#### Scenario: Command palette in Hebrew
- **WHEN** Hebrew is the active locale and a user opens the command
  palette
- **THEN** its placeholder text and any empty-state message render in
  Hebrew, laid out right-to-left
