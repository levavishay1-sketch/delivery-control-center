Source: verbatim user message, received 2026-08-17. Treated as the governing product
definition for Delivery Control Center per the user's own framing below and AGENTS.md's
"Durable inputs" policy (saved same-turn, unedited).

---

I want you to treat the following as the product definition for the Delivery Control Center.

Your job is to understand these requirements as one connected product, not as a disconnected list of features.

Before implementing any capability, understand:

- what user problem it solves;

- where it belongs in the end-to-end lifecycle;

- which entities it affects;

- what human control is required;

- what AI autonomy is allowed;

- what must remain traceable;

- how it interacts with hierarchy, dependencies, changes, approvals, testing, and execution.

Do not reduce these requirements into a simple task-management application.

This product is intended to manage AI-driven software delivery across customer systems, repositories, requirements, SDD-defined work, AI Agents, humans, source control, testing, decisions, and changes.

When something is not explicitly defined here, do not silently invent a product decision.

Use the existing project conventions where appropriate, and surface material ambiguities when they affect product behavior.

The following specification defines WHAT the product must do.

==================================================

1. PRODUCT PURPOSE

==================================================

Build a platform for managing AI-driven software development processes for customers.

The platform manages the lifecycle from:

understanding a customer's existing systems and repositories

through:

new requirement intake

→ requirement understanding

→ SDD

→ work decomposition

→ AI execution

→ human interaction

→ source-code activity

→ testing

→ change management

→ implementation completion.

The product should allow AI to operate as autonomously as appropriate while preserving:

- human control;

- complete visibility;

- traceability;

- clear responsibility;

- controlled change management;

- risk awareness;

- the ability to understand exactly what is happening at any moment.

==================================================

2. CORE PRODUCT EXPERIENCE

==================================================

At any moment, the responsible person should be able to answer:

- What are we building?

- Why are we building it?

- What is the current state of the work?

- What is AI doing right now?

- What has already been completed?

- What remains?

- What is blocked?

- Why is it blocked?

- Who is responsible for the work?

- Who owns the current decision?

- What changed since the last approval?

- Which source-code actions were performed?

- Which tests were executed?

- What failed?

- What needs human attention?

- What is expected to happen next?

The product must not force a manager to reconstruct this information manually from separate chats, commits, documents, task systems, and test systems.

==================================================

3. CUSTOMER

==================================================

Customer is the top-level customer boundary.

A Customer may contain:

- Users

- Roles

- Permissions

- Connections

- Sources

- Repositories

- Projects / Initiatives

- Requirements

- Policies

- AI Configuration

- System Context

- Work Items

- Decisions

- Audit History

Customer information must remain isolated from other Customers.

==================================================

4. CONNECTIONS

==================================================

A Connection represents technical connectivity to an external provider or system.

Examples may include:

- Source Control Provider

- CRM

- Business System

- Database

- Design System

- Documentation System

- Other external systems

A Connection is not the same thing as a Source.

One Connection may expose multiple Sources.

==================================================

5. SOURCES

==================================================

A Source is an actual resource that the platform can understand or interact with.

Examples include:

- Repository

- Database

- CRM

- API

- Pipeline

- Design Source

- Documentation Source

- Business System

- Future Source types

The product must not assume that every Source is a Repository.

==================================================

6. REPOSITORIES

==================================================

A Customer may have:

- one Repository;

- multiple Repositories;

- Repositories across different source-control providers.

A Repository belongs to the Customer.

It must not be assumed that a Repository belongs exclusively to one Project.

The same Repository may participate in multiple Projects, Initiatives, Requirements, or Features.

==================================================

7. SOURCE-CONTROL PROVIDER INDEPENDENCE

==================================================

The product must not be coupled to one source-control provider.

The core product should understand normalized concepts such as:

- Repository

- Branch

- File Change

- Commit

- Push

- Code Change Request

- Review

- Review Comment

- Automated Check

- Conflict

- Merge-related Activity

Provider-native identifiers and terminology should still be preserved where relevant.

==================================================

8. REPOSITORY ONBOARDING

==================================================

When a Repository is connected for the first time, do not automatically start SDD.

The first goal is to understand the existing Repository.

This is:

REPOSITORY DISCOVERY

Repository onboarding and Requirement SDD are different lifecycle concerns.

