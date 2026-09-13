# Bug / Change Request lifecycle — tasks

Appetite: **standard**.

## 1. Check inheritance

- [x] 1.1 Bug created under a task: link/inherit that task's existing
      check tasks rather than starting blank — **unblocked 2026-09-12**
      once the user resolved the data-model question this task was
      waiting on (see proposal.md's "Decided 2026-09-12"). Built:
      - `bug_task_link` table (`packages/db/src/schema/workitem.ts`,
        migration `0028_bug_task_link.sql`) — many-to-many, `client_id`
        + RLS like every tenant table.
      - `packages/core/src/bugs.ts` — `linkBugToTask`/
        `unlinkBugFromTask`/`bugLinkedTasks`/`inheritedChecksForBug`
        (the last: every ACTIVE check-kind child across a Bug's linked
        tasks, deduped by intent).
      - `runBreakdown` (`ai-assist.ts`) — when the requirement being
        broken down is `type = "bug"` with linked tasks, the inherited
        checks are inserted as new check-task rows under the Bug's own
        first top-level task, labeled "(ירושה מבדיקות המשימה המקושרת)"
        so it's visibly not an AI-invented check.
      - UI: `BugLinksSection` in `forms.tsx`'s `EditRequirement`, shown
        only when the requirement's type is Bug — live search across
        the client's tasks (`GET /clients/:id/tasks`), link/unlink
        take effect immediately (their own endpoints, not the field
        patch this modal otherwise batches).
      - Verified live: linked a throwaway Bug requirement to a REAL
        task in the Altshuler Trade pilot data (view/link/unlink only,
        nothing modified), confirmed the section renders the link with
        its parent requirement title, confirmed unlink + delete both
        work. The full inheritance-during-breakdown path (an actual AI
        breakdown run) was NOT independently re-verified live — same
        standing rule as elsewhere this session, no real `claude -p`
        call purely to test plumbing; the query logic itself was
        reviewed by hand instead.
- [x] 1.2 Change Request does NOT inherit checks — decided 2026-09-12:
      a CR is its own new category, like a task, gets its own fresh
      breakdown/checks, not a continuation of the related task's

## 2. Reopening on Bug/CR after closure

- [~] 2.1 Detect (however the eventual TFS-notification mechanism
      works) a Bug/CR tied to an already-closed requirement — explicitly
      out of scope per this proposal's own text (no TFS-change-detection
      infra exists anywhere in the codebase yet; this is the same open
      question as task-level TFS→DCC sync noted during
      `task-inactive-tfs-sync`). Not attempted, and shouldn't be.
- [x] 2.2 Reopen the requirement, recording a reason via the
      `decision-history` mechanism — **already delivered generically**,
      not as Bug/CR-specific code: `decision-history`'s requirement-reopen
      flow (`EditRequirement` in `forms.tsx` → `updateRequirement` →
      `recordDecision(trigger: "requirement_reopened")`) reopens ANY
      done/archived requirement with a required, recorded reason. A
      person who manually notices a Bug/CR landed on a closed requirement
      types e.g. "נפתחה מחדש בעקבות Bug" as that reason today — no
      separate mechanism needed until/unless auto-detection (2.1) exists
      to trigger it without a person in the loop.
- [x] 2.3 If the requirement was still open, no special handling — the
      Bug/CR just joins ongoing work — true by construction: nothing in
      this codebase gates on requirement phase before accepting new
      notes/gaps/tasks against an open requirement.

## 3. UI

- [x] 3.1 A reopened requirement clearly shows its reopening reason, not
      just a bare phase change — delivered generically by
      `decision-history`: the Timeline tab renders `decision.made` rows
      (including `requirement_reopened`) with a highlighted background,
      an accent border, and a "למה: פתיחת דרישה מחדש" pill plus the actual
      reason text, distinct from the routine `requirement.updated` row
      that logs the bare phase change alongside it.
- [x] 3.2 The full lifecycle (open → dev → test → close → Bug/CR →
      reopen → …) is legible in the requirement's history/timeline —
      true by construction of the append-only event log: every phase
      change is its own `requirement.updated` event and every reopen
      carries its own `decision.made` event, in order, nothing
      overwritten.

## 4. Verify end to end

- [~] 4.1 Simulate a Bug under a task with existing checks, confirm
      inheritance — the LINKING half verified live (see 1.1); the
      INHERITANCE-DURING-BREAKDOWN half needs a real AI breakdown run
      to fully confirm, deliberately not triggered this pass (cost).
- [x] 4.2 Simulate a Bug appearing on a closed requirement, confirm
      reopen + reason recorded and visible — covered by
      `decision-history`'s own live verification (its tasks.md § 3.1):
      a throwaway requirement was created, closed, and reopened with a
      reason through the generic flow, and the `decision.made` event was
      confirmed rendering correctly in the Timeline. Not re-run with a
      literal "Bug" as the stated reason text since the generic mechanism
      doesn't branch on what the reason says.
- [x] 4.3 `npm run typecheck` clean — current as of the last full-repo
      typecheck this session (decision-history's changes, which this
      relies on, are included).
