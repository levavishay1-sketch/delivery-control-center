# clarify-stage Specification

## Purpose

Lets a drafting stage stop and ask a structured question when the AI
lacks information it needs, instead of guessing, and resume once a human
answers — durably, surviving a process restart while waiting.

## Requirements

### Requirement: Drafting can pause with a clarification question instead of guessing
The system SHALL allow the Clarify stage's draft to produce one or more
structured clarification questions instead of content, moving the stage
into an awaiting-clarification state rather than completing.

#### Scenario: The AI determines it lacks required information
- **WHEN** the Clarify stage is drafted and the AI executor reports it needs more information to proceed
- **THEN** the stage moves to an awaiting-clarification state and one or more questions are recorded against it, instead of the stage completing with guessed content

#### Scenario: No clarification is needed
- **WHEN** the Clarify stage is drafted and the AI executor reports no outstanding questions
- **THEN** the stage completes normally without pausing

### Requirement: A paused stage resumes only once every outstanding question is answered
The system SHALL keep a stage in the awaiting-clarification state until
every question recorded against it has an answer, and SHALL resume
drafting, with the answers included in context, once the last one is
given.

#### Scenario: Answering the last outstanding question resumes drafting
- **WHEN** a stage has two outstanding clarification questions and the second is answered
- **THEN** the stage leaves the awaiting-clarification state and drafting resumes with both answers available to it

#### Scenario: One unanswered question keeps the stage paused
- **WHEN** a stage has two outstanding clarification questions and only one is answered
- **THEN** the stage remains in the awaiting-clarification state

### Requirement: A paused stage survives a process restart
The system SHALL persist an awaiting-clarification stage's questions and
answers such that a process restart while paused causes no loss of state
and requires no special recovery step.

#### Scenario: The application restarts while a stage is paused
- **WHEN** the application process restarts while a stage is in the awaiting-clarification state with an unanswered question
- **THEN** after the restart, the stage is still awaiting that same question, unchanged