==================================================

9. REPOSITORY DISCOVERY

==================================================

Repository Discovery creates persistent understanding of an existing Repository.

It should be able to identify, where relevant:

- Repository purpose

- Technology Stack

- Project structure

- Modules

- Domains

- Components

- Entry Points

- APIs

- Data Stores

- Data-access patterns

- Integrations

- Dependencies

- Testing structure

- Architectural patterns

- Important paths

- Project conventions

- Unknowns

- Evidence supporting significant findings

Repository Discovery should be intelligent and targeted.

Do not assume the entire Repository must be loaded or analyzed indiscriminately.

==================================================

10. REPOSITORY CONTEXT

==================================================

Repository Discovery should result in persistent Repository Context.

Repository Context gives humans and AI a navigational understanding of the Repository.

It should help answer questions such as:

- What does this Repository do?

- How is it structured?

- Where are important components?

- What are the major Domains?

- Where are integrations?

- Where are tests?

- What are the important relationships?

- How should an Agent navigate this Repository?

Repository Context helps navigation and understanding.

It does not replace verification against current source code.

==================================================

11. REPOSITORY CONTEXT MAINTENANCE

==================================================

Repository Context must not become permanently stale.

When Repository code changes:

1. detect the change;

2. determine whether existing Context may be affected;

3. avoid unnecessary rediscovery when it is not affected;

4. perform targeted analysis when it is affected;

5. update the relevant Context;

6. retain an indication of the source revision against which the Context was verified.

Do not require full Repository rediscovery after every source change.

==================================================

12. SYSTEM CONTEXT

==================================================

A Customer also needs System Context.

Repository Context explains one Repository.

System Context explains relationships across the Customer's broader technical environment.

It may include:

- Repositories

- Databases

- APIs

- Business Systems

- Integrations

- Pipelines

- Dependencies

- Data Flows

- Business Flows

- Technical Flows

- Cross-Repository Relationships

- Cross-System Relationships

System Context should focus on relationships across Sources rather than duplicating the complete internal context of every Repository.

==================================================

13. SYSTEM RECONCILIATION

==================================================

When a new Source is understood or an existing Source changes, the platform should be capable of reconciling that information with the wider System Context.

Example:

Repository A

    ↓

   API

    ↓

Repository B

    ↓

Database

If another Repository is later discovered to interact with the same API, the system should be able to incorporate that relationship into its understanding.

==================================================

14. NEW REQUIREMENT

==================================================

A user can create a New Requirement under a Customer.

At creation time, it may be unknown:

- which Repository is affected;

- how many Repositories are affected;

- which external systems are affected;

- whether SDD is required;

- how large the work will become.

The original submitted Requirement must be preserved.

==================================================

15. AI PROCESSING IS OPTIONAL

==================================================

Creating a Requirement must not automatically trigger expensive AI processing.

The responsible human may choose to:

- Start AI Analysis

- Postpone AI Analysis

- Use a manual process

- Use a reduced or alternative AI process

The product must allow control over when AI cost is incurred.

==================================================

16. REQUIREMENT TRIAGE

==================================================

When AI Analysis starts, the platform performs initial Requirement Triage.

The purpose is to understand the nature of the incoming Requirement.

Potential output includes:

- Type

- Size

- Complexity

- Domains

- Risk

- Potential Scope

- Need for deeper discovery

- Potentially relevant Sources

- Initial Unknowns

Triage is not:

- the final Specification;

- the Technical Plan;

- final Architecture;

- final Repository selection.

==================================================

17. IMPACT DISCOVERY

==================================================

The platform should determine which parts of the Customer environment may be affected by the Requirement.

Potentially affected areas include:

- Repositories

- APIs

- Databases

- CRM systems

- Integrations

- Design Sources

- Other Sources

The discovery scope must remain dynamic.

New relevant Sources may be identified during analysis.

==================================================

18. DEEP REQUIREMENT ANALYSIS

==================================================

The system should build a deeper understanding of:

CURRENT STATE

What exists today.

DESIRED STATE

What the Requirement requests.

CHANGE GAP

What needs to change to reach the Desired State.

The analysis should also identify:

- Business Rules

- Assumptions

- Contradictions

- Risks

- Missing Information

- Missing Decisions

- Dependencies

==================================================

