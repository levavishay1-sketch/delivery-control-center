## Why

v1 ships only a mock AI executor that fills prompt templates with string
substitution — no model is actually consulted. The product's core promise is
"AI agents execute work"; until a stage is drafted by a real model, the
pipeline is a scripted demo, not a working delivery tool. The `AgentExecutor`
interface was built specifically for this swap.

## What Changes

- Add a real `AgentExecutor` implementation that calls the Claude API
  (`claude-sonnet-5`) using each stage's prompt-template instructions plus
  work-item context, and records the real model, token usage, and cost on
  the stage.
- Select the executor at runtime: use the Claude-backed executor when
  `ANTHROPIC_API_KEY` is configured, otherwise fall back to the existing mock
  executor — the same "configured integration, else safe fallback" pattern
  already used for Jira.
- **BREAKING (internal only, not user-facing):** `src/lib/pipeline.ts` stops
  importing `mockExecutor` directly and goes through a new
  `getAgentExecutor()` selector instead. No API or schema changes.

## Capabilities

### Modified Capabilities
- `ai-drafting`: adds a requirement that a real model executor is used when
  configured, and that drafting still falls back to the mock executor when
  it isn't — both behind the same `AgentExecutor` interface already
  specified.

## Impact

New dependency: `@anthropic-ai/sdk`. New env var: `ANTHROPIC_API_KEY`
(optional; `AI_MODEL` optional override, default `claude-sonnet-5`). Affected
code: `src/lib/agents/` (new `claudeExecutor.ts` + `index.ts` selector),
`src/lib/pipeline.ts` (swap direct `mockExecutor` import for the selector).
No database schema changes — `Stage.aiModel` already records whichever model
produced the draft.
