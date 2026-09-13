# Flow zoom + full-page — tasks

Appetite: **small**.

- [x] 1.1 `TaskGraph.tsx`: `zoomable` prop — enables
      `zoomOnScroll`/`zoomOnPinch`/`zoomOnDoubleClick` and renders
      React Flow's `<Controls />`; default stays off (embedded views
      unchanged unless opted in)
- [x] 1.2 `TaskGraph.tsx`: `workitemId` prop + a header link/button
      "⤢ פתח במסך מלא" (opens `#/flow/:workitemId` in a new tab), shown
      only when a title/subtitle header is already rendered
- [x] 1.3 `FlowFullPage.tsx` (new): fetches requirement title
      (`getDetail`) + task flow (`getTaskFlow`), renders `TaskGraph`
      with `zoomable` on, a large canvas height, and a back-link to the
      requirement
- [x] 1.4 `App.tsx`: `#/flow/:id` route
- [x] 1.5 `WorkflowTab.tsx`: both `TaskGraph` embeds get
      `workitemId={wi.id}` — found and fixed a bonus pre-existing gap
      while at it: the SECOND embed (the approve-step's full hierarchy
      view) was missing `onToggleActive`/`togglingActiveId` entirely,
      so deactivate/reactivate from that view's popup silently did
      nothing; now wired the same as the first embed
- [x] 1.6 Verify live: opened the full-page view, confirmed title +
      legend + colors + chips all render; clicked the zoom-in control
      twice and confirmed the canvas visibly zoomed
- [x] 1.7 `npm run typecheck` clean
