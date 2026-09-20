# Gap-letter persistence — tasks

Appetite: **small**. User-reported live bug, fixed same session.

## 1. Persist

- [x] 1.1 New `client_letter.composed` event type (subject, body,
      gapCount, gapIds, costUsd, inputTokens, outputTokens, model)
- [x] 1.2 `composeClientLetter` appends the event right after
      generating — before returning, so a crash in the caller can never
      lose it

## 2. Surface history

- [x] 2.1 `getRecentClientLetters(clientId, workitemId, limit=20)` (core)
      / `GET /workitems/:id/gap-letters` (API) / `getGapLetters` (web)
- [x] 2.2 "📄 מכתבים אחרונים (N)" list in `Record.tsx`'s gaps panel,
      replacing the earlier single-letter "last letter" link
- [x] 2.3 Picking a letter from the list opens the same detail modal a
      freshly-composed one uses, including its own cost line when known
      (older letters composed before this shipped have none — shows a
      neutral "לא ידוע פירוט עלות" instead of a blank/misleading line)

## 3. Verify end to end

- [x] 3.1 Verified live on a throwaway requirement: composed a real
      letter, confirmed it persists across a hard page reload without
      re-running the AI, confirmed it appears in the Timeline tab as a
      distinct, readable event
- [x] 3.2 Verified live against REAL pilot data: the Altshuler Trade
      requirement with 3 real historical letters shows all 3 in the
      list (was silently showing fewer before the related
      the earlier cost-tracking change cache fix — same underlying data, a separate
      frontend bug, documented there)
- [x] 3.3 `npm run typecheck` clean
