# The facts behind the recommendation

**Checked on 2026-09-21** against Anthropic's own documentation only.
Nothing here comes from a third party, and nothing here is written from
memory. When a new model is released, this file is what changes —
`SKILL.md` should not need touching.

Sources are named per section. Two hosts matter: `platform.claude.com`
is the API documentation (`docs.anthropic.com` now redirects there) and
`code.claude.com` is the Claude Code documentation.

## The four models

Positioning sentences are as published on the models overview
(`platform.claude.com/docs/en/docs/about-claude/models/overview`); prices
and context windows are the Anthropic first-party API list.

| | Fable 5.1 | Opus 5 | Sonnet 5 | Haiku 4.5 |
|---|---|---|---|---|
| Id | `claude-fable-5-1` | `claude-opus-5` | `claude-sonnet-5` | `claude-haiku-4-5` |
| For | Demanding reasoning and long-horizon agentic work | Complex agentic coding and enterprise work | The best combination of speed and intelligence | The fastest model with near-frontier intelligence |
| Context | 1M | 1M | 1M | **200K** |
| Max output | 128K | 128K | 128K | 64K |
| Input $/MTok | 10 | 5 | 2 | 1 |
| Output $/MTok | 50 | 25 | 10 | 5 |
| Cache read $/MTok | **0.25** | 0.50 | 0.20 | 0.10 |
| Effort levels | all five | all five | all five | **none** |
| Relative speed | Slower | Moderate | Fast | Fastest |
| Released | Sept 2026 | July 2026 | June 2026 | Oct 2025 |

Cache reads are the standard tenth of the input rate everywhere except
Fable 5.1, where Anthropic cut them to $0.25 — a quarter of what the
tenth would be. **Fable 5.1 reads cache at half of what Opus 5 does.**
In a long session, where most of the input is cache reads rather than
new tokens, that narrows the apparent 2× gap considerably.

Haiku 4.5's two hard limits are easy to forget: a 200K context window,
and no `effort` parameter at all. It uses the older manual extended
thinking instead.

## Which effort level

Source: `platform.claude.com/docs/en/build-with-claude/effort` and
`code.claude.com/docs/en/model-config`.

`high` is the default on every model that accepts effort, and setting
`high` explicitly behaves exactly the same as not setting it. Effort
governs every output token — text, tool calls and thinking alike — so it
applies whether or not thinking is on. It is a behavioural signal, not a
token budget.

| Level | What it is for |
|---|---|
| `low` | Simple tasks wanting speed and the lowest cost; **subagents** |
| `medium` | A balance of speed, cost and quality |
| `high` | Complex reasoning, hard coding, agentic work. The default |
| `xhigh` | Long-horizon agentic and coding work — runs over 30 minutes |
| `max` | The deepest possible reasoning, with no cost ceiling |

Anthropic's own caution on `max`: it adds significant cost for a
relatively small gain on most workloads, and on structured or less
intelligence-sensitive tasks it can lead to overthinking. It is not a
"best" setting.

Two per-model notes worth carrying into a recommendation:

- **Sonnet 5 at `medium` is described as comparable to Sonnet 4.6 at
  `high`.** That makes `medium` the honest cost step-down rather than a
  compromise.
- **Opus 5 converts effort into results more reliably than any earlier
  Opus**, so the level chosen carries more weight — and its `low` and
  `medium` are documented as producing strong quality at a fraction of
  the tokens.

Effort also changes tool behaviour: lower effort gives fewer, terser,
more combined tool calls with no preamble; higher effort gives more
calls, a stated plan and fuller summaries.

## Choosing between the models

Source:
`platform.claude.com/docs/en/docs/about-claude/models/choosing-a-model`,
and the Claude Code guidance at
`claude.com/blog/claude-model-and-effort-level-in-claude-code`
(published 7 July 2026).

The documentation says plainly: **"Tuning effort is often a better lever
than switching models"**, and **"most workloads start with Claude Opus
5"**. The escalation to Fable 5.1 is phrased in terms of *evals* — a
recurring route measured once and then configured. **That framing does
not transfer to a one-off task**, where there is nothing to measure in
advance and a failed run cannot be amortised. For a single task, match
the profile up front instead.

The Claude Code guidance gives the diagnostic this skill is built on:
a smaller model for routine work that can be described precisely, a
larger one for subtle bugs, unfamiliar domains, architecture decisions
and ambiguous requirements — and, when a run fails, ask whether it did
not *try* hard enough (raise effort) or did not *know* enough (raise the
model).

For Fable specifically the documentation adds four instructions:
describe the outcome rather than the steps; hand it ambiguous problems
such as root-cause investigations and architecture decisions; skip the
verification reminders, because it verifies itself; and **"size up
larger tasks — give it work you would normally break into pieces."**

## How large the Fable-over-Opus gap actually is

From the Fable 5.1 announcement (`anthropic.com/claude-fable-and-mythos-5-1`,
September 2026). This is the table that decides whether double the price
is worth paying.