19. AI QUESTIONS

==================================================

AI may stop and ask the responsible human for information at any stage where the answer is necessary.

A Question should include, where relevant:

- The Question

- Why AI is asking

- Context

- Evidence

- Possible Options

- AI Recommendation

- Blocking / Non-blocking status

- Appropriate Decision Owner

==================================================

20. PAUSE AND RESUME

==================================================

When AI needs human input, the current work must not be lost.

The system should:

1. persist the current execution state;

2. enter a waiting state;

3. receive the human response;

4. persist the response;

5. add it to the relevant Context;

6. resume from the appropriate point.

Human interaction must be part of long-running execution, not an exception that requires restarting the workflow.

==================================================

21. QUESTION, APPROVAL, AND REVIEW

==================================================

These are separate concepts.

QUESTION:

AI does not know what the correct answer is and requires information or a decision.

APPROVAL:

The intended action/result is known, but authorization is required.

REVIEW:

A result has been produced and needs human evaluation.

These should be represented and managed separately.

==================================================

22. OWNER AND DECISION OWNER

==================================================

A Work Item may have:

OWNER

The person responsible for the work.

DECISION OWNER

The person responsible for the currently required decision.

These do not have to be the same person.

==================================================

23. RESPONSIBILITY TRANSFER

==================================================

Authorized users may transfer:

- Ownership

- Decision Ownership

during the lifecycle of:

- Project

- Initiative

- Requirement

- Feature

- Bug

- Task

- Subtask

- Change

Every transfer should be traceable.

==================================================

24. DISCOVERY GATE

==================================================

When the platform determines that a Requirement is sufficiently understood, it may recommend:

READY FOR SDD

Relevant conditions may include:

- Requirement understood

- Current State sufficiently understood

- Desired State sufficiently understood

- Relevant Sources identified

- Critical Unknowns resolved

- Major Risks identified

- Blocking Contradictions resolved

- Required Human Decisions received

The final decision to proceed belongs to the responsible human.

==================================================

25. SDD ACTIVATION

==================================================

Not every Requirement must automatically enter SDD.

The responsible person may choose:

- Start SDD

- Continue Without SDD

- Postpone

- Return to Discovery

The platform may recommend SDD based on:

- Complexity

- Size

- Risk

- Number of affected systems

- Dependencies

- Policies

The recommendation does not replace human authority.

==================================================

26. SDD

==================================================

The product must support an SDD capability for Requirements.

Its purpose is to transform an understood Requirement into work that can be executed.

The platform must be able to work with authoritative SDD outputs representing areas such as:

- Desired behavior

- Technical planning

- Supporting artifacts

- Tests / Acceptance

- Work decomposition

- Changes

Do not treat SDD as merely a Markdown document viewer.

SDD is part of the work-definition lifecycle.

==================================================

27. AUTHORITATIVE SDD WORK

==================================================

The platform must not create a competing hidden Task definition when SDD already defines the work.

Conceptually:

Authoritative SDD Work

        ↓

Structured Platform Representation

        ↓

Visual / Operational Work Graph

The platform representation should reflect the authoritative work.

==================================================

28. VARIABLE WORK HIERARCHY

==================================================

Do not hard-code the product around only:

Feature

→ Task

→ Subtask

The product must support practical arbitrary hierarchy depth.

For example:

Initiative

└── Feature

    └── Work Item

        └── Work Item

            └── Work Item

The hierarchy defined for the work must be preserved.

==================================================

29. HIERARCHY AND DEPENDENCY

==================================================

Hierarchy and Dependency are different concepts.

HIERARCHY answers:

What belongs under what?

DEPENDENCY answers:

What must happen before what?

A Work Item under one Parent may depend on another Work Item elsewhere in the hierarchy.

Model both independently.

==================================================

30. MULTI-REPOSITORY REQUIREMENTS

==================================================

A Requirement may affect multiple Repositories.

After understanding and SDD work decomposition, different Work Items may belong to different Repository scopes.

Example:

Requirement

├── Work Item A → Repository A

├── Work Item B → Repository B

└── Work Item C → Repository A + Repository C

Hierarchy must remain coherent even across Repository boundaries.

Cross-Repository Dependencies must be supported.

==================================================

31. VISUAL WORK GRAPH

==================================================

The manager must receive a strong visual representation of the work.

