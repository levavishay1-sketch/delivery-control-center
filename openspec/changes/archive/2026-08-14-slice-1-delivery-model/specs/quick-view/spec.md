# Spec: Quick View (Side Drawer)

## Overview

Quick View is a side drawer that slides in from the right on any work-item detail page. It provides progressive disclosure: blocker or decision first (if present), then full work-item detail, dependencies, and timeline.

## Required Behavior

### Trigger

- Appears when user clicks on a work item in any list (Dashboard, Attention Center, project detail, etc.).
- Can be opened by appending `?view=quick` to a work-item detail URL.
- Close button (X) or click outside to dismiss.

### UI Structure

**Header**: "Work Item #ID" (optional) or just the title. Close button (X) top-right.

**Prioritized sections** (in order):

**1. Blocker Panel** (if an active blocker exists)
- **Title**: "🚫 Blocked" (or similar icon)
- **Reason** (bold): the blocker reason text.
- **Owner**: "Owner: [user name]"
- **Required Action**: what needs to happen to unblock.
- **Blocked Since**: duration (e.g., "2 days ago").
- **Impact** (if provided): business/technical consequence.
- **"Resolve Blocker"** button (if user is owner or Manager+).

**2. Decision Panel** (if a pending decision exists, and no blocker)
- **Title**: "⚠️ Decision Needed" (or similar icon)
- **Question** (bold): the decision question.
- **Reason**: why this decision is needed.
- **Impact**: consequence if delayed or made wrongly.
- **AI Recommendation** (if present): recommendation text with confidence score (0–100).
- **Deadline** (if present): in red if overdue or within 24 hours.
- **"Approve"** and **"Reject"** buttons (if user is authorized).

**3. Work Item Detail**
- **Type**: badge (project/task/bug/change).
- **Status**: current status with a brief explanation.
- **Owner**: user name (linked to user profile, future).
- **Executor**: assigned executor (user or AI agent).
- **Due Date**: with duration (e.g., "in 3 days", "overdue").
- **Progress**: progress bar (0–100%) with percentage text.
- **Risk**: risk level with label (Low/Medium/High/Critical).
- **Priority**: priority level.
- **Description**: work-item description (truncated; link to expand).
- **AI Cost** (if applicable): token/cost from SDD pipeline runs.

**4. Tabs or Sections** (below detail)
- **Dependencies**: both directions (upstream "depends on", downstream "depended on by") with links.
- **Timeline**: filtered audit trail for this work item (most recent first).
- (Future tabs: Code, Tests, Evidence, Configuration — stubbed as "Coming soon").

### Responsive Design

- **Desktop**: side drawer (300–400px wide) slides in from the right, overlaying the page.
- **Mobile** or **narrow viewport**: full-screen modal or bottom sheet.
- **Accessible**: ARIA role="dialog", focus trapped in drawer, Escape to close.

### Interactions

- **"Resolve Blocker"**: POST to `/api/blockers/[id]/resolve`, refresh the drawer.
- **"Approve Decision"**: POST to `/api/decisions/[id]/approve`, refresh the drawer.
- **"Reject Decision"**: POST to `/api/decisions/[id]/reject`, refresh the drawer.
- **Links to dependencies**: click to switch drawer to the linked work item (or navigate to its detail page).
- **Timeline entries**: click to expand (if truncated) or jump to that event.

### Authorization

- Approval/rejection buttons are shown only if authorized.
- Resolve blocker is shown only if user is owner or Manager+.

## Acceptance Criteria

- ✅ Quick View drawer appears when user clicks on a work item.
- ✅ Blocker panel (if present) is displayed first and prominently.
- ✅ Decision panel (if present, and no blocker) is displayed after blocker.
- ✅ Full work-item detail follows (type, status, owner, executor, due date, risk, priority, progress).
- ✅ Dependencies tab shows upstream and downstream with links.
- ✅ Timeline tab shows audit events for this work item.
- ✅ Approve/Reject/Resolve buttons are functional and update the database.
- ✅ Authorization is enforced (buttons hidden if not authorized).
- ✅ Drawer is responsive on desktop and mobile.
- ✅ Keyboard navigation supported (Escape to close, Tab within drawer).
- ✅ All UI states (loading, empty, error) are handled.
- ✅ Tests cover: data fetching, authorization checks, action flows.
- ✅ E2E test: click on a work item in Attention Center, Quick View opens, resolve blocker, verify refresh.
