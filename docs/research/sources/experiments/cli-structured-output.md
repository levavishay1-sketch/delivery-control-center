# Claude CLI structured output vs DCC's regex extraction — a read-only experiment

Date: 2026-09-27. Environment: claude.ai cloud container (Linux), `claude` CLI **2.1.283** at `/opt/node22/bin/claude`,
model `claude-sonnet-5` for every run, cwd `/home/user/altshuler_trade` (a client repository clone, untouched).
Raw outputs, prompts, the schema and the analysis scripts are in `experiments/cli/` next to this file.
Total model spend across all runs: **$0.806** (A $0.357 + B $0.231 + C $0 + C-control $0.039 + D $0.179).

Question: would the CLI's built-in structured output (`--json-schema`) and `--bare` mode be a more reliable base than
DCC's regex extraction (`runClaudeJson`) on this CLI version, in this environment?

## 1. Results

| Run | Flags (all `-p`, prompt on stdin, `--model claude-sonnet-5`) | Exit | `structured_output` present & schema-valid? | DCC regex parse of `result` ok? | `total_cost_usd` | `duration_ms` (api / wall) | `num_turns` | `is_error` / error field |
|---|---|---|---|---|---|---|---|---|
| **A — structured** | `--max-turns 8 --allowedTools "Read,Grep,Glob" --output-format json --max-budget-usd 0.60 --json-schema "$(cat gaps.schema.json)"` | 0 | **yes / yes** (4 gaps; every check passes; `additionalProperties:false` respected) | **yes** — `result` is the bare JSON string, no fences, no prose; parsed value is byte-identical to `structured_output` | **0.3574** | 98,976 (94,659 / 100,912) | 13 | false / none (`subtype:"success"`, `permission_denials:[]`, `stop_reason:"tool_use"`) |
| **B — plain** | same, without `--json-schema`; prompt + "השב אך ורק ב-JSON תקין לפי המבנה: {gaps:[…]}" | 0 | field absent (n/a) | **yes** — `result` = ```` ```json\n{…}\n``` ```` (8 chars of fence before, 4 after, no prose); raw `JSON.parse(result)` **fails**; after DCC's fence regex it parses and also passes the same manual schema checks (4 gaps) | **0.2311** | 83,517 (81,223 / 85,347) | 13 | false / none (`stop_reason:"end_turn"`) |
| **C — `--bare` probe** | `--bare --max-turns 1 --output-format stream-json --verbose`, prompt "Reply with the single word OK." | **1** | n/a | n/a | 0 | 74 (0 / 985) | 1 | **`is_error:true`** with `subtype:"success"`; `result:"Authentication error · This may be a temporary network issue, please try again"`; stderr empty |
| C-control (no `--bare`, same otherwise) | `--max-turns 1 --output-format stream-json --verbose` | 0 | n/a | n/a | 0.0389 | 2,264 (1,501 / 4,132) | 1 | false; `result:"OK"` |
| **D — schema on stream-json** (DCC's real output format) | `--max-turns 3 --allowedTools "Glob" --output-format stream-json --verbose --max-budget-usd 0.20 --json-schema '{found:boolean, path?:string}'`, prompt "Is there a file named SmsBL.cs …? Use Glob once, then answer." | 0 | **yes / yes** (`{"found":true,"path":"BusinessLogicLayer/Crm/Alt.BusinessLogicLayer.Crm.External/SmsBL.cs"}`) | yes — `result` string is the same JSON | 0.1787 | 4,947 (— / 6,773) | 3 | false; `stop_reason:"tool_use"` |

Token usage (from the `usage` object): A — cache write 64,203, cache read 191,603, output 6,221 (1,999 thinking);
B — cache write 32,728, cache read 258,428, output 4,851 (1,284 thinking); C-control — cache write 8,141, cache read 31,630,
output 4 (a one-word answer still loads ~40k tokens of context in non-bare mode).

`--max-budget-usd` was added as a spend guard (not part of the requested flag set); it never triggered.
`num_turns` reports 13 for both A and B although `--max-turns 8` was passed — the field evidently counts assistant *and*
tool-result messages, i.e. it is not the same unit as `--max-turns` (n=1, not verified further).

Validation was done with a hand-written checker (`experiments/cli/analyze-ab.mjs`): root object with only `gaps`; `gaps` an array
of at most 4; each item has exactly `question:string`, `blocking:boolean`, `whoAnswers ∈ {client,team}`, `options:string[]`,
`impactIfWrong:string`. No packages were installed.

## 2. How `runClaudeJson` extracts JSON today

`/home/user/delivery-control-center/packages/core/src/ai-assist.ts`, lines 590–603 (verbatim):

```ts
/** Run `claude -p` in `cwd` (prompt via stdin), expect a single JSON object back. */
async function runClaudeJson<T>(cwd: string, prompt: string, opts: RunClaudeOpts): Promise<T> {
  const { text } = await runClaudeRaw(cwd, prompt, opts);
  // pull the JSON object/array out of whatever the model wrapped it in
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, text];
  const jsonText = (m[1] ?? text).trim();
  const start = jsonText.search(/[[{]/);
  if (start < 0) throw new Error(`no JSON in claude output: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(jsonText.slice(start)) as T;
  } catch (e) {
    throw new Error(`could not parse claude JSON (${(e as Error).message}): ${jsonText.slice(0, 300)}`);
  }
}
```

In words: `runClaudeRaw` spawns `claude -p --output-format stream-json --verbose --permission-mode acceptEdits
--allowed-tools Read,Grep,Glob[,Bash] --max-turns N --model M --effort E […]` (lines 424–441), takes the **last** NDJSON line
containing `"type":"result"`, parses it, and uses its `result` string as `text` (a non-zero exit code or `is_error:true` throws
first). `runClaudeJson` then (1) takes the contents of the **first** ```` ``` ```` / ```` ```json ```` fenced block if any, otherwise
the whole text; (2) trims it; (3) cuts everything before the **first** `[` or `{`; (4) `JSON.parse`s the rest. Nothing cuts trailing
text after the closing brace, so prose after the JSON (outside a fence) fails at step 4; a `[`/`{` inside prose before the real JSON
also fails; the first fence wins even if it is not the JSON one. No schema validation happens — the parsed value is cast to `T`.
Seven references to `runClaudeJson` exist in `packages/core/src`. (Side note: the comment at line 415 still names
`extractFencedBlock`, a helper that no longer exists.)

DCC's research notes (`docs/research/sources/world-code-architecture.md` §184–191) already cite `--json-schema`, `structured_output`
and `--bare` from the official docs, but no DCC code passes either flag today.

## 3. `--bare` findings (Run C vs control)

- **The flag is accepted** on 2.1.283 (no usage error, a `system/init` event is emitted) but **the run cannot authenticate in this
  environment**: `claude --help` says `--bare` auth "is strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings (OAuth and keychain
  are never read)". Here the CLI is authenticated by the host (`CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1`, `apiKeySource:"none"` in
  both init events, no `ANTHROPIC_API_KEY` in the environment), so `--bare` produced a synthetic assistant message "Authentication
  error · …", a result line with **`is_error:true` but `subtype:"success"`**, cost 0, and **exit code 1** — all in under a second.
  Help text (verbatim): "Minimal mode: skip hooks (those defined in settings and by installed plugins; features built into Claude
  Code are unaffected), LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, and CLAUDE.md
  auto-discovery. Sets CLAUDE_CODE_SIMPLE=1. […] Skills still resolve via /skill-name."
- **What the `init` event reported** (before the auth failure), `--bare` vs control:
  `tools` 3 (`Bash, Edit, Read`) vs 39 (Task, Artifact*, Web*, Write, Skill, Monitor, …); `slash_commands` 50 vs 62;
  `skills` 18 vs 30 (the user-level ones such as `session-start-hook`, `slides`, `artifact-capabilities` are gone under `--bare`);
  `mcp_servers` `[]` in both; `plugins` the same two builtins (`agents-md`, `telemetry`) in both; `agents` the same 6 in both;
  `startup_timing.settings_load_ms: 0` under `--bare`. The control also emitted a `system/commands_changed` event listing 62
  commands with `(user)` sources; `--bare` emitted none. Hooks are not visible in the stream, so "hooks skipped" rests on the
  help text, not on observation.
- The client repository has an **empty `.claude/` directory, no `CLAUDE.md` and no `.mcp.json`**, so the project-level skipping that
  matters most for DCC (a cloned third-party repo's hooks and MCP servers running without a trust dialog) could not be observed here.

## 4. Conclusions (n = 1 per run — directional, not statistical)

1. **`--json-schema` works on this CLI version, including on DCC's real `stream-json` path, and it is strictly additive.** The
   schema is enforced through a `StructuredOutput` tool call (visible as an `assistant` tool_use event, answered by
   "Structured output provided successfully"); the final `result` event carries a parsed `structured_output` object **and** the same
   JSON as the `result` string, with no fences. So DCC could pass `--json-schema`, read `structured_output` when present, and keep
   the regex as the fallback — the existing extraction returned a byte-identical value on Run A, so nothing breaks during a migration.
2. **The regex is not broken today, but it is unvalidated.** Run B shows exactly the wrapping it exists for (a ```` ```json ````
   fence, which defeats raw `JSON.parse`) and it handled it. What it cannot do is reject a well-formed object with the wrong shape
   (`blocking:"yes"`, a fifth gap, an extra key): DCC casts to `T` and trusts it. With `--json-schema` the CLI re-prompts on a
   mismatch and reports exhaustion as `is_error` (`error_max_structured_output_retries` per the docs — not exercised here), which
   moves shape errors from silent runtime surprises to one explicit failure code. The `additionalProperties:false` / `enum` /
   `maxItems` constraints were all honoured in A and D.
3. **Cost and time were higher with the schema in this single pair** (A $0.357 / 99 s vs B $0.231 / 84 s; +$0.13, +15 s, +64k
   cache-write tokens). The two runs also read different files, so most of that gap is run-to-run variance in an 8-turn code
   exploration, not a measured price of structured output; the extra `StructuredOutput` turn itself is one short tool call.
   A budget decision needs a few repeats, not this pair.
4. **`--bare` is not usable here without an API key**, so it cannot be recommended as DCC's base in a host-authenticated
   environment; where DCC runs with `ANTHROPIC_API_KEY` (or an `apiKeyHelper` in `--settings`) it is worth re-testing, because it
   is the mode that skips a cloned repo's hooks/CLAUDE.md/MCP auto-discovery and the ~40k tokens of user context that even a
   one-word reply paid for in the control ($0.039). DCC's existing `lean` flag set (`--system-prompt-file`, `--tools`,
   `--disable-slash-commands`, `--strict-mcp-config`, `--setting-sources local`) already removes most of that overhead
   without changing the auth path, so it is the safer lever today.
5. **Failure semantics to keep in mind:** a failed run can have `subtype:"success"` and `is_error:true` at once (Run C) —
   `runClaudeRaw`'s `is_error` check is the right one; the process also exited 1 there, so the `code !== 0` branch fires first.
   With a schema, the final `stop_reason` is `tool_use`, not `end_turn`, and the model may put its prose in an earlier `assistant`
   message (Run D did), which `result` drops but `assistantTexts()` keeps.
6. **Environment caveats:** every nested run reported `session_id` equal to the parent session's `CLAUDE_CODE_SESSION_ID`
   (`b2470b29-…`), i.e. the CLI inherits that variable from the environment — a DCC process started from inside a Claude Code
   session (for example via `.claude/launch.json`) should scrub it before spawning, or its children may attach to the wrong session.
   Hebrew prompts and Hebrew field values caused no encoding trouble in any run. Numbers are from one run each on one machine;
   the CLI version here (2.1.283) is newer than the host session's own binary (env `CLAUDE_CODE_VERSION=2.1.42`).

## 5. Exact commands

All from `cd /home/user/altshuler_trade`; `$S` = `experiments/cli` in the scratchpad. Prompts were piped on stdin from the saved
files (`prompt-A.txt`, `prompt-B.txt`). Exit codes and wall time were captured as `echo "exit=$? wall_ms=…" > $S/run-X.exit`.

```bash
# help.txt
claude --version
claude --help | grep -inE 'bare|json-schema|output-format|permission-prompt|resume'

# Run A — structured
claude -p --model claude-sonnet-5 --max-turns 8 --allowedTools "Read,Grep,Glob" --output-format json \
  --max-budget-usd 0.60 --json-schema "$(cat $S/gaps.schema.json)" < $S/prompt-A.txt > $S/run-A.json 2> $S/run-A.stderr

# Run B — plain (prompt-B.txt = prompt-A.txt + the "השב אך ורק ב-JSON תקין…" sentence)
claude -p --model claude-sonnet-5 --max-turns 8 --allowedTools "Read,Grep,Glob" --output-format json \
  --max-budget-usd 0.60 < $S/prompt-B.txt > $S/run-B.json 2> $S/run-B.stderr

# Run C — --bare probe, and its control without --bare
printf 'Reply with the single word OK.' | claude -p --bare --model claude-sonnet-5 --max-turns 1 \
  --output-format stream-json --verbose > $S/run-C.jsonl 2> $S/run-C.stderr
printf 'Reply with the single word OK.' | claude -p --model claude-sonnet-5 --max-turns 1 \
  --output-format stream-json --verbose > $S/run-C-control-nobare.jsonl 2> $S/run-C-control-nobare.stderr

# Run D — schema on stream-json (DCC's output format)
printf 'Is there a file named SmsBL.cs anywhere in this repository? Use Glob once, then answer.' | \
  claude -p --model claude-sonnet-5 --max-turns 3 --allowedTools "Glob" --output-format stream-json --verbose \
  --max-budget-usd 0.20 --json-schema '{"type":"object","properties":{"found":{"type":"boolean"},"path":{"type":"string"}},"required":["found"],"additionalProperties":false}' \
  > $S/run-D-streamjson-schema.jsonl 2> $S/run-D-streamjson-schema.stderr

# analysis (plain Node, no packages)
node $S/analyze-ab.mjs $S   # → analysis-AB.txt: schema validation of A, DCC regex on A and B, fence/prose shape
node $S/analyze-c.mjs  $S   # → analysis-C.txt: init/result events of C and the control
```

Prompt A (stdin, verbatim): דרישה חדשה: הודעות SMS יוצאות ללקוח חייבות לכבד 'שעות מותרות' שהלקוח מגדיר. קרא את הקוד הרלוונטי (חפש SMS, HandleSmsSendStatus, SmsBL) ורשום עד 4 פערים בדרישה — שאלות שחייבות תשובה לפני פיתוח — כל אחת עם האם היא חוסמת, מי עונה (client/team), אפשרויות תשובה, ומה קורה אם טועים.

Prompt B adds: השב אך ורק ב-JSON תקין לפי המבנה: {gaps:[{question,blocking,whoAnswers,options,impactIfWrong}]}