The graph should expose:

- Hierarchy

- Dependencies

- Parallel Paths

- Status

- Blockers

- AI State

- Human State

- Owner

- Decision Owner

- Approval

- Tests

- Changes

- Risk where relevant

Users should be able to:

- Expand levels

- Collapse levels

- Open Work Items

- Navigate Parent / Child relationships

- See Dependencies

- Understand parallel work

- Understand where attention is required

==================================================

32. WORK ITEM DETAIL

==================================================

Opening any Work Item should provide comprehensive visibility.

Relevant information includes:

- Name

- Description

- Purpose

- Parent

- Children

- Dependencies

- Dependents

- Requirement

- Relevant SDD Context

- Technical Context

- Relevant Sources

- Relevant Repositories

- Owner

- Decision Owner

- Current Status

- Approval State

- AI State

- Execution Readiness

- Blockers

- Questions

- Decisions

- Tests

- Changes

- Source-Control Activity

- Timeline

- Last Activity

- Next Expected Action

The user should not need to inspect raw technical artifacts simply to understand the current state of the Work Item.

==================================================

33. DETAILED BLOCKERS

==================================================

Never show only:

BLOCKED

when the platform knows more.

A Blocker should clearly show:

- why the item is blocked;

- what or who is blocking it;

- who is responsible for resolution;

- what action is required to unblock it;

- how critical the Blocker is.

==================================================

34. APPROVAL IS NOT EXECUTION READINESS

==================================================

Human Approval alone does not necessarily make a Work Item executable.

Execution Readiness may depend on:

Human Approval

+

AI Readiness

+

Dependency Readiness

+

Required Inputs

+

Required Context

+

Policy Gates

Only when required conditions are satisfied should execution proceed.

==================================================

35. BLOCKER CRITICALITY

==================================================

The product should distinguish between levels such as:

- Information

- Warning

- Soft Blocker

- Hard Blocker

SOFT BLOCKER:

AI recommends that execution should not continue, but an authorized human may override where Policy allows.

HARD BLOCKER:

Execution cannot continue until the condition is resolved or an explicitly allowed exception is granted.

==================================================

36. AI DOES NOT ARBITRARILY CREATE HARD BLOCKERS

==================================================

AI may detect concerns and recommend severity.

AI alone must not be allowed to arbitrarily classify any concern as a non-overridable Hard Blocker.

Hard-blocking behavior must be governed by Policies and defined criticality rules.

==================================================

37. AI AUTONOMY

==================================================

Managers should be able to control how much autonomy AI receives.

Configuration may include:

- May AI automatically move to the next Work Item?

- Must AI ask before certain decisions?

- May AI create Child Work Items?

- May AI run Tests?

- May AI perform approved Source Control operations?

- Does a Failure automatically pause execution?

- May AI make local technical decisions?

- Which events always require escalation?

Autonomy must be configurable rather than one global ON/OFF value.

==================================================

38. AUTONOMY HIERARCHY

==================================================

Autonomy configuration can exist at multiple levels:

Platform

↓

Customer

↓

Project / Initiative

↓

Feature

↓

Work Item

A Child inherits the effective Parent configuration when no explicit override exists.

A hard restriction at a higher level cannot be bypassed by a lower level.

==================================================

39. AUTONOMY AND RISK

==================================================

The platform may recommend different levels of Autonomy according to Risk and Complexity.

For example:

LOW RISK:

More autonomous progression.

MEDIUM RISK:

Autonomous execution with defined checkpoints.

HIGH RISK:

More explicit human decisions.

These are recommendations.

Actual behavior remains governed by humans and Policies.

==================================================

40. APPROVAL MATRIX

==================================================

Which operations require Approval should be configurable.

Core principle:

A material action requires Approval unless it has explicitly been pre-authorized.

Potentially material changes may include:

- Scope

- Architecture

- Requirement intent

- Previously approved work

- Important Dependencies

- Security

- Privacy

- Data

- Destructive operations

==================================================

41. ROUTINE TECHNICAL ACTIONS

==================================================

Routine technical actions already authorized by Project configuration should not create unnecessary approval fatigue.

Examples may include:

- Reading code

- Navigating the Repository

- Allowed Git operations

- Commits

- Pushes

- Running Tests

subject to permissions and configured rules.

