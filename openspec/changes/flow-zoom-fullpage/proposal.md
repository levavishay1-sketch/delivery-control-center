# Flow: zoom in/out + open full-page / new tab

Status: **done** — shipped and verified live, 2026-09-12.

## Why

The embedded Flow canvas today has zoom explicitly disabled
(`zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}` in
`TaskGraph.tsx`) and only ever renders inside a fixed-height box on the
requirement's own page. For a tree with any real size, there's no way
to see it up close or work with it as its own view.

## What changes

- **Zoom in/out** on the Flow canvas — scroll/pinch zoom plus visible
  +/−/fit-view controls (React Flow's own `Controls` component).
- **Open in a new page/tab** — a dedicated full-page Flow route,
  reachable from a link/button on the existing embedded Flow. On that
  page the canvas fills the available space (not the small embedded
  box), zoom is on, and everything normal still shows: the requirement
  title, the hierarchy/legend, status colors, chips — same content as
  the embedded view, just full-size.
- The embedded, in-context Flow (inside `WorkflowTab`) stays as it is
  today otherwise — zoom is additive there too, but its size and
  placement inside the step doesn't change.

## Explicitly out of scope

- A MiniMap or any other new navigation aid beyond zoom controls —
  not asked for.
- Changing the embedded Flow's fixed heights (340/420) or its position
  in the approve-step layout.

## Impact

- `apps/web/src/screens/TaskGraph.tsx` — a `zoomable` prop (scroll/
  pinch/double-click zoom + `<Controls />`, off by default so the
  embedded views keep today's behavior unless opted in) and a
  `workitemId` prop so the header can link to the full-page route.
- `apps/web/src/screens/FlowFullPage.tsx` (new) — full-page host:
  fetches the requirement title + task flow, renders `TaskGraph` with
  `zoomable` on and a large canvas height.
- `apps/web/src/App.tsx` — new `#/flow/:id` route.
- `apps/web/src/screens/WorkflowTab.tsx` — both `TaskGraph` embeds gain
  `workitemId={wi.id}` so their headers can open the full-page view.

## Exit gate

Scrolling/pinching over the Flow canvas zooms it, with visible +/−/fit
controls. A link on the embedded Flow opens `#/flow/:id` in a new tab:
full-page canvas, zoom on, requirement title, legend, colors, and chips
all present — the same data as the embedded view, not a stripped-down
version.
