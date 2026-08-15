# internationalization Specification

## Purpose

Gives the product a lightweight, extensible locale mechanism — English and
Hebrew today, more languages addable later without rework — where Hebrew
renders as a true right-to-left layout, not translated text over an
unchanged left-to-right shell.

## Requirements

### Requirement: English and Hebrew are supported, user-selectable locales
The system SHALL support English and Hebrew as selectable display locales,
SHALL default to English when no locale preference is recorded, and SHALL
apply a locale switch to the current page without navigating to a
different page.

#### Scenario: Switching from the nav rail
- **WHEN** a user selects Hebrew from the language switcher in the
  persistent navigation rail
- **THEN** the current page's text updates to Hebrew and its layout
  mirrors to right-to-left, without navigating away from the page the
  user was on

#### Scenario: Default locale with no prior preference
- **WHEN** a user with no recorded locale preference visits the product
  for the first time
- **THEN** the product renders in English, left-to-right

### Requirement: The selected locale persists and renders without a direction flash
The system SHALL persist the user's locale choice across sessions and
SHALL render the previously selected locale's language and text direction
on the first paint of a subsequent page load, not after a client-side
switch.

#### Scenario: Returning after choosing Hebrew
- **WHEN** a user who previously selected Hebrew reloads the page or
  returns in a new session
- **THEN** the page renders in Hebrew with right-to-left direction from
  first paint, with no visible flash of left-to-right layout beforehand

### Requirement: Hebrew is a true RTL layout, not mirrored text alone
The system SHALL mirror structural layout — including the position of the
persistent navigation rail, the edge an overlay (drawer, dropdown) opens
from, and directional icons (e.g. back/forward chevrons) — to match
right-to-left reading order when Hebrew is active, in addition to
translating text. Icons that do not encode a reading direction (status
icons, checkmarks) SHALL NOT be mirrored.

#### Scenario: Nav rail position mirrors
- **WHEN** Hebrew is the active locale
- **THEN** the persistent navigation rail renders on the trailing edge of
  the reading direction, mirrored from its position under English

#### Scenario: A directional icon mirrors, a non-directional one does not
- **WHEN** Hebrew is the active locale
- **THEN** an icon that encodes reading direction (e.g. a "back" chevron)
  points the RTL-correct way, while a status or checkmark icon renders
  unchanged from its English orientation

### Requirement: Dates and numbers render per the active locale's conventions
The system SHALL format every displayed date and number using the active
locale's formatting conventions rather than a single hardcoded format.

#### Scenario: A due date under Hebrew
- **WHEN** Hebrew is the active locale and a work item's due date is
  rendered
- **THEN** the date is formatted per Hebrew-locale conventions, not the
  English-locale format

### Requirement: Adding a further language does not require reworking the RTL mechanism
The system SHALL declare each locale's text direction as part of that
locale's own definition, so that RTL mirroring is driven by the active
locale's declared direction rather than special-cased to only English and
Hebrew.

#### Scenario: A locale's direction is self-declared
- **WHEN** a new locale is added to the supported set
- **THEN** its layout direction (LTR or RTL) is read from that locale's
  own definition, not from logic that only recognizes English and Hebrew
