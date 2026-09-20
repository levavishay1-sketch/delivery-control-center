# Onboarding assistant — tasks

Appetite: **medium**.

## 0. Replace the earlier reading aid

- [x] 0.1 Delete the earlier Hebrew reading aid (panel, endpoint, capability, cost line, styles, its OpenSpec change); sweep the repo for its names and add them to the retired list in `scripts/audit-stale.mjs`

## 1. Core  ·  `@dcc/core`

- [x] 1.1 `runClaudeRaw`: a lean, resumable, read-only mode (own system prompt file, chosen tools, `--session-id`/`--resume`, extra readable folders, extra env)
- [x] 1.2 `transcript.ts`: `digestTranscript(file, cursor)` (compact digest of new entries, pending tool call noted) and `sessionIdle(file)`
- [x] 1.3 Routing capability `onboarding_assistant` + `config/model-policy.json`
- [x] 1.4 `assistant.ts`: conversation store (session id, cursor, hashes, messages) under the run's runtime folder; `askAssistant` builds the delta message and parses a `<send>` proposal; `sendToSession` checks live + idle, writes a bracketed paste + Enter under the person's name, records an event; `resetAssistant`
- [x] 1.5 Cost totals on the run session (`assistant`) and in the run view; event label

## 2. API  ·  `apps/api`

- [x] 2.1 `GET/POST/DELETE …/assistant`, `POST …/assistant/send`

## 3. Screen  ·  `apps/web`

- [x] 3.1 Assistant panel under the terminal: ready questions, free question, Hebrew answers (commands as left-to-right chips), "שיחה חדשה"
- [x] 3.2 Instruction card: editable English text, "שלח לסשן", busy confirmation, sent state
- [x] 3.3 Cost card line for the assistant; the terminal hands its screen text to the panel

## 4. Verification

- [x] 4.1 `tsc -b` clean, `npm run audit:stale` green
- [x] 4.2 Real questions answered from a real transcript through the UI. Measured (Sonnet 5): the first question ~$0.064 (it writes the ~14k-token context to the cache, plus a small background Haiku call); follow-ups ~$0.005 with nothing new and ~$0.02 with new session activity and a changed screen. Note: `total_cost_usd` of a resumed conversation is cumulative, so DCC records the difference from the last call, not the figure itself.
- [ ] 4.3 Sending: a bracketed paste + Enter reaches a real Claude Code session — **not verified.** Two scratch harnesses (a raw PTY without a terminal emulator) never got even plain typed text + Enter submitted, so they prove nothing about DCC's path, which is the same PTY write the person's own typing already uses. DCC therefore checks the result itself: after sending it looks for the message in the transcript for ~6 s and the card says "sent, but I did not see the session receive it" if it is not there.

## 5. Found while verifying

- The first answer wrongly called the `bin/roslyn/` files "committed by mistake": the file list it was given showed untracked files as ordinary changes. The summary it gets now separates files git tracks from files it does not track yet, and says untracked ones are in no commit (and that DCC's delivery, `git add -A`, would add them). The same question then got the right answer.
- Building that list read every untracked file to count its lines (hundreds of build DLLs); the assistant's summary uses git only and groups untracked files by folder.
- A test through `curl` in Git Bash sent Hebrew as `?` (console code page) — a harness artifact; the browser sends UTF-8.
