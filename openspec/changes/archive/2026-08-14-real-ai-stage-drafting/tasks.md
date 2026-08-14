## 1. Claude executor

- [x] 1.1 Install `@anthropic-ai/sdk`
- [x] 1.2 Add `ANTHROPIC_API_KEY` and `AI_MODEL` to `.env` / `.env.example` (optional, documented)
- [x] 1.3 Implement `src/lib/agents/claudeExecutor.ts`: splits the prompt template into instructions/output-template (reuse `extractOutputTemplate` split point), fills instructions with work-item context, calls `client.messages.create` non-streaming with a fixed system prompt, returns `{content, aiModel, promptTokens, completionTokens, costUsd}` from `response.usage`
- [x] 1.4 Add `claude-sonnet-5` pricing constants and a cost calculation helper

## 2. Executor selection

- [x] 2.1 Implement `src/lib/agents/index.ts` exporting `getAgentExecutor()`: `claudeExecutor` when `ANTHROPIC_API_KEY` is set, else `mockExecutor`
- [x] 2.2 Update `src/lib/pipeline.ts` to import `getAgentExecutor` instead of `mockExecutor` directly

## 3. Move the model call outside the DB transaction

- [x] 3.1 Restructure `draftStage()` in `src/lib/pipeline.ts`: read stage + pipeline context, call the executor with no open transaction, then persist the result + audit event in a short transaction
- [x] 3.2 Confirm a thrown error from the executor leaves the stage and pipeline state unchanged (no partial writes) — verified live: a real request with an unfunded API key failed with a billing error from Anthropic, and the pipeline/stage were confirmed still ACTIVE/PENDING afterward, no partial writes

## 4. Verify

- [x] 4.1 `npm run build` passes
- [x] 4.2 With no `ANTHROPIC_API_KEY` set, draft a stage and confirm it still works via the mock executor (`aiModel: "mock-agent-v1"`) — verified live
- [ ] 4.3 With `ANTHROPIC_API_KEY` set, draft a stage and confirm real Markdown content comes back with `aiModel: "claude-sonnet-5"` and real, non-fake token counts and cost — blocked: the provided key authenticated successfully (request reached Anthropic) but the account has no billing credit. Code path is implemented and the auth+request path is confirmed reachable; re-run once credits are added.
- [ ] 4.4 Confirm the audit trail still records the AI-drafted event correctly for a real draft — blocked on the same billing issue as 4.3
