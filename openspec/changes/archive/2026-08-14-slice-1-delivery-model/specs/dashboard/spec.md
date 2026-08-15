# Spec: Dashboard (Home Page)

## Overview

The dashboard (`GET /` or `GET /dashboard`) is redesigned from a project list into a command center: an at-a-glance summary of attention needed, quick access to projects, and recent activity.

## Required Behavior

### Route

**`GET /`** (Home, Server Component, requires authentication)

### UI Structure

**Header**: "Dashboard" (or no explicit header if space is tight).

**1. Attention Summary (top card)**
Clickable card with counts:
- N Decisions Pending (links to `/attention#decisions`)
- M Blockers Active (links to `/attention#blockers`)
- K Risks (links to `/attention#risks`)
- X Deadlines (links to `/attention#deadlines`)

If all counts are zero, display "All clear — no attention needed" in green.

**2. Project Quick Access (grid or list)**
Show projects accessible to the user:
- Project name (link to project detail)
- Client name (context)
- Recent work items count
- Last activity timestamp

Group by client if user has access to multiple clients. Limit to top 5–10 projects (or "View all").

**3. Recent Activity Feed (timeline)**
Display the top 10 audit events from projects the user can access:
- Timestamp (relative, e.g., "2 hours ago")
- Actor (user name)
- Action (e.g., "Created", "Approved", "Blocked")
- Object (e.g., "Work Item: Fix login bug")
- Link to related object

Oldest events at the bottom.

**4. Optional: Team Status** (future enhancement, stub with "Coming soon" if time allows)
- Assign work items by team member (not implemented in Slice 1).

### Responsive Design

- **Desktop**: Attention summary card at top (4 columns), Projects grid below (3–4 columns), Activity feed (2 columns wide or full-width).
- **Mobile**: Stack vertically: summary card, projects list, activity feed.
- **Accessible**: headings, ARIA labels, semantic HTML.

### Authorization

- Only show projects and activities the user can access (scoped by ClientMembership and role).
- For Viewer role: read-only; no action buttons on dashboard.

### Data Freshness

- Server-rendered; no client-side polling.
- A "Refresh" button (optional) could trigger a page reload.

## Acceptance Criteria

- ✅ Route `GET /` renders the dashboard.
- ✅ Attention summary card displays counts for decisions, blockers, risks, deadlines.
- ✅ Counts link to `/attention` with optional anchor (e.g., `#decisions`).
- ✅ Projects grid/list shows projects accessible to the user.
- ✅ Recent activity feed shows top 10 audit events with links.
- ✅ Responsive layout works on desktop and mobile.
- ✅ Authorization is enforced (Viewer cannot approve, but sees summaries).
- ✅ All UI states (loading, empty, error) are handled.
- ✅ Tests cover: data aggregation, authorization, link generation.
- ✅ E2E test: log in, verify dashboard loads, attention summary is accurate, click on Decisions count and navigate to Attention Center.
