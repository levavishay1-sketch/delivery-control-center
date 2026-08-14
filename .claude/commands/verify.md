---
name: "Verify"
description: "Run this project's verification standard: build, lint, and a targeted live check"
category: "Project"
---

Run the Delivery Control Center verification sequence (see CLAUDE.md's
"Verification standard") against the current change. Do not report success
if any step was skipped or only reasoned about instead of actually run.

1. `npm run build` — must pass with no TypeScript errors.
2. `npm run lint` — must pass with no errors.
3. A targeted **live** check that actually exercises what changed:
   - API/pipeline logic → curl the relevant route(s) against the running
     dev server, or query the dev database directly.
   - UI → start the dev server and check the actual page/flow in a browser.
   - Integration (Jira/Claude) → exercise the real call when credentials
     are configured; otherwise confirm the fallback path still works.
   - If the change touches an error path, trigger that error path for real
     too, not only the happy path.

Report each step's pass/fail plainly. If a step can't be run (e.g. no
credentials configured for a real integration), say so explicitly instead
of silently skipping it.
