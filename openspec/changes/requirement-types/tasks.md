# Requirement types — tasks

Appetite: **large** (needs a design pass before sizing further).

## 0. Design (do first)

- [x] 0.1 New field, separate from `workitem.type` — decided by the
      user 2026-09-12 (requirements never sync to ADO at all, so this
      field has no ADO-mapping concern to resolve)
- [x] 0.2 Decide the research/testing requirement's own lifecycle —
      **delegated to this session's judgment 2026-09-12** ("נותן לך
      להחליט עם הבנת המערכת"). Decided: assess stays shared with
      development requirements (still useful regardless of type,
      unchanged UI); once gaps close, instead of an AI breakdown into
      many tasks, the requirement moves straight to a single "work"
      step. Work = adding findings/verification notes directly on the
      requirement (reusing the existing note mechanism, nothing new).
      "Done" requires an explicit conclusion — a required "מסקנות
      תחקור"/"תוצאת בדיקה" textarea before the "✓ סיום" action, which
      closes the tracking task and the requirement together. Reopening
      is deliberately NOT special-cased — `decision-history`'s generic
      reopen already covers it; a reopened research/testing requirement
      just shows the work step again, ready for another note + another
      close.
- [x] 0.3 Decide how the TFS sub-task gets created — **delegated,
      decided alongside 0.2**: ONE task, auto-approved and
      auto-materialized immediately (no human review step — there's no
      AI proposal to review, it's a direct 1:1 mirror of "this
      requirement now has trackable work"), created the moment a person
      clicks "פתח משימת מעקב ב-TFS" on the work step (an explicit action,
      not silent-on-page-load — matches DCC's own "no silent actions"
      principle). One task per requirement, not a breakdown — refuses a
      second call.

## 1. Schema + core

- [x] 1.1 Requirement type field + migration — `requirement_type`
      Postgres enum (`development | research | testing`) +
      `workitem.requirement_type` column, default `development`
      (`packages/db/src/schema/enums.ts`, `workitem.ts`, migration
      `0027_requirement_type.sql`). Orthogonal to `workitem.type`,
      never reusing it, per the 2026-09-12 decision. Threaded through
      `crud.ts`'s `updateRequirement` (generic `REQ_FIELDS` whitelist),
      the `PATCH /workitems/:id` route, AND (added once "decided at
      creation, changeable later" was clarified) `POST /workitems`
      (create) — settable at creation via a new "אופי הדרישה" selector
      in `NewRequirement` (`forms.tsx`), and separately editable
      afterward via the same selector in `EditRequirement`.
- [x] 1.2 `WorkflowTab` branches: research/testing requirements skip
      breakdown/approve/materialize, work happens directly under the
      requirement — built as a genuinely separate step-rail
      (`STEPS_RESEARCH`, 3 steps: assess/gaps/work) and a parallel
      `done[]`/render branch inside `WorkflowTab.tsx`, deliberately NOT
      threaded as conditionals through the existing (complex, working)
      development step logic — a parallel branch was the lower-risk
      shape here, not a rewrite of tested code. The work step: "פתח
      משימת מעקב ב-TFS" button (idle) → the one task rendered via the
      existing `<TaskGraph>` + "+ הוסף ממצא" (reuses `AddNote`) + a
      required conclusion + "✓ סיום" once notes exist.
- [x] 1.3 The auto-created TFS sub-task for research/testing work —
      `packages/core/src/research-work.ts`: `startResearchWork` (create
      + `approveTask` — reuses the EXISTING approve/materialize
      pipeline rather than a new one) and `finishResearchWork` (posts
      the conclusion as a note, `progressTask` the task to done,
      `updateRequirement` the requirement to done). `POST
      /workitems/:id/research/start` + `/research/finish`.

## 2. Flow visualization

- [~] 2.1 Small-card variant in `TaskGraph.tsx` (~¼ size of a
      development task card) — **not built, deliberately deferred.**
      `LAYER_W`/`COL_W`/`ROW_H` in `TaskGraph.tsx` drive the actual
      React Flow layout math, not just visual size — for the single
      research/testing task WorkflowTab shows on its own, a smaller
      wrapping container (`height={220}`, already done) reads
      compact without touching that math. But a true mixed-size
      variant, for a canvas showing research/testing tasks ALONGSIDE
      development ones, needs the layout math itself reworked —
      real risk of breaking the existing, working Flow layout
      everywhere else it's used. Not worth rushing under this batch's
      time pressure; a deliberate, tested follow-up.
- [ ] 2.2 Card sizing/column-width math in the Flow canvas accounts for
      mixed card sizes without breaking layout — not built, same
      reasoning as 2.1 (this IS that follow-up).

## 3. Verify end to end

- [x] 3.1 Create one requirement of each type, confirm each gets the
      right flow — verified live end-to-end on a throwaway research
      requirement (Altshuler Trade pilot, deleted after): created with
      type=research → 3-step rail confirmed (not 5) → simulated assess
      completion (injected the matching note directly rather than
      spending a real AI call just to unlock the gate) → gaps step →
      work step → "פתח משימת מעקב ב-TFS" created AND MATERIALIZED a real
      ADO task (`#69`) → "+ הוסף ממצא" → wrote a conclusion → "✓ סיום
      תחקור" → confirmed requirement phase became `done`, the task's
      own `state` became `done` (checked directly via the task-flow
      API, not just the UI), and the "✦ המלצות לשיפור" retro button
      appeared automatically. Cleaned up after: deleted the DCC
      requirement AND soft-deleted the real ADO test task it created
      (`wit/workitems/69` DELETE) so no test debris was left in the
      pilot's live TFS project.
- [ ] 3.2 Confirm the research/testing task renders small in the Flow
      and is still fully clickable/trackable — not applicable yet,
      blocked on 2.1 (deferred).
- [x] 3.3 `npm run typecheck` clean throughout.

**Summary: 0.1–1.3 fully delivered and live-verified, including a real
ADO materialization round-trip. Only the purely-visual small-card Flow
polish (2.1/2.2) is deferred, for the layout-risk reason stated above —
everything the proposal's exit gate actually promises (skip the
breakdown step, still get a real tracked TFS task) works today.**
