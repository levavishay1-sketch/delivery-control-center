# quick-view Specification

## Purpose
Gives progressive disclosure of a work item's state — blocker or decision
first, then full detail, dependencies, and timeline — in a side drawer
openable from anywhere a work item is listed, without leaving the page.

## Requirements

### Requirement: The drawer opens via a URL query parameter, from any page
The system SHALL open the Quick View drawer whenever a `quickView`
parameter naming a work item is present on the current URL, and SHALL
make this work from any page — the Attention Center, the Dashboard, or
the work item's own 360° Record — not only from the item's own detail
page, since it must react to a click from any list without a full
navigation.

#### Scenario: Opening from the Attention Center
- **WHEN** a user clicks "Quick View" on an Attention Center row
- **THEN** the drawer opens over the Attention Center page, showing that work item's data, without navigating away

### Requirement: The blocker panel renders before the decision panel
The system SHALL render the active blocker's panel, when one exists,
above the pending decision's panel, when one exists — both, independently,
before the general work-item detail below them, each with its full
context (reason/question, owner or recommendation, and action buttons).

#### Scenario: A blocked item with a pending decision shows both panels, blocker first
- **WHEN** a work item has both an active blocker and a pending decision
- **THEN** the drawer shows the blocker panel, then the decision panel, both above the general detail

### Requirement: Actions taken in the drawer are reflected in the drawer itself
The system SHALL, after an action succeeds inside the drawer (resolving a
blocker, approving or rejecting a decision, adding or removing a
dependency, editing the work item), refresh the drawer's own data in
place — not rely on a full-page refresh, since the drawer's data is
fetched independently of the page's own Server-Component render.

#### Scenario: Resolving a blocker updates the open drawer
- **WHEN** a user clicks "Resolve Blocker" inside an open Quick View drawer
- **THEN** the blocker panel disappears and the work item's status updates within that same drawer, without a page navigation

### Requirement: Escape and backdrop click close the drawer
The system SHALL close the drawer when the user presses Escape or clicks
outside it, and SHALL move focus to the drawer's close control when it
opens.

#### Scenario: Pressing Escape closes the drawer
- **WHEN** the Quick View drawer is open and the user presses the Escape key
- **THEN** the drawer closes
