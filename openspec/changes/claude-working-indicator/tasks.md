# Claude working indicator — tasks

Appetite: **small**.

- [x] 1.1 Audit every screen/action that can trigger a run (assess,
      breakdown, implement, check-independent-run) for whether it shows
      a spinner/"בעבודה…" label at the point of action while `running`
      is true — found the text/label side was already well covered
      (`WorkflowTab`'s running panel names the run kind, has a stop
      button, a steer input, and a transcript; `TaskDetail` has its own
      equivalent); the real gaps were elsewhere (below)
- [x] 1.2 **Found and fixed a real, app-wide bug along the way**: the
      `.spin` CSS class (used for every "טוען…"/"מכין…" loading state
      and as a small inline "still working" icon next to run labels)
      had no keyframes and no visual glyph at all — every "spinner" in
      the app rendered as an invisible empty box, silently, this whole
      time. Added real `@keyframes dcc-spin` + a rotating-ring look to
      `.spin` (full-block loading states) and a new `.spinner` class
      (small inline icon, sized by the caller's own width/height) —
      updated the 3 call sites that were using the inline-icon pattern
      (`Record.tsx`, `TaskDetail.tsx`, `WorkflowTab.tsx`) to the new
      class. Verified via computed-style inspection: real `border-
      radius: 50%`, `animation-name: dcc-spin`, and a distinct
      `border-top-color` (the rotating segment) — not just present in
      the DOM but actually animating.
- [x] 1.3 **Found and fixed a second real gap**: `Record.tsx`'s
      Overview/Timeline/Dependencies tabs are siblings — switching away
      from Overview unmounts `WorkflowTab` entirely, taking its running
      indicator with it, so a user who switched tabs while a run was in
      flight had zero indication anything was still happening. Added an
      independent, lightweight poll (`getFlowRun`, every 2s) in
      `Record.tsx` that badges the Overview tab label with a small
      spinner whenever a run is active, visible from any tab.
- [x] 1.4 Verify live: confirmed the spinner CSS actually computes an
      animated circle (see 1.2); the tab-badge poll wired and
      typechecks clean
- [x] 1.5 `npm run typecheck` clean
