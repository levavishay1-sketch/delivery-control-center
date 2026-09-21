# Tasks

## The map

- [x] `packages/core/src/screens/index.ts` — the registry: every place the chat
      may reach, what it answers, and how its route is built from the subject.
      Six to begin with: the four tabs of a pull request, the dashboard and the
      budgets screen.
- [x] `placesFor` narrows the registry to the subject in hand and drops the
      place the person is already standing on; `renderPlaces` is what the model
      is shown. Exported from `@dcc/core`.

## The chat

- [x] A `<goto key="…">` block, beside `<action>` and `<needs_code>`, with the
      rule that it comes before the "not on this screen" marker.
- [x] The block is honoured only when the key is one of the places offered a
      moment earlier; anything else answers in words and is counted unanswered.
- [x] A `navigate` message carries the place, the route and the question, so
      the move is part of the conversation and not a client-side trick.
- [x] One move per question: a question asked again right after a move gets no
      places, is not stored a second time, and is not counted as a re-ask
      (which would otherwise mark the previous answer "לא עזר").

## The screens

- [x] A screen names the place it is (`place`) and says when its facts have
      loaded (`ready`); the chat waits for both before asking there.
- [x] Each tab of a pull request hands over what it shows — the files with
      their status and line counts, the timeline, the branches and their
      advice. The branches fetch moved up to the screen so that the tab and
      the chat read the same data.
- [x] The dashboard and the budgets screen name their places.
- [x] The dock follows a `navigate`: it shows where it is going, moves, waits
      for the screen, and asks the question again there. If the screen never
      loads it says so instead of asking into the void.

## Checked

- [x] `npm run typecheck` and `npx tsc -p apps/web --noEmit` — both clean.
- [x] `npm run audit:stale` — all checks pass.
- [x] End to end against the running API: from the overview of pull request
      #19, "אילו קבצים השתנו בבקשה הזו?" produced a move to the files tab and
      then an answer from that tab's facts — one question in the transcript,
      one move, no second move.
- [x] In the browser, from the overview: "אילו ענפים יש במאגר ומה מצבם?" moved
      the screen to the branches tab and answered with the four real branches
      and what to do with each. No console errors.

## Deliberately not done

- The Claude centre, the requirement and the task screens are not places yet.
  The first registers little more than which tab is open, and the other two
  are single screens with nothing to move between — a place that cannot add
  facts would be a move that answers nothing.
- Moving between subjects (from a requirement to its task, say) is not
  offered: the subject decides the conversation, and a move that changes it
  would leave the person's question in one conversation and its answer in
  another. If it is wanted, that is a change of its own, with a design for
  what happens to the conversation.