==================================================

42. WORK EXECUTION

==================================================

When a Work Item becomes executable, AI should work using the relevant information.

Conceptually:

Relevant SDD Work

+

Relevant Human Decisions

+

Repository/System Context

+

Current Source Code

+

Project Rules

AI should retrieve targeted Context rather than reloading the entire Customer environment for every small Work Item.

==================================================

43. UNEXPECTED FINDINGS

==================================================

During execution, AI may discover:

- Code changed

- An assumption was wrong

- API behavior differs

- A Dependency changed

- Architecture differs

- A Security issue exists

- Requirement information is missing

- A Conflict exists

- Test assumptions are invalid

When this happens, AI should:

- Record the Finding

- Show Evidence

- Explain Impact

- Recommend a response

- Identify the appropriate decision maker

- Pause when required

==================================================

44. AI MAY NOT SILENTLY CHANGE APPROVED WORK

==================================================

Approval applies to a particular approved work definition.

Example:

T-17 revision 3

Approved

If AI believes that the Work Item must materially change:

T-17 revision 3

        ↓

Proposed Change

        ↓

T-17 revision 4

The Change must be visible and governed.

==================================================

45. CHANGE DIFF

==================================================

When work changes, show a clear before/after Diff.

Potential differences include:

- Description

- Scope

- Added Child

- Removed Child

- Added Dependency

- Removed Dependency

- Testing requirements

- Repository impact

- Parent impact

- Higher-level work impact

The responsible human should understand exactly what is changing before approving it.

==================================================

46. HUMAN EDITING OF WORK

==================================================

An authorized responsible person may edit a Work Item from the UI.

If the edit modifies part of the approved work definition:

Do not silently overwrite the approved definition.

The approved edit should create a controlled Change.

==================================================

47. CHANGE AS FIRST-CLASS WORK

==================================================

A Change is itself managed work.

Example:

T-17

├── T-17.1

├── T-17.2

└── Change-01

The Change remains hierarchically associated with the Work Item that caused it.

This relationship must remain visible.

==================================================

48. CHANGE LIFECYCLE

==================================================

A Change may require:

Change

↓

Analysis

↓

Impact Analysis

↓

Questions / Decisions

↓

Work Adjustment

↓

Implementation

↓

Tests

↓

Completion

A Change may also create Child Work Items of its own.

==================================================

49. UPSTREAM CHANGE IMPACT

==================================================

A local Work Item Change may affect:

- Parent

- Sibling

- Dependency

- Technical Plan

- Higher-level work definition

- Tests

- Requirement intent

The platform must not automatically treat every Change as isolated.

==================================================

50. WORK ITEM REVISION

==================================================

The product must allow users to understand:

- Which revision was approved

- What changed after approval

- Who requested the Change

- Why it changed

- What the Diff was

- Which revision is current

- Whether new Approval is required

Purely operational updates such as current Owner or runtime Status do not necessarily create a new work-definition revision.

==================================================

51. CHILD APPROVAL

==================================================

When a Parent reaches an approval stage, the responsible person should be able to see its Children and their readiness.

For every Child, the manager should be able to:

- Open it

- Review it

- Approve it inside its detail view

- Approve it directly from the Parent's child list

==================================================

52. BULK APPROVAL

==================================================

The product should provide:

APPROVE ALL ELIGIBLE

This is a convenience operation.

It must not bypass validation.

Each Child must independently satisfy all required lifecycle conditions before it can be approved.

==================================================

53. PARENT COMPLETION

==================================================

A Parent cannot become Completed / Final Approved while a required Child has an unresolved problem.

Example:

Feature

├── Task A ✓

├── Task B ✓

└── Task C ✕ Blocked

The Feature cannot be completed.

This rule applies recursively throughout the hierarchy.

==================================================

54. PARALLEL AI EXECUTION

==================================================

Multiple AI Agents may work in parallel.

Treat this conceptually like multiple developers working concurrently on different units of work.

Two Agents using the same Repository is not automatically a problem.

==================================================

55. CONCURRENCY AWARENESS

==================================================

The product should understand that concurrent Agents may touch:

- The same File

- The same Module

- The same Contract

- The same Schema

- The same API

- The same Test Environment

- Shared Dependencies

Do not prevent safe parallel work unnecessarily.

