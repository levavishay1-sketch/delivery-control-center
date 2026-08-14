## Context

See proposal.md - Why. `src/lib/agents/types.ts` already defines the
`AgentExecutor` interface (`executeStage(stageType, context) ->
{content, aiModel, promptTokens, completionTokens, costUsd}`) and
`mockExecutor.ts` implements it by filling the stage's prompt template
directly. `draftStage()` in `src/lib/pipeline.ts` currently calls
`mockExecutor.executeStage(...)` **inside** a `db.$transaction`, which was
fine when the call was synchronous string interpolation but is wrong once
that call becomes a real network request to an external API.

## Goals / Non-Goals

**Goals:**
- A real `AgentExecutor` that calls Claude to draft stage content.
- No change to `src/lib/pipeline.ts`'s public functions, the API routes, or
  the UI — the swap is entirely behind the existing interface plus one new
  selector function.
- A network call to Claude must never happen inside a Postgres transaction.

**Non-Goals:**
- Streaming responses (stage documents are short; a plain non-streaming call
  is simpler and fast enough).
- Tool use, extended thinking, or multi-turn agentic behavior — this is one
  request producing one Markdown document per stage.
- Per-project or per-stage model selection UI. One model, set by env var,
  for all stages.

## Decisions

**Model: `claude-sonnet-5`, not Opus.** Drafting a Constitution/SPEC/Plan/
Tasks/Deploy document from a filled-in prompt template is well-specified
structured writing, not open-ended agentic reasoning — Sonnet-tier quality is
the right fit, at roughly a fifth of Opus's per-token cost, which matters
because every stage draft (and every redraft after a rejection) is a paid
call. Configurable via `AI_MODEL` env var (default `claude-sonnet-5`) rather
than hardcoded, consistent with the project's config-driven principle.

**Prompt construction reuses the existing template split.** Each
`config/prompts/*.md` file already has an "instructions" section (above the
`<!-- OUTPUT TEMPLATE -->` marker) written as an actual LLM prompt, and an
output-template section the mock executor fills textually. The real executor
sends the filled-in instructions section as the user message, with a short
fixed system prompt ("output only the requested Markdown, no preamble, no
code fences around the whole document"). The output-template section is
mock-only and unused by the real executor.

**The Claude call happens outside any database transaction.** `draftStage()`
is restructured to: (1) read the stage and its context in a short read
transaction or plain query, (2) call `getAgentExecutor().executeStage(...)`
with no open transaction, (3) write the result (stage update + audit event)
in a second short transaction. If the Claude call fails, step 3 never runs,
so the stage is left exactly as it was — this preserves the existing
"draftStage only mutates on success" behavior without ever holding a DB
connection open for the duration of an external HTTP call.

**Executor selection mirrors the Jira fallback pattern already in the
codebase.** `src/lib/agents/index.ts` exports `getAgentExecutor()`:
`ANTHROPIC_API_KEY` set → `claudeExecutor`, otherwise → `mockExecutor`. Same
shape as `src/lib/integrations/index.ts` picking Jira vs. manual. This means
the app keeps working with zero configuration (mock), and picks up real
drafting the moment a key is added — no code change, no flag to flip.

**Cost is computed from real `usage.input_tokens` / `usage.output_tokens`**
returned on the response, multiplied by fixed per-token constants for
`claude-sonnet-5` list pricing ($3 / $15 per million tokens). This is an
approximation (it doesn't account for prompt-caching discounts or
intro pricing) but it's the same order of precision the mock executor's
fake cost already had, and it's clearly derived from real usage rather than
invented.

**Alternative considered: call Claude inside the existing single
transaction, accept the held connection.** Rejected — Neon's free tier has a
small connection pool, and a slow or rate-limited Claude call holding a
transaction open risks starving other requests. The two-step approach costs
one extra short query but removes that risk entirely.

## Risks / Trade-offs

- [Claude API call fails (rate limit, invalid key, network error)] →
  `executeStage` throws before any write happens; `draftStage` propagates
  the error, the existing API route already returns it as a 409 with the
  message, and the UI's `DraftButton` already renders fetch errors. No new
  error-handling path needed.
- [Real costs are approximate, not exact] → documented in the code comment
  and this design doc; acceptable for an audit-trail cost *estimate*, not a
  billing system.
- [`ANTHROPIC_API_KEY` accidentally unset in an environment that expects
  real drafting] → silent fallback to the mock executor could surprise
  someone. Mitigated by `aiModel` being recorded on every stage and shown in
  the UI, so mock vs. real is always visible after the fact
  (`mock-agent-v1` vs. `claude-sonnet-5`).