| Benchmark | Fable 5.1 | Opus 5 | Gap |
|---|---|---|---|
| Terminal-Bench 4.0, agentic coding, `max` | 55.8% | 52.3% | 3.5 pts |
| CursorBench 3.2.0, agentic coding, `max` | 73.4% | 70.0% | 3.4 pts |
| AutomationBench, business workflows | 31.4% | 26.9% | 4.5 pts |
| OSWorld 2.0, computer use, strict | 41.7% | 39.6% | 2.1 pts |
| **Terminal-Bench-Science 0.1, `high`** | **52.6%** | **29.0%** | **23.6 pts** |

On ordinary agentic coding the gap is three or four points for twice the
list price. On long-horizon scientific work it is not a gap, it is a
different league. That variance is the whole argument for choosing by
task profile rather than by a ranking.

Anthropic publishes **no SWE-bench Verified score** for any of these four
models; the current generation is reported on the benchmarks above
instead. Sonnet 5's announcement presents cost-performance curves as
images rather than scalars, so no comparable row exists for it, and no
benchmark numbers were retrieved for Haiku 4.5.

## What invalidates the prompt cache

Source: `code.claude.com/docs/en/prompt-caching`. This is what makes a
cascade of model switches expensive, and it is the reason this skill
groups a change into phases.

Each model has its own cache, and on most models so does each effort
level. The next request after either change re-reads the entire
conversation with no cache hits.

| Action | Cache |
|---|---|
| Switching model (`/model`, or a skill's `model:` frontmatter) | Lost |
| Changing effort — except on Fable 5.1 with a key or subscription | Lost |
| Turning on fast mode, once per conversation | Lost |
| `/compact` | Lost, by design |
| Connecting or disconnecting an MCP server, when its tools are not deferred | Lost |
| Invoking a skill or command with no `model:` of its own | **Kept** |
| Spawning a subagent | **Kept** — it builds its own, and leaves the parent's alone |
| Changing permission mode or output style | **Kept** |
| `/rewind` | **Kept** — it truncates back to a prefix already cached |

The documentation's own summary: pick the model and effort at the top of
a session, and save `/compact` for natural breaks.

`opusplan` is worth knowing about: it resolves to Opus during plan mode
and Sonnet during execution. Each toggle is therefore a model switch and
starts a fresh cache — but it needs no decision from the user, which is
usually the better trade.

## Multi-model setups, and what Anthropic says they cost

Source:
`platform.claude.com/docs/en/docs/about-claude/models/optimizing-for-cost-and-intelligence`.

Two documented patterns: an **advisor**, where a cheaper executor
escalates hard decisions to a frontier model, and an
**orchestrator with workers**, where a frontier model plans and delegates
to cheaper ones. Both are measured, and both carry stated caveats:

- **"Delegation often costs 10 to 12 accuracy points."**
- Use one **"only if the single-model effort sweep leaves a measurable
  gap"** — the sweep comes first.
- The baseline to beat is the stronger model alone at `low` effort, not
  the cheaper model alone.
- On work that fits one context window, or that is one dependent chain
  of steps, orchestration was measured as roughly twice the cost for the
  same accuracy.
- The advisor pattern fails quietly when the executor's effort is too
  low: it stops noticing that it is stuck, stops consulting, and can
  score below the executor alone.

Where it does pay, per the same page: capping the cost tail on routine
work, and work genuinely larger than one context window.

In Claude Code, a subagent's model comes from, in order: the invocation,
the agent's own `model:` frontmatter, `CLAUDE_CODE_SUBAGENT_MODEL`, then
the session's model. A subagent may also carry its own `effort:`, and
inherits the session's when it does not. The documented best practice is
a stronger model in the main session and a cheaper one for subagents.

## Fast mode

Source: `code.claude.com/docs/en/fast-mode` and
`platform.claude.com/docs/en/build-with-claude/fast-mode`.

Opus 5 and Opus 4.8 only. Up to 2.5× the output tokens per second at
$10/$50 per MTok — double the base price, which puts fast-mode Opus 5 at
Fable 5.1's list price. **It is the same model with no change to
intelligence**, so it buys latency and nothing else. The gain is in
output speed, not time to first token, so it shows mainly when
streaming. Turning it on costs one uncached re-read of the conversation,
which is why it is cheaper to enable at the start of a session than deep
into one.

## What is not covered here

- Model aliases accepted by `/model`: `default`, `best`, `fable`,
  `opus`, `sonnet`, `haiku`, the `[1m]` context variants, `opusplan`,
  and any full model id.
- `config/model-policy.json` in this repository is a **different thing**
  — it routes DCC's own automated calls to Claude and is edited from the
  control centre. It is not the source for this skill and the two should
  not be merged. As of this date it does not list Fable 5.1, and it
  assigns an effort level to a Haiku capability, which Haiku does not
  accept.