Meaningful overlap should be detectable.

==================================================

56. CONFLICT HANDLING

==================================================

If parallel execution creates a Conflict, AI should explain to the responsible human:

- Where the Conflict exists

- Which Work Items are involved

- Which Files / Components are affected

- What each side changed

- Why the Conflict exists

- What the consequences are

- Available resolution options

- AI Recommendation

If the resolution requires a material decision, the responsible human decides.

==================================================

57. SOURCE-CONTROL ACTIVITY

==================================================

Meaningful Source-Control Activity must be connected to relevant Work Items.

Examples include:

- Repository Access

- Branch

- File Changes

- Commit

- Push

- Code Change Request

- Review

- Comments

- Checks

- Conflict

- Merge-related Events

The manager should be able to see this activity from the Work Item.

==================================================

58. TESTING BELONGS TO THE WORK

==================================================

Testing is part of the work definition and lifecycle.

Depending on the Project, Tests may include:

- Unit

- Integration

- Contract

- Acceptance

- E2E

- Other relevant validation

Tests should be visible in the context of the relevant Work Item and hierarchy.

==================================================

59. RUN TESTS

==================================================

Appropriate Work Items should expose:

RUN TESTS

The responsible person may request a new Test Run even if AI has already executed tests.

==================================================

60. ORCHESTRATED TEST EXECUTION

==================================================

The user should not need to know internal test commands.

When Run Tests is requested, the platform should determine:

- Which Tests apply

- Which Repository or Repositories are involved

- Required Environment

- Source revision

- Relevant Child scope

- How results are collected

==================================================

61. HIERARCHICAL TESTING

==================================================

Running Tests on a Parent may include relevant Tests belonging to its Descendants.

Example:

Feature A

├── Task 1

│   ├── Task 1.1

│   └── Task 1.2

└── Task 2

Running Tests for Feature A may execute the configured validation scope relevant to the hierarchy underneath it.

==================================================

62. TEST RESULTS

==================================================

Test Results should expose:

- Aggregate Result

- Results by Child

- Test Cases

- Failures

- Logs

- Artifacts

- Environment

- Source Revision

- Execution Time

Every Test Run should be recorded.

==================================================

63. AI COMPLETION ASSESSMENT

==================================================

When AI believes a Work Item is finished, it performs a Completion Assessment.

The core question is:

Does the AI believe the Work Item satisfies its defined requirements and completion conditions?

==================================================

64. HUMAN COMPLETION APPROVAL

==================================================

When Human Approval is required, the responsible human must approve the completed result.

Default conceptual model:

AI Execution Completed

+

Required Tests Passed

+

AI Completion Assessment Passed

+

Required Human Approval Received

=

Work Item Completed

Policies may allow automated progression in explicitly pre-authorized scenarios.

==================================================

65. HIERARCHICAL COMPLETION

==================================================

A Parent should only progress to completion when all required lower-level conditions are satisfied.

Depending on the work, these may include:

- Required Children Completed

- Dependencies Resolved

- Tests Passed

- AI Completion Passed

- Required Human Approvals Received

- No Blocking Questions

- No Blocking Changes

- No Hard Blockers

- No unresolved Material Conflicts

==================================================

66. FEATURE / REQUIREMENT-LEVEL VALIDATION

==================================================

Higher-level work may have higher-level Tests.

If SDD defines:

- Acceptance Tests

- Feature-level Tests

- Requirement-level Tests

- E2E Tests

those belong to the completion lifecycle.

Do not create a separate duplicate E2E definition when the required validation already exists in the authoritative work.

==================================================

67. AUTONOMOUS PROGRESSION

==================================================

When Autonomy Policy allows it:

Task A

↓

AI Completed

↓

Required Validation Passed

↓

Policy Allows Progression

↓

Task B Starts Automatically

When a human decision is required:

Critical Finding

↓

Pause

↓

Human Decision

↓

Resume

==================================================

68. AUTONOMOUS DOES NOT MEAN INVISIBLE

==================================================

Even when AI operates autonomously:

- Actions are recorded

- Timeline is updated

- Changes remain visible

- Source-Control Activity remains visible

- Tests remain visible

- AI decisions remain traceable

- Humans can inspect progress at any moment

- Authorized humans can pause execution according to Policy

==================================================

69. WORK ITEM TIMELINE

