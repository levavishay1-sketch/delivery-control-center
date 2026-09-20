# Requirement retro recommendations — tasks

Appetite: **standard**. Blocked on the earlier cost-tracking change and
`decision-history` shipping first — both done.

## 1. Analysis

- [x] 1.1 Prompt that assembles a requirement's full timeline + cost
      records + decision-history reasons and asks for structured
      recommendations (token savings, time savings, unnecessary
      actions, rework-causing decisions, breakdown-quality feedback) —
      `buildRetroPrompt`/`runRetro` in `packages/core/src/ai-assist.ts`.
      Deliberately read-only (no repo checkout, `plan` permission mode
      only) — this is a report action, not a code-touching one.
- [x] 1.2 Store the recommendations result — reuses the existing
      `flow_run` table/mechanism (same durable-background-job pattern as
      assess/breakdown/implement), with `kind = "retro"`. Deliberately
      given its OWN lookup (`getRetroRunView`, filtered to
      `kind = "retro"`) and its OWN routes (`POST`/`GET
      /workitems/:id/retro`) rather than reusing the generic
      `getFlowRunView`/`/workitems/:id/flow-run` that
      assess/breakdown/implement share — a retro can run long after
      those are done, and must never be mistaken for "the latest run"
      by a screen (`WorkflowTab.tsx`) still polling that generic
      endpoint.

## 2. UI

- [x] 2.1 "✦ המלצות לשיפור" button, shown once a requirement is done
      (`wi.phase === "done"`) — `Record.tsx` header, next to עריכה/מחיקה.
- [x] 2.2 Recommendations view — `RetroModal` in `Record.tsx`: idle state
      offers "הרץ ניתוח", running state polls every 2s with a spinner,
      done state renders the summary plus each non-empty category as a
      labeled, colored bullet list (rework-causing decisions/unnecessary
      actions/token+time savings in a warning tone, what-went-well in a
      healthy tone) — never renders an empty category. A "↻ הרץ ניתוח
      מחדש" re-run is always available.

## 3. Verify end to end

- [~] 3.1 The full plumbing was verified live on a throwaway test
      requirement (Altshuler Trade pilot, deleted after): created →
      phase set to `done` → "✦ המלצות לשיפור" button appeared → opened
      the modal → confirmed the idle state, explanatory copy, and "הרץ
      ניתוח" button render correctly. Deliberately did NOT click "הרץ
      ניתוח" — that spawns a real, costed `claude -p` call, and this
      session's standing rule (also applied in
      `compiled-components-call-graph`, the earlier cost-tracking change) is to never
      trigger one purely to test a feature without being explicitly
      asked. So: the kick-off/poll/render machinery is verified: the
      actual quality of the recommendations Claude produces against a
      real, non-trivial requirement's history is NOT yet verified —
      someone should run this for real on a requirement with actual
      cost/decision data the first time it's used, and sanity-check that
      the recommendations are genuinely specific rather than generic.
- [x] 3.2 `npm run typecheck` clean
