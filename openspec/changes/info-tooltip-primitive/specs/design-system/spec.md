## ADDED Requirements

### Requirement: Non-obvious concepts offer an accessible, reusable explanation
The system SHALL provide one shared component for explaining a non-obvious concept (a
configuration field, a status determination, a budget rule, an AI recommendation) — what it is,
why it matters, and how it is determined — and every screen that needs to explain such a concept
SHALL use that shared component rather than inventing its own explanation UI or leaving the
concept unexplained. The explanation SHALL be reachable by mouse hover, keyboard focus, and touch
activation — never hover-only — and SHALL mirror correctly under RTL using the same component as
the LTR rendering.

#### Scenario: A non-obvious field carries an explanation
- **WHEN** a screen renders a field or value whose meaning, rationale, or derivation is not
  self-evident from its label alone
- **THEN** an ⓘ affordance from the shared component sits next to it, and activating it (click,
  keyboard Enter/Space, or touch) reveals the explanation

#### Scenario: Explanation is reachable without a mouse
- **WHEN** a keyboard-only or touch-only user reaches the ⓘ affordance
- **THEN** they can reveal the same explanation a mouse-hover user sees, without requiring a
  hover-capable pointer

#### Scenario: Explanation under RTL
- **WHEN** Hebrew is the active locale and an ⓘ affordance renders
- **THEN** its position relative to the field it explains, and the popover's reading direction,
  mirror correctly using the same shared component as the English/LTR rendering — not a separate
  locale-specific implementation
