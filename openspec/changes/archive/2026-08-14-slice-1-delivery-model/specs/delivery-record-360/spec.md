# Spec: 360° Delivery Record

## Overview

The 360° Delivery Record (`GET /work-items/[id]/360`) provides a comprehensive, multi-tab view of a work item's state, dependencies, execution history, and evidence. This slice implements three tabs (Overview, Dependencies, Timeline) and stubs the rest with honest empty states.

## Required Behavior

### Route

**`GET /work-items/[id]/360`** (Server Component, requires authentication)

### Tab Structure

Each tab is a separate section or React tab component. Only three are implemented in Slice 1; others show "Coming soon".

#### Tab 1: Overview

**Work Item Summary**
- **Title** (H1): work item title.
- **Type**: badge (project/task/bug/change).
- **Status**: enum value with an explanation. E.g., "Approved — This item has been reviewed and approved by the Tech Lead."
- **Owner**: user name (linked, future).
- **Executor**: assigned executor (user name or "AI Agent" or "Unassigned").
- **Due Date**: with duration and indicator (green if not due, amber if within 7 days, red if overdue).
- **Progress**: progress bar (0–100%).
- **Risk**: risk level (Low/Medium/High/Critical) with explanation (if captured).
- **Priority**: priority level.
- **Blocker Status**: if an active blocker exists, show "Blocked — [reason]" with a link to resolve.
- **Decision Status**: if a pending decision exists, show "Decision Needed — [question]" with Approve/Reject buttons.

**Actions** (conditional on authorization)
- Edit button (if owner or Manager+)
- Delete button (if Manager+)
- Add Dependency button (if owner or Manager+)
- Create Blocker button (if Manager+)
- Create Decision button (if Manager+)

**AI Cost** (if applicable): tokens and cost from SDD pipeline runs, total and per-stage breakdown.

**Parent & Children** (if applicable)
- If this work item has a parent, show a link to the parent.
- If this work item has children, show a collapsible list of children (title, status, owner).

#### Tab 2: Dependencies

**Upstream Dependencies** ("Depends on")
- List of work items this item depends on.
- For each: title, type, status, owner, reason for dependency.
- Link to each dependency.
- Remove dependency button (if authorized).

**Downstream Dependents** ("Depended on by")
- List of work items that depend on this item.
- For each: title, type, status, owner, reason.
- Link to each dependent.

**Dependency Graph** (optional visualization, future enhancement)
- (Stub with "Coming soon" in Slice 1 if not implemented; full graph expected in Slice 1 as per design.md.)

**Add Dependency** button (if authorized)
- Modal to search for and add a new upstream dependency.
- Inputs: search for work item, enter reason.

#### Tab 3: Timeline

**Audit Trail** (filtered to this work item)
- List of audit events for this work item, most recent first.
- Each event shows: timestamp (relative, e.g., "2 hours ago"), actor (user name), action (e.g., "Created", "Approved", "Status Changed to In Progress"), and changed fields (if applicable).
- Pagination: 20 events per page.

**Filters** (optional enhancement for UX)
- By actor, action type, date range (future UX; not required in Slice 1).

#### Stubs (Honest Empty States)

**Tab 4: Code & Changes** (Slice 5 feature)
- "Coming soon — trace work item to code changes"

**Tab 5: Tests** (Slice 5 feature)
- "Coming soon — view associated test runs"

**Tab 6: Evidence** (Slice 5 feature)
- "Coming soon — view evidence of completion"

**Tab 7: Configuration** (Slice 6 feature)
- "Coming soon — view configuration and overrides"

Never use placeholder mock data or fake implementation. Honest empty states maintain user trust.

### Responsive Design

- **Desktop**: tabs at the top (tab buttons), content area below.
- **Mobile**: tabs in a horizontal scroll or dropdown, content stacks vertically.
- **Accessible**: ARIA roles, semantic HTML, keyboard navigation (arrow keys to switch tabs, Tab to interactive elements).

### Authorization

- Overview, Dependencies, Timeline are visible to any authenticated user in the project.
- Edit, Delete, and action buttons are shown only if authorized.
- Cost breakdown is visible only to authorized roles (future granularity; assume Manager+ for now).

## Acceptance Criteria

- ✅ Route `/work-items/[id]/360` renders the 360° Record.
- ✅ **Overview tab** displays all work-item fields (type, status, owner, executor, due date, progress, risk, priority, blocker/decision status).
- ✅ Actions (Edit, Delete, Add Dependency, Create Blocker, Create Decision) are present and functional for authorized users.
- ✅ **Dependencies tab** displays upstream and downstream dependencies with reasons.
- ✅ Remove dependency button is functional.
- ✅ **Timeline tab** displays audit events for this work item, sorted by recency.
- ✅ Audit events show timestamp, actor, action, and changed fields.
- ✅ Pagination works on Timeline tab.
- ✅ Stub tabs (Code, Tests, Evidence, Configuration) show honest "Coming soon" states.
- ✅ Responsive layout works on desktop and mobile.
- ✅ Keyboard navigation supported (arrow keys for tabs, Tab for interactive elements).
- ✅ Authorization is enforced (buttons hidden if not authorized).
- ✅ All UI states (loading, empty, error) are handled.
- ✅ Tests cover: data fetching, authorization, action flows.
- ✅ E2E test: navigate to a work item's 360° Record, verify Overview, Dependencies, and Timeline tabs render correctly.
