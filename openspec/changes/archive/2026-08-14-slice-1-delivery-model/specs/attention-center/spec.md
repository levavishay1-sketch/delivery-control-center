# Spec: Attention Center

## Overview

The Attention Center (`/attention`) is the primary screen of the delivery control plane: a command center showing every work item needing human action, grouped by type, with the *reason* prominently displayed on every row.

## Required Behavior

### Route

**`GET /attention`** (Server Component, requires authentication)

### Data Aggregation

Query and aggregate all items needing attention across all projects accessible to the user:

1. **Decisions** — all pending (open) decisions across the user's projects.
2. **Blockers** — all active blockers across the user's projects.
3. **Risks** — all work items with `risk='High'` or `risk='Critical'`.
4. **Deadlines** — all work items with `dueDate` within the next 7 days and `status != 'completed'`.
5. **Approval Gates** — all work items with `status='review'` (awaiting approval).
6. **Sync Problems** — (stub for Slice 4; not implemented in Slice 1, but space reserved).

### UI Structure

**Header**: "Attention Center" with a summary card:
- N decisions pending
- M blockers active
- K risks (High/Critical)
- X deadlines (within 7 days)
- "All clear" state if nothing needs attention

**Tabbed or collapsible sections** for each group (Decisions, Blockers, Risks, Deadlines, Approval Gates). Each row shows:

**Decisions row**:
- Decision question (bold, primary text)
- Work item title and type badge
- Reason why the decision is needed
- AI recommendation (if present) with confidence score
- Deadline (if present, in red if overdue)
- "Approve" and "Reject" buttons

**Blockers row**:
- Reason (bold, primary text, e.g., "Blocked — Waiting for design approval")
- Work item title and type badge
- Owner (who's responsible for unblocking)
- Required action (what needs to happen)
- "Resolve Blocker" button (if user is owner or Manager+)

**Risks row**:
- Risk level (badge: High/Critical)
- Work item title, type, owner
- Risk description (if captured)
- Link to work item detail

**Deadlines row**:
- Due date (in red if within 24 hours)
- Work item title, type, owner, status
- Link to work item detail

**Approval Gates row**:
- "Awaiting approval"
- Work item title, type, owner
- Stage name (if available from SDD pipeline)
- "Approve" and "Reject" buttons

### Constraints

- **Never render without context**: every row must explain *why* it's in the Attention Center. No unexplained "Blocked" without the reason; no status badge without a label.
- **Sorted by urgency**: blockers and decisions that are overdue (or nearing deadline) appear at the top.
- **Pagination**: if a group has > 20 items, paginate (20 per page).
- **Filters**: optional filters by project, type, priority (not required in Slice 1; consider for future UX enhancement).
- **Refresh**: the page is server-rendered (no client-side polling); a manual "Refresh" button or scheduled re-fetch could be added later.

### Response to Actions

- **"Approve Decision"**: POST to `/api/decisions/[id]/approve`, record approval, remove from Decisions section.
- **"Reject Decision"**: POST to `/api/decisions/[id]/reject`, record rejection, keep in Decisions section with rejection reason displayed.
- **"Resolve Blocker"**: POST to `/api/blockers/[id]/resolve`, remove from Blockers section, update work item status.
- **"Approve Gate"** (SDD pipeline): existing route; same behavior.

### Authorization

- Only items in projects where the user is at least Viewer are shown.
- Approve/Reject buttons are shown only if the user has the role to perform that action (Project Manager+, or the decision/blocker owner).

### Responsive Design

- Desktop: groups displayed as collapsible sections or tabs.
- Mobile: groups stacked vertically; buttons are touch-friendly.
- Accessible: headings, ARIA labels, keyboard navigation (Tab to rows, Enter to expand/act).

## Acceptance Criteria

- ✅ Route `/attention` exists and requires authentication.
- ✅ Queries aggregate decisions, blockers, risks, deadlines, approval gates from all user's projects.
- ✅ Each group is displayed with its items sorted by urgency.
- ✅ Each row explains *why* it's in the Attention Center (reason visible).
- ✅ Approve/Reject buttons are functional and update the database.
- ✅ Resolve Blocker button is functional.
- ✅ Authorization is enforced (Viewer sees but cannot approve; only authorized users can act).
- ✅ Responsive layout works on mobile and desktop.
- ✅ Keyboard navigation supported (Tab, Enter, arrow keys).
- ✅ All UI states (loading, empty, error) are handled.
- ✅ Tests cover: query aggregation, authorization checks, action flows, UI rendering.
- ✅ E2E test: navigate to Attention Center, verify a blocker is shown with reason, resolve it, verify it's removed.