==================================================

Every Work Item should maintain a complete Timeline of meaningful events.

Potential events include:

- Creation

- Assignment

- Reassignment

- Decision Owner Transfer

- AI Start

- AI Pause

- Question

- Human Answer

- Approval

- Rejection

- Review

- Finding

- Blocker

- Change

- Source Change

- Commit

- Test

- Conflict

- Resolution

- Completion

- Reopen

==================================================

70. ACTOR

==================================================

Every significant Event should identify the actor where relevant.

Actor types include:

- Human

- AI Agent

- System

==================================================

71. HUMAN ATTENTION NOTIFICATIONS

==================================================

When human intervention is required, the responsible person should be notified.

Examples include:

- Question

- Approval Required

- Review Required

- Conflict

- Hard Blocker

- Important Test Failure

- Ownership Transfer

==================================================

72. DASHBOARD ATTENTION

==================================================

Items waiting for human action must also appear prominently in the product Dashboard / Attention Center.

The responsible person should immediately understand:

- What needs attention

- Why

- Criticality

- Related Work Item

- Required Action

==================================================

73. PUSH NOTIFICATIONS

==================================================

In addition to in-product visibility, support push-style notification capability.

The notification model should remain extensible so additional delivery channels can be introduced later.

==================================================

74. AI AGENT

==================================================

An AI Agent is not the same thing as an AI Model.

An Agent represents a role or responsibility.

Examples may include:

- Discovery Agent

- Analysis Agent

- Coding Agent

- Testing Agent

An Agent may define:

- Purpose

- Instructions

- Allowed Actions

- Restrictions

- Tools

- Expected Outputs

- Escalation Rules

==================================================

75. MODEL SELECTION

==================================================

The platform should be capable of selecting different AI Models according to the work.

Relevant factors may include:

- Capability

- Quality

- Cost

- Privacy

- Context Size

- Risk

- Customer Policy

Do not assume every Agent must use the same Model.

==================================================

76. AI COST VISIBILITY

==================================================

The product should expose AI operational usage information such as:

- Agent

- Model

- Provider

- Tokens

- Cost

- Duration

- Work Item

- Run

This should allow managers to understand the operational cost of AI execution.

==================================================

77. AUTONOMY DOES NOT REMOVE VALIDATION

==================================================

Autonomy must not bypass lifecycle correctness.

Even if Policy allows AI to progress without explicit manual approval for every Child, the platform must still validate completion conditions.

Autonomy changes:

Who must stop and approve?

It does not change:

Whether the work actually satisfies its required lifecycle conditions.

==================================================

78. AUDIT

==================================================

Meaningful governance and lifecycle actions should be auditable.

Where relevant, retain:

- Entity

- Action

- Actor

- Actor Type

- Timestamp

- Previous State

- New State

- Reason

- Related Work Item

- Related Run

- Related Decision

==================================================

79. CUSTOMER DASHBOARD

==================================================

At Customer level, the platform should expose information such as:

- Sources

- Repositories

- Context Status

- Requirements

- Active Projects

- Active Work

- Progress

- Blockers

- Questions

- Approvals

- Reviews

- Risks

- AI Activity

- Test Status

- Recent Decisions

==================================================

80. REQUIREMENT VIEW

==================================================

The Requirement experience should expose:

- Original Requirement

- Discovery Status

- Relevant Systems

- Relevant Repositories

- Risks

- Questions

- Decisions

- SDD Status

- Work Graph

- Progress

- Current Blockers

- Timeline

==================================================

81. ATTENTION CENTER

==================================================

Managers should have a central attention experience such as:

Needs My Attention

├── Questions

├── Approvals

├── Reviews

├── Conflicts

├── Critical Blockers

└── Responsibility Transfers

The user should be able to navigate directly from each attention item to its full context.

==================================================

82. IMPLEMENTATION COMPLETE

==================================================

Within the current scope, a Requirement reaches:

IMPLEMENTATION COMPLETE

when:

- All required Work Items are Completed

- All required hierarchy branches are Completed

- All required Dependencies are resolved

- All required Tests pass

- Required higher-level / E2E Tests pass

- Required AI Completion Checks pass

- Required Human Approvals are received

- No Blocking Questions remain

- No Blocking Changes remain

- No Hard Blockers remain

