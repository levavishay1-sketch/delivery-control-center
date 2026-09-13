# Decision history — tasks

Appetite: **standard**.

## 1. Capture points

- [x] 1.1 Re-breakdown ("פרק מחדש") prompts for a reason before running —
      `WorkflowTab.tsx`'s existing `PromptPreviewModal` gained a
      `reasonField` (reused for other capture points too), shown only when
      there's already a hierarchy to re-breakdown; wired through
      `POST /workitems/:id/breakdown` → `recordDecision(trigger:
      "rebreakdown")`.
- [x] 1.2 Closing a task with unresolved checks prompts for a reason —
      `TaskDetail.tsx`'s "אשר ידנית למרות הכישלון" now opens an inline
      reason textarea before the override actually fires; wired through
      `POST /tasks/:id/progress` (`overrideReason`) →
      `recordDecision(trigger: "task_closed_override")`. A close with all
      checks passing needs no reason (nothing to explain).
- [x] 1.3 Reopening a task prompts for a reason — `TaskDetail.tsx`'s
      "↩ פתח מחדש" (shown on a `done` task) opens a reason textarea before
      calling `progressTask(..., reopenReason)` →
      `recordDecision(trigger: "task_reopened")`.
- [x] 1.4 Reopening a requirement prompts for a reason — `EditRequirement`
      in `forms.tsx` detects a patch moving `phase` off `done`/`archived`
      and requires (Save is disabled without it) a reason in the same
      modal, no separate flow; wired through `PATCH /workitems/:id`
      (`reopenReason`) → `updateRequirement()` →
      `recordDecision(trigger: "requirement_reopened")`. Verified live
      end-to-end (see 3.1).
- [~] 1.5 A general "direction changed" note type — `direction_changed`
      exists as a `DecisionTrigger` and the schema/`recordDecision` accept
      it, but no UI currently lets a user log one directly; the four
      concrete capture points above are the only wired triggers today.
      Leaving this open rather than inventing a speculative "log a
      decision" button with no clear home in the UI yet.

## 2. Surfacing

- [x] 2.1 Requirement history/timeline view highlights decision-reason
      events distinctly from routine notes — `Record.tsx`'s Timeline tab
      renders `decision.made` rows with a warm background, an accent-left
      border, a "למה: <trigger label>" pill instead of the raw event type,
      and the reason itself as bold body text. Verified live (see 3.1).
- [ ] 2.2 Reasons appear in the requirement's final summary (feeds
      `requirement-retro-recommendations`) — not started; natural next
      step once `requirement-retro-recommendations` itself is built, since
      that's the only consumer of a "final summary" view today.

## 3. Verify end to end

- [x] 3.1 Requirement reopen walked through live on a throwaway test
      requirement (Altshuler Trade pilot client, deleted after): created
      → phase set to `done` → edited again with phase moved to
      `building`, reason field appeared and was required to save →
      confirmed the `decision.made` event (trigger `requirement_reopened`)
      appeared in the Timeline tab with the correct highlighted styling
      and the exact reason text. Re-breakdown / task-close-override /
      task-reopen reason capture were not independently re-walked live in
      this pass (they were implemented earlier this session); typecheck
      passing is the only cross-check for those three right now.
- [x] 3.2 `npm run typecheck` clean
