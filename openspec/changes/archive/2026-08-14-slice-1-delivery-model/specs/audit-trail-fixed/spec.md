# Spec: Fixed Audit Trail

## Overview

The audit trail (`GET /audit`) is the system's complete transparency log. Currently, it silently truncates at 200 rows with no filters or pagination. This spec fixes those defects.

## Required Behavior

### Route

**`GET /audit`** (Server Component, requires authentication)

### Data Source

Query `AuditEvent` table with the following enhancements:
- Add filters before pagination.
- Implement proper pagination (20–50 rows per page, user-selectable).
- Remove the 200-row hard truncation.

### UI Structure

**Header**: "Audit Trail" with summary: "Showing N of M events" (with date range filter applied, if any).

**Filter Bar** (collapsible or always visible)
- **Project**: dropdown of projects accessible to the user. Optional; if not selected, show all projects.
- **Actor**: dropdown of users who have acted in the selected projects (or all if no project filter). Optional.
- **Action**: dropdown of action types (e.g., WORK_ITEM_CREATED, BLOCKER_CREATED, DECISION_APPROVED, STAGE_APPROVED, STAGE_REJECTED, WORK_ITEM_STATUS_CHANGED). Optional.
- **Date Range**: from/to date pickers. Optional.
- **"Apply Filters"** button (if filters are complex; otherwise auto-apply on selection).
- **"Clear Filters"** button.

**Events List** (table or card view)
Each row displays:
- **Timestamp**: date and time (absolute, e.g., "2026-08-14 14:32:01 UTC") or relative ("2 hours ago") with hover tooltip.
- **Actor**: user name (linked to user profile, future).
- **Action**: action type (e.g., "Created Work Item", "Approved Stage", "Resolved Blocker"), styled consistently.
- **Object**: what was affected. E.g., "Work Item: Fix login bug", "Stage: SPEC on Pipeline #42", "Blocker on Work Item: Database schema design".
- **Changed Fields** (optional, expandable): if applicable (e.g., for updates), show what changed ("status: open → in_progress").
- **Link**: if applicable (work item, pipeline, stage), make it clickable to navigate to the object.

**Pagination**
- Rows per page: 20, 50, or 100 (user-selectable).
- Page numbers or "Load More" button.
- Info: "Showing X–Y of Z events".

### Responsive Design

- **Desktop**: table layout with columns (Timestamp, Actor, Action, Object, Link).
- **Mobile**: card layout (one event per card, swipe to paginate or scroll).
- **Accessible**: table semantics if table layout used; ARIA labels; keyboard navigation.

### Authorization

- Users see only audit events for projects they're a member of.
- All events in accessible projects are visible (no role-based filtering of event visibility; all events are part of the transparency guarantee).

### Data Integrity

- Audit events are immutable; never edited or deleted.
- All events include `createdAt`, `actor` (real user reference), and `entityType` / `entityId` / `changedFields` JSON.

## Acceptance Criteria

- ✅ Route `/audit` renders the audit trail.
- ✅ Filter bar allows filtering by project, actor, action, and date range.
- ✅ Pagination displays 20/50/100 rows per page (selectable).
- ✅ No 200-row hard truncation; all events in the database are accessible via pagination.
- ✅ Each event row displays timestamp, actor, action, object, and links.
- ✅ Changed fields (for updates) are shown or expandable.
- ✅ Authorization is enforced (users see only events from their projects).
- ✅ Responsive layout works on desktop and mobile.
- ✅ Keyboard navigation supported (Tab to filters/pagination, Enter to apply).
- ✅ All UI states (loading, empty, error) are handled.
- ✅ Tests cover: filtering, pagination, authorization, link generation.
- ✅ E2E test: navigate to audit trail, filter by project, verify events are displayed correctly, paginate, verify no silent truncation.