- No unresolved Material Conflicts remain

IMPLEMENTATION COMPLETE does not automatically mean PRODUCTION COMPLETE.

==================================================

83. CURRENTLY OUT OF SCOPE

==================================================

The current product specification intentionally stops at Implementation Complete.

The following are future product areas and are not yet fully specified:

- Final Code Review

- Final Merge Governance

- Release

- Deployment

- Production Rollout

- Rollback

- Production Validation

- Production Monitoring

- Runtime Feedback

- Final Requirement Closure after Production

Do not invent detailed product behavior for these areas unless required by a later specification.

==================================================

84. END-TO-END PRODUCT LIFECYCLE

==================================================

The complete intended lifecycle for the current scope is:

CUSTOMER

    ↓

CONNECT SOURCES

    ↓

REPOSITORY / SOURCE ONBOARDING

    ↓

REPOSITORY DISCOVERY

    ↓

REPOSITORY CONTEXT

    ↓

SYSTEM RECONCILIATION

    ↓

SYSTEM CONTEXT

--------------------------------

NEW REQUIREMENT

    ↓

HUMAN DECIDES WHETHER TO START AI

    ↓

REQUIREMENT TRIAGE

    ↓

IMPACT DISCOVERY

    ↓

DEEP REQUIREMENT ANALYSIS

    ↕

QUESTIONS / HUMAN DECISIONS

    ↓

READY FOR SDD

    ↓

HUMAN DECISION

    ↓

SDD

    ↓

AUTHORITATIVE WORK DEFINITION

    ↓

VISUAL WORK GRAPH

    ↓

OWNERSHIP / DECISION OWNERSHIP

    ↓

APPROVAL / AUTONOMY POLICY

    ↓

EXECUTION READINESS

    ↓

AI EXECUTION

    ↕

QUESTIONS

APPROVALS

REVIEWS

BLOCKERS

CHANGES

CONFLICTS

    ↓

CODE / SOURCE-CONTROL ACTIVITY

    ↓

TESTS

    ↓

AI COMPLETION ASSESSMENT

    ↓

HUMAN APPROVAL WHEN REQUIRED

    ↓

WORK ITEM COMPLETE

    ↓

NEXT WORK

    ↓

...

    ↓

ALL REQUIRED WORK COMPLETE

    ↓

HIGHER-LEVEL / E2E TESTS

    ↓

FINAL REQUIRED APPROVALS

    ↓

IMPLEMENTATION COMPLETE

==================================================

85. FINAL PRODUCT PRINCIPLE

==================================================

The product connects:

Customer Systems

+

Repositories

+

Requirements

+

SDD

+

Work Items

+

AI Agents

+

Humans

+

Source Control

+

Tests

+

Changes

+

Decisions

+

Audit

into one continuous delivery lifecycle.

The manager should never have to manually reconstruct the lifecycle from disconnected:

- chats

- commits

- task systems

- documents

- test systems

- approvals

- AI runs

The platform should preserve the connected chain:

System Reality

→ Requirement

→ Understanding

→ SDD

→ Work

→ Decisions

→ Execution

→ Code

→ Tests

→ Changes

→ Completion

The final product must make this lifecycle:

VISIBLE

GOVERNED

CONTROLLABLE

TRACEABLE

UNDERSTANDABLE

ACTIONABLE

==================================================

86. HOW TO INTERPRET THIS SPECIFICATION

==================================================

Treat all of the requirements above as one connected product model.

Do not implement one feature in a way that breaks another principle.

In particular:

- Do not separate Work Items from their SDD origin.

- Do not allow autonomy to bypass governance.

- Do not allow approval to bypass readiness.

- Do not allow Parent completion to bypass Child lifecycle state.

- Do not allow Changes to silently rewrite previously approved work.

- Do not hide Blocker reasons.

- Do not lose human Questions during long-running execution.

- Do not make AI execution invisible.

- Do not collapse hierarchy and dependency into one concept.

- Do not assume one Repository per Requirement.

- Do not assume one Project per Repository.

- Do not assume one AI Model for every Agent.

- Do not treat current Context as a substitute for current source verification.

Whenever you work on a capability, evaluate it in the context of the complete lifecycle above.

The goal is not to produce isolated features.

The goal is to produce one coherent Delivery Control Center.
