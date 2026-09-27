# Repository onboarding for AI agents — what the world does and knows (as of 2026-09-27)

Research brief for the DCC onboarding design. Follow-up to the internal research of 2026-09-23
(Gloaguen et al. / ETH Zurich–LogicStar, arXiv:2602.11988, and the "Khatri, 288 runs" study).

**Evidence grades.** [A] controlled study, or a vendor's official docs/announcement about its own
product · [B] observational study, benchmark, or large-corpus mining · [C] practitioner report,
community write-up, single-team case. When the primary page was blocked by the network proxy and
the content came through a search-engine summary or a secondary mirror, the grade carries the
suffix "via summary" / "via mirror" and the primary URL is still given.

**Blocked domains (could not be fetched; content taken from search summaries, GitHub mirrors of the
docs source, or citing repositories):** arxiv.org (all mirrors too), medium.com, cursor.com,
forum.cursor.com, docs.github.com, github.blog, code.visualstudio.com, developers.openai.com,
openai.com, docs.devin.ai, cognition.com, deepwiki.com, kiro.dev, factory.ai, docs.factory.ai,
antigravity.google, jules.google, docs.windsurf.com, greptile.com, augmentcode.com, agentskills.io,
agents.md, linuxfoundation.org, aaif.io, infoq.com, simonwillison.net, dev.to, huggingface.co,
semanticscholar.org, openreview.net, wikipedia.org, aider.chat. Reachable: code.claude.com,
claude.com, anthropic.com, raw.githubusercontent.com, gist.github.com, the GitHub code-search API.
Note: the WebSearch budget of this session was exhausted after the first two rounds, so the second
half of the research was done through direct fetches and GitHub code search only.

---

## 0. The short version

1. The two studies from the 2026-09-23 brief are still the strongest controlled evidence, and they
   have been **corroborated, not contradicted**, by three newer controlled/large-N studies: Khatri
   (Jul 2026, 288 runs, Claude Code + Codex: context strategy "does not measurably move
   correctness"), McMillan (May 2026, 1,650 sessions: file size, instruction position, file
   architecture and contradictions produce **no detectable effect** on rule-following; the only
   effect found is *within-session decay* of compliance), and SWE-Skills-Bench (Mar 2026, 565 tasks:
   39 of 49 public skills give zero gain, +1.2 % on average, token overhead up to +451 %, three
   skills hurt). One earlier study (Li et al., Jan 2026) found the opposite sign on *cost*
   (−28.6 % time, −16.5 % tokens with a lean human-written AGENTS.md), so the honest reading is:
   **a small, human-reviewed, non-inferable file is neutral-to-positive; a generated or verbose
   file is neutral-to-negative; nothing in the literature shows large correctness gains from
   instruction files alone.**
2. Every vendor now ships an **automatic generator** (Claude Code `/init`, Codex `/init`, Gemini
   CLI `/init`, Copilot "generate copilot-instructions.md" as a reviewed PR, Kiro "Generate
   Steering Docs", Cursor "/Generate Cursor Rules"), and every vendor's own guidance says the
   generated file must be **short, reviewed, and pruned** (Anthropic: <200 lines, "would removing
   this cause Claude to make mistakes? If not, cut it"; GitHub: "no longer than 2 pages", "not
   task specific"; VS Code: "~20–50 concise lines").
3. Anthropic's interactive `/init` (`CLAUDE_CODE_NEW_INIT=1`, research preview since ~March 2026)
   is an eight-phase flow: preferences → codebase survey by a subagent → *interview to fill gaps* →
   CLAUDE.md → CLAUDE.local.md → skills → hooks/plugins → prioritized next steps. Its inclusion
   rule is "only include what Claude would get wrong without it". The flag is on by default for
   Anthropic staff (`USER_TYPE === 'ant'`), which signals it is the intended future default.
   Design assumption for DCC: **`/init` will keep improving, but it stays a one-shot, per-machine,
   CLAUDE.md-centric bootstrap with no measurement, no multi-tool output, and (open bug #97004,
   2026-09-25) it still writes a CLAUDE.md even where the repo already relies on AGENTS.md.**
4. The measurement layer that did not exist in spring 2026 now exists inside Claude Code:
   `claude plugin eval` (with/without-plugin baseline, Δ, 3 runs per case, CI gating, pinned
   models), `/skill-doctor` (unused skills vs. context cost), `/doctor` (trims checked-in
   CLAUDE.md, `prompt-audit` for instructions written for older models, "reports findings first
   and asks for confirmation"), `/insights` (where sessions go wrong), `/usage` attribution and
   OpenTelemetry events per skill/plugin/MCP/repository. **DCC should build readiness measurement
   on these primitives rather than invent its own harness.**
5. Continuous learning after onboarding is converging on one pattern across vendors: **the tool
   observes sessions, proposes a change, a human approves, and the artifact lives in git**
   (Copilot `/chronicle improve` with per-suggestion toggles; Copilot Memory with just-in-time
   verification against the current branch and 28-day expiry; Devin "I'll sometimes suggest
   knowledge after a session — review and approve"; Anthropic's stop-hook-proposes-CLAUDE.md-edits
   pattern; Claude Code's `propose_skills` review card). Unreviewed, machine-local memories
   (Claude auto memory, Cursor/Windsurf memories) are the other branch, and are explicitly *not*
   shared with the team.
6. The strongest new argument for a **deterministic setup layer**: a 10,008-repo study (Jun 2026)
   found agent config files are unmanaged (10.1 % byte-identical duplicates across repos, 58 %
   never revised after the first commit, <1 % declare permission boundaries); a 481-file study
   found only ~4 % of natural-language security rules in CLAUDE.md are backed by an enforced
   control; and a 100-repo study found "init fossilization" (stale generated text never reviewed)
   in 24 % of AGENTS.md files. Anthropic's own docs: instructions are advisory, hooks are
   enforcement; "if a rule must hold every time, make it a hook rather than a prompt instruction."

---

## 1. Claude Code today (September 2026, v2.1.283)

### 1.1 `/init` — standard and interactive

* Official description [A]: "Initialize project with a `CLAUDE.md` guide. Set
  `CLAUDE_CODE_NEW_INIT=1` for an interactive flow that also walks through skills, hooks, and
  personal memory files. If `/init` finds OpenAI Codex or Google Gemini CLI configuration, it
  offers to carry it over with `/import`." — https://code.claude.com/docs/en/commands
* What `/init` reads from other tools [A]: Cursor rules (`.cursor/rules/`, `.cursorrules`) and
  Copilot (`.github/copilot-instructions.md`); with the new flag also `AGENTS.md`,
  `.devin/rules/`, `.windsurf/rules/` or `.windsurfrules`, and `.clinerules`. `/import` (v2.1.213+;
  Cursor from v2.1.265) appends a one-time copy of instruction files and carries over MCP servers,
  commands, subagents and skills. — https://code.claude.com/docs/en/memory
* The interactive flow, from the publicly mirrored Claude Code source (`src/commands/init.ts`,
  `NEW_INIT_PROMPT`) [B, mirror of leaked source; matches the docs]:
  1. **Preferences**: project `CLAUDE.md` (team), personal `CLAUDE.local.md` (private, gitignored),
     or both; whether to include skills and/or hooks.
  2. **Codebase survey by a subagent**: manifests, README, build configs, CI, existing tool
     configs; detects "build, test, and lint commands (especially non-standard ones)", languages,
     frameworks, structure, style rules, gotchas, formatter configuration.
  3. **Gap-filling interview** for what the code cannot reveal — "Only include what Claude would
     get wrong without it."
  4. **CLAUDE.md** with the test "Would removing this cause Claude to make mistakes? If no, cut
     it." Includes build/test/lint commands, style that differs from defaults, testing quirks, repo
     etiquette, required env vars, gotchas. Excludes file-by-file structure, standard conventions,
     generic advice, frequently-changing information.
  5. **CLAUDE.local.md**: role, familiarity, sandbox URLs, communication preferences.
  6.–7. **Skills and hooks** proposed and created; suggests `gh`, linting/formatter integration,
     plugins.
  8. **Summary and prioritized recommendations.**
  The gate is `process.env.USER_TYPE === 'ant' || CLAUDE_CODE_NEW_INIT`, i.e. default for
  Anthropic employees — a strong hint it becomes the default `/init`.
  https://raw.githubusercontent.com/chauncygu/collection-claude-code-source-code/main/original-source-code/src/commands/init.ts
* Known limits today [B, GitHub issues]:
  * #97004 (2026-09-25): "/init writes CLAUDE.md in an AGENTS.md project, silently disabling the
    instructions it just read" — both prompt variants target CLAUDE.md; AGENTS.md is only a
    *source*. https://github.com/anthropics/claude-code/issues/97004
  * The model can itself invoke `/init` through the Skill tool since v2.1.108 (changelog) [A].
  * No measurement step, no multi-tool output (no AGENTS.md/Copilot/Cursor files), per-machine.
* Related first-party commands that overlap an onboarding product [A, changelog + docs]:
  * `/doctor` (v2.1.205 "full setup checkup"): dedups local vs. checked-in CLAUDE.md, **trims a
    checked-in CLAUDE.md "by cutting content Claude could derive from the codebase, such as
    directory layouts, dependency lists, and architecture overviews, and keeps pitfalls, rationale,
    and conventions that differ from tool defaults"** (v2.1.206), migrates always-loaded guidance
    into skills and nested CLAUDE.md files, finds unused skills/MCP/plugins vs. their context cost,
    flags slow hooks, offers auto mode and pre-approval of read-only commands. "Reports findings
    first and asks for confirmation before changing anything."
  * `/doctor prompt-audit` (v2.1.283, Sept 2026): "audit your CLAUDE.md files, skills, agents and
    commands for prompting patterns written for older models"; "stale paths, stale commands and
    contradicting instruction files now lead the report"; proposes fixes as a diff.
  * `/skill-doctor` (v2.1.261): which loaded skills go unused and what they cost in context.
  * `/fewer-permission-prompts` (v2.1.111): scans transcripts, writes a prioritized allowlist into
    project `.claude/settings.json`.
  * `/insights`: HTML report on up to 200 recent sessions — "which projects you work in, how you
    use Claude Code, where things go wrong, and features to try". Not available in cloud sessions.
  * `/verify` "records its own recipe" to `.claude/skills/verify/SKILL.md` and edits it only when
    a run went wrong, "so you can commit the file without per-session diffs";
    `/run-skill-generator` teaches `/run`/`/verify` how to build and launch the project.
  * `/team-onboarding` (generate a team onboarding guide from 30 days of usage history) appears in
    a community command reference but not on the official commands page I fetched — unverified [C].
    https://github.com/shanraisshan/claude-code-best-practice/blob/main/best-practice/claude-commands.md

### 1.2 What Anthropic recommends for CLAUDE.md [A]

* Size: "target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce
  adherence." A file over 4 MiB is skipped; a startup warning appears when a file, or the sum of
  files, is over the recommended length. Imports (`@path`, depth 4) load at launch and do **not**
  reduce context. https://code.claude.com/docs/en/memory
* Content test: "For each line, ask: *Would removing this cause Claude to make mistakes?* If not,
  cut it. Bloated CLAUDE.md files cause Claude to ignore your actual instructions!" Include: Bash
  commands Claude can't guess; style rules that differ from defaults; testing instructions;
  repository etiquette; project-specific architectural decisions; env quirks; gotchas. Exclude:
  anything Claude can figure out by reading code; standard conventions; API docs; frequently
  changing info; tutorials; file-by-file descriptions; "write clean code".
  https://code.claude.com/docs/en/best-practices
* "Treat CLAUDE.md like code: review it when things go wrong, prune it regularly, and test changes
  by observing whether Claude's behavior actually shifts." Steering blog (2026-06-18): "Keep
  CLAUDE.md under 200 lines, give it an owner, and review changes to it like code."
  https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more
* Mechanics that matter for design: CLAUDE.md "is delivered as a user message after the system
  prompt, not as part of the system prompt"; both CLAUDE.md and auto memory are "context, not
  enforced configuration"; HTML comments are stripped before injection (free maintainer notes);
  files are concatenated root→cwd; subdirectory files load on demand; `.claude/rules/*.md` with
  `paths:` frontmatter load only when matching files are read; `CLAUDE.local.md` for private
  preferences; `claudeMdExcludes` for monorepos. Project-root CLAUDE.md is re-injected after
  `/compact`; nested files and path rules are not until re-triggered.
* Startup budget shown in the official context-window walkthrough (illustrative figures): system
  prompt ~4,200 tokens, project CLAUDE.md ~1,800, auto memory ~680, skill descriptions ~450, user
  CLAUDE.md ~320, environment ~280, MCP tool names ~120 (schemas deferred by tool search).
  https://code.claude.com/docs/en/context-window
* AGENTS.md support (v2.1.277, Sept 2026; v2.1.281 also on Bedrock/Vertex/Foundry): by default
  read **only when there is no CLAUDE.md or CLAUDE.local.md in the working directory or above**;
  `claude-md-and-agents-md` setting reads both; `AGENTS.local.md`, `AGENTS.override.md` and
  `.agents/` are not read. https://code.claude.com/docs/en/memory#agents-md

### 1.3 Auto memory [A]

On by default since v2.1.59. Claude writes four kinds of notes (`user`, `feedback`, `project`,
`reference`) into `~/.claude/projects/<project>/memory/` (index `MEMORY.md`, first 200 lines or
25 KB loaded every session; topic files read on demand). "Claude skips anything it can derive from
the codebase, such as architecture, file paths, or debugging fixes. It also skips anything your
CLAUDE.md files already say." **Machine-local, per git repository, never shared across machines or
cloud environments, not loaded into subagents.** No approval step; `/memory` lets the user browse
and edit. https://code.claude.com/docs/en/memory#auto-memory

### 1.4 Hooks, skills, subagents, plugins, settings, LSP [A]

* **Hooks**: events `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
  `PostToolUseFailure`, `Notification`, `SubagentStop`, `Stop`, `StopFailure`, `PreCompact`,
  `PostCompact`, `InstructionsLoaded`, `ConfigChange`, `FileChanged`, `CwdChanged`, and more; types
  `command`, `http`, `mcp_tool`, `prompt` (Haiku judge) and `agent` (multi-turn, experimental).
  "Unlike CLAUDE.md instructions which are advisory, hooks are deterministic and guarantee the
  action happens." `PreToolUse` fires in every permission mode, including `bypassPermissions`.
  Configured in settings files, plugin `hooks/hooks.json`, skill frontmatter, or subagent
  frontmatter; hooks from all sources merge. A `Stop` hook can block the turn until a check
  passes. https://code.claude.com/docs/en/hooks-guide
* **Skills**: `SKILL.md` with frontmatter (`name`, `description`, `disable-model-invocation`,
  `user-invocable`, `allowed-tools`, `context: fork`, `paths`, `arguments`, hooks). Keep under 500
  lines; descriptions load every session and the description+`when_to_use` listing is truncated at
  1,536 characters; body loads on use. Locations: `.claude/skills/` (project), `~/.claude/skills/`,
  nested `<subdir>/.claude/skills/`, plugins, managed. "Create a skill when you keep pasting the
  same instructions… or when a section of CLAUDE.md has grown into a procedure rather than a
  fact." Claude no longer runs `/verify` and `/code-review` on its own (v2.1.215).
  https://code.claude.com/docs/en/skills
* **Subagents**: `.claude/agents/*.md` (check into version control); built-in Explore/Plan
  (read-only, skip CLAUDE.md) and general-purpose. https://code.claude.com/docs/en/sub-agents
* **Plugins**: a directory of skills/agents/hooks/MCP/LSP with `.claude-plugin/plugin.json`;
  official marketplace added automatically; **project scope = committed `.claude/settings.json`
  (`enabledPlugins`, `extraKnownMarketplaces`), each collaborator still installs locally**; the
  marketplace shows a "Context cost" estimate and highlights ≥2,000 always-on tokens; "Not used
  recently" after 14 days and 10 sessions; cloud sessions do not load local plugins.
  https://code.claude.com/docs/en/plugins/overview
* **Settings**: precedence managed > `--settings` > `.claude/settings.local.json` >
  `.claude/settings.json` (commit it: "team permissions, hooks, plugins, and the environment
  variables the project needs") > `~/.claude/settings.json`. `permissions.allow`,
  `additionalDirectories`, `extraKnownMarketplaces` and most `env` apply only after each teammate
  trusts the folder; `deny`/`ask` apply immediately. Settings hot-reload; `ConfigChange` hook
  fires. https://code.claude.com/docs/en/settings
* **LSP / code intelligence**: 13 official plugins (C/C++, C#, Go, Java, Kotlin, Liquid, Lua,
  PHP, Python, Ruby, Rust, Swift, TypeScript/JavaScript); diagnostics after each edit and a
  read-only `LSP` tool; a recommendation dialog appears when the binary is on PATH; **not started
  in cloud sessions**. https://code.claude.com/docs/en/plugins/code-intelligence
* **Cloud sessions**: SessionStart hooks and setup scripts run with timeouts; a setup script is
  cached only if it finishes in ~5 minutes; a multi-repo cloud session reads only `enabledPlugins`
  and `extraKnownMarketplaces` from each repo's settings. https://code.claude.com/docs/en/claude-code-on-the-web

### 1.5 Anthropic's "repo readiness" / codebase-onboarding guidance [A]

* Features overview — "Build your setup over time" trigger table: convention wrong twice → CLAUDE.md;
  same prompt typed repeatedly → skill; same playbook pasted three times → skill; browser data →
  MCP; many file reads to find a symbol → LSP plugin; side task floods context → subagent;
  must happen every time → hook; second repository needs the same setup → plugin. "You don't need
  to configure everything up front." Rule of thumb: CLAUDE.md < 200 lines.
  https://code.claude.com/docs/en/features-overview
* "How Claude Code works in large codebases" (2026-05-14): build in this order — CLAUDE.md →
  hooks → skills → LSP → MCP → plugins → subagents; root CLAUDE.md "pointers and critical gotchas
  only"; lightweight markdown "codebase maps" for unconventional structures; centralize with a DRI
  ("a small team, sometimes even just one person, wired up the tooling"); **"A stop hook can reflect
  on what happened during a session and propose CLAUDE.md updates"**; **review configuration every
  3–6 months after major model releases: "instructions written for your current model can work
  against a future one"** (example: single-file-refactor rules became constraining). No
  quantitative metrics in the post.
  https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start
* Re-evaluate after each model: Opus 4.7 launch (2026-04-16): "prompts written for earlier models
  can sometimes now produce unexpected results… Users should re-tune their prompts and harnesses
  accordingly." https://www.anthropic.com/news/claude-opus-4-7 · April-23 postmortem: "Each model
  behaves slightly differently, and we spend time before each release optimizing the harness and
  product for it… we've added guidance to our CLAUDE.md to ensure model-specific changes are gated
  to the specific model they're targeting." https://www.anthropic.com/engineering/april-23-postmortem
  · Harness design post (2026-03-24): "every component in a harness encodes an assumption about
  what the model can't do on its own, and those assumptions are worth stress testing."
  https://www.anthropic.com/engineering/harness-design-long-running-apps · Now operationalized as
  `/doctor prompt-audit` (v2.1.283).
* Measurement primitives:
  * `claude plugin eval` [A]: each case runs 3× with the plugin and 3× without; reports `WITH`,
    `W/OUT`, `Δ`; graders `regex`, `tool_used`, `tool_order`, `file_exists` (free) and `llm`,
    `baseline` (judge model); "pin [the model] in CI so a model rollout isn't mistaken for a plugin
    regression"; `--max-cost-usd`; `claude plugin eval init` has Claude propose cases from your
    plugin. "If a case scores 1.0 both with and without the plugin, the plugin isn't what made it
    pass." https://code.claude.com/docs/en/plugin-evals
  * `skill-creator` runs with-skill vs. without-skill subagents, records tokens and duration,
    reports "mean ± stddev and the delta", and flags non-discriminating assertions. [A]
    https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/SKILL.md
  * `/usage` attributes plan usage to skills, subagents, plugins and MCP servers; OpenTelemetry
    exports `claude_code.skill_activated`, `plugin_loaded`, cost/token counters with `skill.name`,
    `plugin.name`, `mcp_server.name`, `code_edit_tool.decision` (source: config/hook/user),
    `commit.count`, `pull_request.count`, `lines_of_code.count`, and repository attributes
    (`OTEL_METRICS_INCLUDE_REPOSITORY`, v2.1.269+). https://code.claude.com/docs/en/monitoring-usage
  * Anthropic's own eval methodology: "Demystifying evals for AI agents" (2026-01-09): start with
    20–50 tasks drawn from real failures; prefer outcome graders over step-sequence checks; pass@k
    vs pass^k. https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents ·
    "Quantifying infrastructure noise" (2026-02-05): a 6-point spread on Terminal-Bench 2.0 from
    resource limits alone; "leaderboard differences below 3 percentage points deserve skepticism
    until the eval configuration is documented and matched."
    https://www.anthropic.com/engineering/infrastructure-noise
* Cost baseline for later ROI claims [A]: "average cost is around $13 per developer per active
  day and $150–250 per developer per month". https://code.claude.com/docs/en/costs

### 1.6 Two field observations worth keeping [C]

* Issue #95745 (2026-09-20): after `/compact`, a CLAUDE.md rule that was demonstrably in context was
  not followed, while an imperative, trigger-coupled `SessionStart` hook instruction in the same
  context was. https://github.com/anthropics/claude-code/issues/95745
* Issue #96397 (2026-09-23): the Claude Code binary carries a `propose_skills` tool ("Show the user
  a review card of proposed skills to save — render-only, nothing is written"), rendered today in
  claude.ai chat/Cowork but not in Code sessions — i.e. Anthropic's skill-proposal primitive is a
  human-approval card. https://github.com/anthropics/claude-code/issues/96397

---

## 2. How the other tools set a repository up

| Tool | Always-on file(s) | Generated automatically | Asked from the human | Extras in repo | Learns after setup | Measures effect |
|---|---|---|---|---|---|---|
| **Claude Code** | `CLAUDE.md` (+`.claude/rules/`, nested, `CLAUDE.local.md`), or `AGENTS.md` if no CLAUDE.md | `/init` (CLAUDE.md; with flag also skills, hooks, local memory) [A] | New `/init` interviews for gaps [B] | `.claude/skills`, `.claude/agents`, `.claude/settings.json` (hooks, permissions, plugins) | auto memory (local, no approval); `/doctor` trims & audits (asks confirmation); `/insights` | `claude plugin eval`, `/skill-doctor`, `/usage`, OTel |
| **GitHub Copilot** (cloud agent, code review, CLI, VS Code/JetBrains) | `.github/copilot-instructions.md` → `.github/instructions/*.instructions.md` → `**/AGENTS.md`, `/CLAUDE.md`, `/GEMINI.md` → org instructions [A] | Cloud agent generates `copilot-instructions.md` **as a draft PR with you as reviewer**; first PR in a repo gets a comment offering it; VS Code "Generate Chat Instructions" button [A] | Reviewer edits the PR; JetBrains prompt asks for "~20–50 concise lines" [A] | `.github/skills/` (also `.claude/skills`, `.agents/skills`), `.github/hooks/*.json` (8 events), `.github/agents/*.md`, `copilot-setup-steps.yml`, MCP | **Copilot Memory** (public preview): repo facts + user prefs deduced automatically, "checks those citations against the current branch… Only validated facts are used", unused facts deleted after 28 days, shared across coding agent/code review/CLI/autofix [A]; **`/chronicle improve`**: mines "friction signals — repeated test failures, build errors that required multiple attempts, user messages that corrected or redirected the agent" and proposes edits you toggle before it writes the file [A] | No published numbers; docs claim guardrails "reduce total token consumption even if individual steps use slightly more tokens upfront" [A, unquantified] |
| **OpenAI Codex** | `AGENTS.override.md` → `AGENTS.md` → fallback names, root-down concatenation [A via summary] | `/init`: "create an AGENTS.md file with instructions for Codex" [A, TUI source] | — | Skills (`/skills`), hooks, `/import` from Claude Code | "Memories — configure memory use and generation" [A, TUI source] | none published |
| **Gemini CLI** | `GEMINI.md` hierarchy | `/init` "analyzes the current directory and generates a tailored context file" [A] | — | `/skills`, `/hooks`, `/extensions`, `/memory refresh` | — | — |
| **Cursor** | `.cursor/rules/*.mdc` (Always / Auto-attached / Agent-requested / Manual), `AGENTS.md`, legacy `.cursorrules` [A via summary] | "/Generate Cursor Rules" (v0.49) turns a conversation into a rule [A via summary] | Rule types chosen per file | `.cursor/skills/` (Agent Skills client) | **Memories**: auto-generated from chat, per user & per project, "not shared with teammates unless promoted into a rules file by hand" [C]; community prompt (Zakariasson, 2026-04-13) mines transcripts into rules/skills for review [C] | Harness A/Bs at "millions of sessions": keep rate, token efficiency, LLM-classified dissatisfied follow-ups (cursor.com/blog/continually-improving-agent-harness, 2026-04-30) [B via C] |
| **Devin / Devin Desktop (ex-Windsurf, renamed 2026-06-02)** | `.devin/rules/` (preferred) or `.windsurf/rules/`, `AGENTS.md`; Devin Knowledge (org- or repo-scoped, triggered) | **DeepWiki**: every indexed repo gets an auto-generated wiki (architecture diagrams, summaries, source links), steerable via `.devin/wiki.json`, "regenerate after major refactors" [C gist; A via summary] | Knowledge and Playbooks written by people | Playbooks | "I'll sometimes suggest knowledge after a session — review and approve these in your timeline" [C]; Cascade memories auto-generated, local-only [A via summary] | none published |
| **Kiro (AWS)** | `.kiro/steering/*.md` with inclusion modes always / fileMatch / manual; AGENTS.md read [A via summary] | "Generate Steering Docs" writes three foundation files: `product.md`, `tech.md`, `structure.md` [A via summary] | Extra steering files by hand | Agent hooks, skills, specs | — | — |
| **Factory (Droid)** | `AGENTS.md` root + nested [A via summary] | — (no init found) | — | `.factory/droids/` custom subagents, skills, hooks | — | **Agent Readiness**: scores a repo on 8 pillars (Style & Validation, Build System, Testing, Documentation, Dev Environment, Observability, Security, Task Discovery) with actionable criteria [A via summary]; no outcome correlation published |
| **Google Antigravity** | `AGENTS.md` (since v1.20.3, 2026-03-05), `GEMINI.md` (wins on conflict), `.agents/rules/*.md` [A via summary] | — | — | workflows, skills | knowledge items (unverified) | — |
| **Google Jules** | `AGENTS.md` (listed among adopters by the AAIF) [A via summary] | not verified (site blocked) | — | environment setup script | — | — |

Sources for the table: Claude Code docs (§1); GitHub docs source
https://github.com/github/docs/tree/main/content/copilot (files `tutorials/cloud-agent/get-the-best-results.md`,
`tutorials/cloud-agent/improve-a-project.md`, `how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions.md`,
`concepts/agents/copilot-memory.md`, `how-tos/copilot-cli/use-copilot-cli/chronicle.md`, `concepts/agents/hooks.md`,
`concepts/agents/about-agent-skills.md`, `tutorials/optimize-ai-usage.md`, `tutorials/vibe-coding.md`);
Copilot changelog entries 2025-08-28, 2025-11-12, 2026-06-18 (github.blog, via summary);
Codex TUI source https://raw.githubusercontent.com/openai/codex/main/codex-rs/tui/src/slash_command.rs;
Gemini CLI https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/commands.md;
Cursor https://cursor.com/docs/context/rules (via summary) and https://cursor.com/docs/context/skills;
Devin cheat-sheet https://gist.github.com/nickytonline/a24df16af8ebb9e960d961da565da4b5,
https://docs.devin.ai/work-with-devin/deepwiki and https://docs.windsurf.com/windsurf/cascade/memories (via summary);
Kiro https://kiro.dev/docs/steering/ (via summary); Factory https://docs.factory.ai/harness/agents-md and
https://factory.ai/product/agent-readiness (via summary); Antigravity https://antigravity.google/docs/rules/ (via summary).

Notable details behind the table:

* GitHub's recommended generation prompt targets an outcome, not a document: "Reduce the likelihood
  of a cloud agent pull request getting rejected" because of CI or validation failures;
  "Instructions must be no longer than 2 pages" and "not task specific"; cover high-level repo
  details, build/test, architecture/layout. The generated file arrives as a draft PR with the
  requester as reviewer. [A]
* GitHub's cost guidance frames instructions as "a map of your project" so agents "don't have to
  read large numbers of files just to orient themselves", and says to enable only the MCP toolsets
  relevant to the task. [A]
* Copilot Memory's design (GitHub engineering blog, 2026-01-15, via a citing README): "stale,
  branch-specific memories are often more dangerous than having no memory at all"; hence
  just-in-time verification. [A via C]
* Cursor's harness team measures at a scale no single team can reproduce; the same source notes a
  harness regression (dropping reasoning traces between turns) cost 30 % on an internal benchmark
  (cursor.com/blog/codex-model-harness, 2025-12-04) — "verifying harness mechanics (does the hook
  fire, does the skill trigger) is higher-yield than micro-tuning prose." [B via C]
  https://raw.githubusercontent.com/aschi2/meta-harness/main/kb/harness-evals.md

---

## 3. The two standards

### 3.1 AGENTS.md

* Released by OpenAI in Aug 2025; contributed to the Linux Foundation's Agentic AI Foundation
  (AAIF, formed Dec 2025 with MCP and goose); the AAIF states it has been "adopted by more than
  60,000 open-source projects" and by Amp, Codex, Cursor, Devin, Factory, Gemini CLI, GitHub
  Copilot, Jules and VS Code; AAIF membership 170+ (Apr 2026), 190 (May 2026). [A via summary]
  https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation ,
  https://www.linuxfoundation.org/press/agentic-ai-foundation-adds-43-new-members-as-enterprise-and-government-adoption-of-open-agent-standards-accelerates
* Native readers as of Sept 2026: Codex (origin), Copilot coding agent (Aug 2025), Copilot code
  review (Jun 2026), Copilot CLI, Cursor, Antigravity (Mar 2026), Kiro, Factory, Devin/Windsurf,
  Jules, Amp, Goose, OpenCode — and **Claude Code since v2.1.277 (Sept 2026), but only as a
  fallback when no CLAUDE.md exists.** [A]
* Galster et al. (AIware 2026, 2,853 repos): "AGENTS.md is emerging as an interoperable standard";
  context files dominate; "Many repositories use only a context file". [B]
* Interoperability caveats that matter for a multi-tool product: precedence differs (Copilot puts
  `copilot-instructions.md` first; Antigravity lets `GEMINI.md` win; Claude lets `CLAUDE.md` win
  and ignores `AGENTS.override.md`/`.agents/`); Claude's `InstructionsLoaded` hooks do not fire for
  an AGENTS.md read through the setting; Anthropic's suggested bridge is a one-line `CLAUDE.md`
  containing `@AGENTS.md` plus Claude-specific lines. [A]

### 3.2 Agent Skills (agentskills.io)

* Anthropic launched skills in Oct 2025 and opened the spec on 2025-12-18; Apache-2.0 code,
  CC-BY-4.0 docs; repo 25.7k stars. [A] https://github.com/agentskills/agentskills
* The clients showcase source file lists **54 clients** (Sept 2026), including Claude Code, Claude,
  ChatGPT & Codex, Cursor, GitHub Copilot, VS Code, Gemini CLI, JetBrains Junie, Goose, OpenCode,
  OpenHands, Amp, Factory, Kiro, Databricks Genie Code, Snowflake Cortex Code, Roo Code, Mistral
  Vibe, Qodo, Tabnine, Hermes, OpenClaw, Pulumi Neo, Spring AI. [A]
  https://raw.githubusercontent.com/agentskills/agentskills/main/docs/snippets/clients.jsx
* Path fragmentation remains: `.claude/skills/` (Claude), `.github/skills/` plus `.claude/skills`
  and `.agents/skills` (Copilot), `.cursor/skills/` (Cursor), `~/.agents/skills` (personal). [A]
* Effect evidence: SWE-Skills-Bench (§4) is negative on average; OpenAI reports skill routing
  accuracy "73 %→85 % by adding negative examples" to versioned skill bundles (via a citing
  README) [A via C]; Microsoft's SkillOpt treats skills as optimizable parameters [C].

---

## 4. New or corroborating evidence since the 2026-09-23 brief

| Study | Design | Finding | Grade |
|---|---|---|---|
| Gloaguen et al., ETH/LogicStar, arXiv:2602.11988 (Feb 2026) — the prior brief | 138 tasks, 4 agents, none/LLM-generated/human context file | Generated files −2–3 %; human-written ~+4 %; +~20 % cost; recommend omitting generated files, limiting human files to non-inferable details | [A] |
| Li et al., "Repository-Level Instructions Enhance AI Assistant Completion and Efficiency", arXiv:2601.20404 (Jan 2026) | AGENTS.md vs none | **Opposite sign on cost**: −28.6 % task time, −16.5 % tokens with a lean, non-redundant, human-written file; verbose/auto-generated context "costs more and helps less" | [A via C mirrors] |
| Khatri, "Do Context Files Help Coding Agents? A Two-Agent Ablation Study on Real Repositories", arXiv:2607.27250 (2026-07-28) | Claude Code + Codex, 17 real tasks from 3 repos, 288 evaluated runs, gold tests | "Context strategy does not measurably move correctness on either agent"; power analysis: ~120 tasks for 80 % power on a 10-point effect, so 20–50-task suites cannot see single-digit deltas; **cost/behavior proxies (tokens, turns, redundant tool calls) move detectably when pass rates don't** | [A] (abstract via GitHub mirror) |
| McMillan, "Instruction Adherence in Coding Agent Configuration Files: A Factorial Study of Four File-Structure Variables", arXiv:2605.10039 (May 2026) | 1,650 sessions, 2×2×2×2 factorial | File size, instruction position, file architecture, and contradictions between adjacent files each produced **no detectable effect** on whether a rule is followed; the only effect: **within-session decay, ~5.6 % lower compliance odds per generated function** — so cadence (re-surfacing rules) matters more than length | [A] |
| dos Santos et al., "Configuration Smells in AGENTS.md Files", arXiv:2606.15828 (Jun 2026) | 100 popular repos | 91 % have ≥1 smell: lint leakage 62 % (rule restates what a linter enforces), context bloat 42 %, skill leakage 35 % (task-specific text in the always-on file), conflicting instructions 28 %, **init fossilization 24 %** (generated text never reviewed), blind references 16 % | [B] |
| Galster et al., "Harness Engineering for Agentic AI Coding Tools" (AIware 2026), arXiv:2602.14690 | docs of 5 tools + 2,853 repos | 8 mechanisms (context files, skills, subagents, commands, rules, settings, hooks, MCP); context files 61–100 % of configured repos; skills, subagents, hooks each <20 % (hooks ~3 %); most repos define 1–2 artifacts; skills mostly static | [B] |
| SWE-Skills-Bench, arXiv:2603.15401 (Mar 2026) | 565 real SE tasks, 49 public skills, paired with/without | **39/49 skills: zero pass-rate gain; average +1.2 %; token overhead up to +451 %; 3 skills degrade up to −10 %**; root cause "context interference" (surface anchoring, hallucination, concept bleed) | [A] |
| "A Deterministic Control Plane for LLM Coding Agents", arXiv:2606.26924 (Jun 2026) | 10,008 repos, 6,145 config files | Configs propagate as undeclared shared components: 10.1 % byte-identical duplicates (75.5 % cross-org); 58 % single-commit (rarely revised); <1 % declare permission boundaries vs 33 % of Actions workflows; proposes a managed control plane above the harness | [B] |
| "When 'Do Not' Is Not Deny: Security Rules in CLAUDE.md vs Built-In Controls" (Aug 2026) | 481 public CLAUDE.md | only ~4 % of natural-language security rules are backed by a matching enforced control | [B via C] |
| Vasilopoulos, "Codified Context: Infrastructure for AI Agents in a Complex Codebase", arXiv:2602.20478 (Feb 2026) | one 108k-LOC codebase, 283 sessions | hot-memory "constitution" (always on) + 19 specialist agents + cold-memory of 34 specs retrieved via MCP; ~26k lines of context infrastructure; "Documents were created when agents made mistakes, not as a planning exercise. Start small and add context as patterns emerge." | [C] |
| Jarmak, "Engineering Reliable Coding Agents: Evaluating and Operating the System Around the Model", arXiv:2608.13867 (Aug 2026) | multivocal review: 164 papers, 100 practitioner records, 29 benchmarks | "many apparent model failures originate elsewhere in the system, while improvements at one layer often fail to propagate to end-to-end outcomes"; 206 reliability records, 193 gated practices | [B] |
| "The Fragility of Self-Improving Agents", arXiv:2608.18066 (Salesforce, Aug 2026) | re-evaluation of memory-based self-improvement | self-improvement loops amplify evaluation noise; gains depend on task order — "existing reports may be order luck" | [A via C] |
| Anthropic, infrastructure noise (2026-02-05) | Terminal-Bench 2.0 / SWE-bench under resource limits | 6-point spread from infrastructure alone; distrust <3-point differences | [A] |
| Community benchmark, MuhammadUsmanGM/claude-code-best-practices (2026-04-22) | 6 tasks, 3 runs median, ~180k-LOC Node repo, Opus 4.7/Sonnet 4.6/Haiku 4.5 | 180-line CLAUDE.md: −8.7 % input tokens vs none; 30-line: −1.7 %; "breaks even by turn 3"; nightly benchmark table still empty | [C] |
| Harness Engineering source-code study of 11 harnesses, arXiv:2609.00006 (Sept 2026); "Inside the Scaffold", arXiv:2604.03515 | code audits | Aider's ranked repo map is still the only ranked repository map among production harnesses; 29 recurring design patterns | [B] |

Readiness scores in the wild (none publishes a correlation with outcomes):
* Factory **Agent Readiness** — 8 pillars, per-pillar scoring, "actionable criteria" [A via summary]
  https://factory.ai/product/agent-readiness
* `jpequegn/agent-readiness-score` — same 8 pillars, 5 maturity levels; "Level 3 (Standardized)"
  is where "agents become genuinely productive" [C] https://github.com/jpequegn/agent-readiness-score
* `agent-next/agent-ready` — 9 areas (agent guidance, code quality, testing, CI/CD, git hooks,
  branch rulesets, templates, devcontainer, security); `npx agent-ready check .` with JSON output
  and a GitHub Action `fail-on-missing` [C] https://github.com/agent-next/agent-ready
* gmoigneu checklist — 8 verification pillars, 0–80 points; "the limit to agent autonomy isn't the
  model, it's your verification infrastructure" [C] https://gist.github.com/gmoigneu/a963b595ac238ad2d2260ebb8b29f048
* PostHog's in-repo skill for editing AGENTS.md encodes the research above as policy: a
  "belonging hierarchy" (linters → pre-commit hooks → skills → AGENTS.md "last resort"), rules
  written as invariants with triggers, `[lint: <id>]`/`[review]` enforcement tags validated in CI,
  root file under 200 lines, nested files for directory rules, and a link checker [C, but a
  production practice] https://github.com/PostHog/posthog/blob/master/.agents/skills/editing-agents-md/SKILL.md

Repo-specific evaluation ("SWE-bench on your own repo"): the vendor primitives are Claude Code's
`claude plugin eval` and `skill-creator` (§1.5); Anthropic's advice is 20–50 tasks from real
failures, run several times, outcome-graded; Khatri's power analysis says such a suite can detect
large effects and cost/behavior shifts but not single-digit correctness deltas; one community
methodology stamps every verdict ("load-bearing / ceremony / harmful") with model ID and date and
declares "Stamps expire on model upgrade" [C]
https://github.com/TheRealBillSiegler/delegation-tiering/blob/main/evals/README.md

---

## 5. Auto-generated repository knowledge (no hand-written files)

| Approach | What it is | Evidence of value | Grade |
|---|---|---|---|
| **DeepWiki** (Cognition, since 2025-04-25) | Auto-generated wiki per repo (architecture diagrams, module pages, Q&A); inside Devin, steerable via `.devin/wiki.json`; MCP server for other agents; claims 30k+ repos, 4B+ lines indexed | Adoption and maintainers linking to it; no controlled outcome data | [B via summary] https://cognition.com/blog/deepwiki , https://docs.devin.ai/work-with-devin/deepwiki |
| **Augment Context Engine** (MCP, Feb 2026) | Real-time branch-aware semantic index exposed to any agent | Vendor benchmark: Claude Code+Opus 4.5 "80 % quality improvement", Cursor 71 %, Elasticsearch-repo review score +12.8 vs negatives for competitors | [B, vendor] https://www.augmentcode.com/blog/context-engine-mcp-now-live |
| **Greptile** | Semantic graph of files/functions/dependencies for review agents | vendor claims only | [C] https://www.greptile.com/agent |
| **Sourcegraph Cody context engine** | Multi-repo RAG, up to 10 repos | 2024 paper on context retrieval evaluation; nothing new in 2026 found | [B] arXiv:2408.05344 |
| **Aider repo map** | tree-sitter symbols + graph ranking (PageRank), default 1k tokens, expands when no files are in chat | Design rationale only; no benchmark on the doc page; still the only ranked map among 11 audited harnesses | [A docs, B study] https://github.com/Aider-AI/aider/blob/main/aider/website/docs/repomap.md |
| **RepoAtlas** (arXiv:2609.16936, Sept 2026) | training-free "select–project–refresh" loop over a code graph, rendered as evolving multimodal views under a fixed budget | academic results vs baselines (abstract only retrieved) | [A] |
| **Copilot Memory** | facts deduced during work, verified against the current branch before use | design only; no numbers | [A] |
| **LangChain OpenWiki** (Aug 2026) | every written claim carries versioned code evidence; claims are flagged stale when evidence changes | design only | [A via C] |
| **Anthropic's position** | no index: agentic search + LSP + a lean CLAUDE.md; "Claude's ability to help in a large codebase is bounded by its ability to find the right context"; hooks can pre-filter (e.g. only test failures) and a "codebase-overview" skill can replace exploration | docs guidance | [A] |

Net: generated knowledge bases are widely used and cheap, but the only controlled evidence on
*injected* generated context (ETH; SWE-Skills-Bench) is neutral-to-negative, and Khatri's
selective-retrieval arm "finds nothing at n=17". The defensible pattern from Codified Context,
Copilot Memory and OpenWiki is the same: keep generated knowledge **cold** (retrieved on demand),
keep it **evidence-linked and invalidated on change**, and keep the **hot** file tiny.

---

## 6. Continuous improvement after onboarding — who proposes, who approves

| Tool | Signal source | What is proposed | Human gate | Where it lands |
|---|---|---|---|---|
| Claude Code auto memory | corrections, preferences, decisions during a session | notes of 4 types | none (editable afterwards via `/memory`) | machine-local, never shared |
| Claude Code `/doctor` | checked-in CLAUDE.md, unused skills/plugins, slow hooks | trims, migrations to skills/nested files, allowlists | "reports findings first and asks for confirmation" | repo files / settings |
| Claude Code `/doctor prompt-audit` | CLAUDE.md, skills, agents, commands | fixes for instructions written for older models, stale paths/commands, contradictions | diff to accept | repo files |
| Claude Code `/verify` | its own successful build/run steps | a recorded recipe, edited only when a run went wrong | commit it | `.claude/skills/verify/SKILL.md` |
| Claude Code `/fewer-permission-prompts`, `/insights` | transcripts | allowlist; "where things go wrong" report | you run the command | `.claude/settings.json`; HTML report |
| Anthropic pattern (large-codebases post) | a `Stop` hook reflecting on the session | CLAUDE.md updates | proposal, not write | repo |
| Claude Code `propose_skills` (in binary) | a session | review card of skills to save | Save button | account skills (chat/Cowork today) |
| Copilot `/chronicle improve` | friction signals in session history (repeated test failures, corrections) | edits to `copilot-instructions.md` | per-suggestion toggle, then Enter | `.github/copilot-instructions.md` |
| Copilot Memory | agent work by write-access users | repo facts & user prefs | none, but JIT-verified, 28-day expiry, user/admin delete | GitHub-side, shared across surfaces |
| Cursor Memories / "/Generate Cursor Rules" | chat | memories (auto) / a rule (explicit) | memories: none; rules: user decides to promote | local / `.cursor/rules` |
| Devin Knowledge | sessions | "suggest knowledge after a session" | "review and approve these in your timeline" | org/repo Knowledge with triggers |
| Windsurf/Devin Desktop memories | sessions | memories | none | `~/.codeium/windsurf/memories`, never committed |
| Codex | sessions | "memory use and generation" (configurable) | config | — |
| Third-party (claude-mem 94.8k stars; Hivemind; "self-improving skills" with confidence levels) | hooks capture every session | injected summaries; evidence-linked SKILL.md files | varies | local DB / `.claude/skills` |

Cautions from the literature: self-improvement loops amplify eval noise and are order-dependent
(arXiv:2608.18066); GitHub: stale memories are worse than none; dos Santos: 24 % of AGENTS.md files
carry fossilized generated text; Anthropic: skills and hooks "built to compensate for model
limitations become overhead once those limitations disappear."

---

## 7. Deterministic script vs. fixed installs vs. prompts

* **Vendor doctrine (Anthropic) [A]**: CLAUDE.md and auto memory are "context, not enforced
  configuration"; "Put guardrails in hooks… If a rule must hold every time, make it a hook rather
  than a prompt instruction"; "If Claude already does something correctly without the instruction,
  delete it or convert it to a hook." `PreToolUse` deny cannot be bypassed by permission mode.
* **Vendor doctrine (GitHub) [A]**: deterministic guardrails (tests, linters, scans) → "fewer
  retries, faster task completion, and more predictable agent behavior… often reduce total token
  consumption"; `copilot-setup-steps.yml` so the agent can build and test in its own environment.
* **Corpus evidence [B]**: config files are copied, unrevised and permission-less
  (arXiv:2606.26924); NL security rules rarely enforced (4 %); lint rules restated in prose in 62 %
  of files (arXiv:2606.15828) — each a reason to prefer machine-checkable artifacts over prose.
* **Controlled evidence [A]**: prose position/size/architecture don't change compliance
  (arXiv:2605.10039); generated prose is neutral-to-negative (ETH, SWE-Skills-Bench).
* **Practice [C]**: PostHog's belonging hierarchy with CI-validated enforcement tags; the
  `agent-ready` CLI (`check`, JSON, `fail-on-missing` Action); Microsoft Conductor's YAML-defined
  deterministic multi-agent workflows ("For workflows with known structure, dynamic LLM
  orchestration adds cost, latency, and unpredictability", 2026-05-14, via summary)
  https://opensource.microsoft.com/blog/2026/05/14/conductor-deterministic-orchestration-for-multi-agent-ai-workflows/ ;
  Kaushik Gopal's "Build your own /init" (blocked; title only).
* **Idempotency precedents inside vendor tools [A]**: `/verify` rewrites its recipe only on
  failure; `/doctor` dedups and asks before writing; plugin evals pin models in CI; Claude's
  settings files hot-reload and merge lists rather than overwrite; Copilot delivers generated
  instructions as a PR.
* **Where the LLM is still needed**: gap-filling interviews (Claude `/init` phase 3), summarizing
  friction into proposals (`/chronicle`, `/insights`), and writing the *content* of a skill. Every
  vendor puts the LLM at proposal time and a deterministic artifact (file in git, hook, allowlist)
  at run time.

---

## 8. What this means for onboarding design

1. **Define "ready" as a small hot layer + a cold layer + enforcement + a check, not as a big
   CLAUDE.md.** Hot: one instruction file under ~150 lines that fails the test "would removing this
   line cause a mistake?" (Anthropic), written as invariants with triggers (PostHog), containing
   only non-inferable facts (ETH). Cold: skills/rules/docs loaded on demand. Enforcement: hooks,
   linters, pre-commit, permission `deny` rules. Check: a verification command the agent can run.
2. **Generate the draft, interview for the gaps, and never ship an unreviewed generated file.**
   Every controlled study penalizes unreviewed generated context; every vendor's flow now ends in a
   review step (Copilot PR, Claude interview + confirm, Cursor promote-to-rule). Make the review a
   first-class DCC event on the WorkItem timeline.
3. **Do not compete with `/init`; wrap it.** Run the vendor's `/init` (new flow when available)
   as one step, then apply DCC's deterministic pass: prune, tag, add hooks, add settings, add the
   verification recipe, write the other tools' files. Expect `/init` to improve but to remain
   one-tool, one-machine, unmeasured — the "still-weak" assumption should not be in the design;
   the "one-shot, CLAUDE.md-centric, no measurement" assumption is safe.
4. **Emit multi-tool artifacts from one source of truth.** Write `AGENTS.md` as the shared file
   (Codex, Copilot, Cursor, Kiro, Factory, Antigravity, Devin, Claude fallback), plus a one-line
   `CLAUDE.md` with `@AGENTS.md` and Claude-specific lines (Anthropic's own bridge), plus
   `.github/copilot-instructions.md` only if the client uses Copilot review. Know the precedence
   traps (Claude ignores AGENTS.md when a CLAUDE.md exists; Antigravity prefers GEMINI.md).
5. **Prefer hooks and checks over prose for anything that must always hold**, and record which
   prose rule is backed by which enforcement (PostHog's `[lint: id]`/`[review]` tags). A rule
   without a control is a request; audit the ratio (the field average is ~4 % for security rules).
6. **Standardize the folder structure across client repos** — the evidence supports it: config
   files are already copied verbatim across repos (10.1 % duplicates), vendors converge on
   `.claude/`, `.github/`, `.agents/skills`, `AGENTS.md`, and a consistent layout is what lets DCC
   audit, diff, and re-audit deterministically. Keep the *content* per repo, the *shape* global.
7. **Measure with proxies that move, and with the vendor's own harness.** Correctness needs ~120
   tasks for 80 % power (Khatri) — beyond a client repo. Tokens, turns, redundant tool calls,
   retries, permission prompts, hook blocks, `/skill-doctor` usage, and `/usage` attribution move
   with small N. Use `claude plugin eval` (WITH/W/OUT/Δ, pinned models) for skills that have
   verifiable outcomes; treat sub-3-point correctness differences as noise (Anthropic).
8. **Bake cost into readiness.** Baseline: ~$13/developer/active day (Anthropic). Report always-on
   context tokens at session start (the plugin-marketplace "Context cost" model: highlight ≥2,000)
   and the share attributable to each artifact.
9. **Skills are guilty until measured.** 39/49 public skills gave zero gain and some hurt; keep
   descriptions short (1,536-char listing budget) and precise (that is what triggers them); prefer
   `disable-model-invocation` for side-effect workflows; delete skills nobody invokes.
10. **Re-audit on every model release, not on a calendar alone.** Anthropic says 3–6 months and
    ships `/doctor prompt-audit`; stamp each artifact with the model it was verified on and expire
    the stamp on upgrade (delegation-tiering practice). Gate model-specific instructions to the
    model (Anthropic's internal CLAUDE.md rule).
11. **Learning after onboarding = observe → propose → approve → commit.** Mine friction signals
    (repeated test failures, build retries, user corrections — Copilot's list; Claude's `/insights`
    and `InstructionsLoaded`/`Stop` hooks) into proposals with confidence; put them through the
    same review as code; never write shared rules silently (auto memory, Cursor/Windsurf memories
    stay personal by design). Invalidate proposals when their code evidence changes (Copilot
    Memory, OpenWiki).
12. **Watch within-session decay, not file length.** The only structural effect found is
    compliance decaying through a session (~5.6 % per generated function). A `SessionStart`
    (compact) hook re-injecting the few critical invariants, and a `Stop`/`PostToolBatch` cadence,
    address it; longer files do not.
13. **Give the agent a verification loop on day one** (`/verify` recipe, test command, LSP plugin
    for typed languages, `copilot-setup-steps`-style environment). Every readiness checklist in the
    wild is mostly *verification infrastructure*; Anthropic: "Give Claude a check it can run."
14. **Keep the generated knowledge cold.** DeepWiki-style summaries, codebase maps and
    architecture notes belong in on-demand skills/docs with "read when" clauses (blind references
    are a smell at 16 %), not in the hot file; refresh them on structural change.
15. **Ship the whole thing as a plugin/marketplace where the tool supports it.** Anthropic's
    distribution answer for "the same setup in a second repository" is a plugin (skills, hooks,
    subagents, MCP, LSP) enabled via committed `.claude/settings.json`; Copilot has
    `copilot plugin install`. A DCC plugin per client is the idiomatic, updatable form.

---

## 9. Source list (grade · what it contributed)

Anthropic / Claude Code [A]
* https://code.claude.com/docs/en/commands — `/init`, `/import`, `/doctor`, `/insights`, `/context`, `/fewer-permission-prompts`
* https://code.claude.com/docs/en/best-practices — CLAUDE.md include/exclude, hooks vs instructions, verification, subagents
* https://code.claude.com/docs/en/memory — CLAUDE.md mechanics, rules, AGENTS.md support, auto memory, `/doctor` trims, `/init` migration of other tools' files
* https://code.claude.com/docs/en/features-overview — feature decision tables, "build your setup over time", context costs, 200-line rule
* https://code.claude.com/docs/en/skills — skill format, limits, `/verify` recipe recording
* https://code.claude.com/docs/en/hooks-guide — events, determinism, prompt/agent hooks
* https://code.claude.com/docs/en/sub-agents · https://code.claude.com/docs/en/plugins/overview · https://code.claude.com/docs/en/plugins/measure · https://code.claude.com/docs/en/plugin-evals · https://code.claude.com/docs/en/plugins/code-intelligence · https://code.claude.com/docs/en/settings · https://code.claude.com/docs/en/context-window · https://code.claude.com/docs/en/costs · https://code.claude.com/docs/en/monitoring-usage · https://code.claude.com/docs/en/claude-code-on-the-web
* https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md (raw) — versions 2.1.59 auto memory; 2.1.108 model may invoke `/init`; 2.1.111 permission-prompt skill; 2.1.205–206 `/doctor` checkup and trims; 2.1.261 `/skill-doctor`; 2.1.277/281 AGENTS.md; 2.1.283 `prompt-audit`
* https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start (2026-05-14)
* https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more (2026-06-18)
* https://www.anthropic.com/news/claude-opus-4-7 (2026-04-16) · https://www.anthropic.com/engineering/april-23-postmortem · https://www.anthropic.com/engineering/harness-design-long-running-apps (2026-03-24) · https://www.anthropic.com/engineering/infrastructure-noise (2026-02-05) · https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents (2026-01-09)
* https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/SKILL.md
* [B] https://raw.githubusercontent.com/chauncygu/collection-claude-code-source-code/main/original-source-code/src/commands/init.ts — NEW_INIT_PROMPT
* [B/C] https://github.com/anthropics/claude-code/issues/97004 · /issues/95745 · /issues/96397

GitHub Copilot [A] (docs source repo, blocked site)
* https://github.com/github/docs/blob/main/content/copilot/tutorials/cloud-agent/get-the-best-results.md · …/tutorials/cloud-agent/improve-a-project.md · …/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions.md · …/concepts/agents/copilot-memory.md · …/how-tos/copilot-cli/use-copilot-cli/chronicle.md · …/concepts/agents/hooks.md · …/concepts/agents/about-agent-skills.md · …/concepts/agents/code-review.md · …/tutorials/optimize-ai-usage.md · …/tutorials/vibe-coding.md · …/reference/custom-instructions-support.md · …/how-tos/copilot-cli/customize-copilot/add-custom-instructions.md
* [A via summary] https://github.blog/changelog/2026-06-18-copilot-code-review-agents-md-support-and-ui-improvements/ · https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions/ · https://github.blog/changelog/2025-11-12-copilot-code-review-and-coding-agent-now-support-agent-specific-instructions/
* [A via C] https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/ (2026-01-15), cited in https://github.com/ai-boost/awesome-harness-engineering

OpenAI Codex / Gemini CLI [A]
* https://raw.githubusercontent.com/openai/codex/main/codex-rs/tui/src/slash_command.rs — `/init`, Memories, Skills, Import
* https://developers.openai.com/codex/guides/agents-md (via summary) · https://agents.md/ (blocked)
* https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/commands.md

Cursor [A via summary / C]
* https://cursor.com/docs/context/rules · https://cursor.com/docs/context/skills · https://cursor.com/blog/continually-improving-agent-harness (2026-04-30) and https://cursor.com/blog/codex-model-harness (2025-12-04), both via https://raw.githubusercontent.com/aschi2/meta-harness/main/kb/harness-evals.md · https://aicatchup.com/skills/cursor-rules-from-chat-history · https://localskills.sh/blog/cursor-memories-guide

Devin / Cognition / Windsurf [A via summary / C]
* https://docs.devin.ai/work-with-devin/deepwiki · https://cognition.com/blog/deepwiki · https://gist.github.com/nickytonline/a24df16af8ebb9e960d961da565da4b5 · https://docs.windsurf.com/windsurf/cascade/memories · https://www.skillwright.app/blog/windsurf-rules-guide (rename to Devin Desktop, 2026-06-02)

Kiro / Factory / Antigravity [A via summary]
* https://kiro.dev/docs/steering/ · https://docs.factory.ai/harness/agents-md · https://factory.ai/product/agent-readiness · https://factory.ai/news/agent-readiness · https://antigravity.google/docs/rules/

Standards
* [A via summary] https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation · https://www.linuxfoundation.org/press/agentic-ai-foundation-adds-43-new-members-as-enterprise-and-government-adoption-of-open-agent-standards-accelerates
* [A] https://github.com/agentskills/agentskills · https://raw.githubusercontent.com/agentskills/agentskills/main/docs/snippets/clients.jsx

Studies (arXiv blocked; abstracts and numbers via citing GitHub repositories and daily-paper mirrors)
* [A] arXiv:2602.11988 Gloaguen et al. (ETH/LogicStar) · arXiv:2607.27250 Khatri · arXiv:2605.10039 McMillan · arXiv:2603.15401 SWE-Skills-Bench (GeniusHTX/SWE-Skills-Bench) · arXiv:2601.20404 Li et al. · arXiv:2609.16936 RepoAtlas · arXiv:2608.18066 Fragility of Self-Improving Agents
* [B] arXiv:2606.15828 dos Santos et al. · arXiv:2602.14690 Galster et al. (AIware 2026) · arXiv:2606.26924 Deterministic Control Plane · arXiv:2608.13867 Jarmak · arXiv:2609.00006 Harness Engineering (11 systems) · arXiv:2604.03515 Inside the Scaffold · "When 'Do Not' Is Not Deny" (Aug 2026, via awesome-harness-engineering)
* [C] arXiv:2602.20478 Codified Context + https://github.com/arisvas4/codified-context-infrastructure
* Mirrors used: https://github.com/PostHog/posthog/blob/master/.agents/skills/editing-agents-md/SKILL.md · https://github.com/aschi2/meta-harness/blob/main/kb/harness-evals.md · https://github.com/ai-boost/awesome-harness-engineering · https://github.com/ai-boost/awesome-prompts · https://github.com/qhduan/cn-chat-arxiv · https://github.com/nerdchanii/solar-wiki · https://github.com/elon-choo/fablever/blob/main/docs/OPTIMAL-STACK.md · https://github.com/TheRealBillSiegler/delegation-tiering

Readiness tools and checklists [C]
* https://github.com/jpequegn/agent-readiness-score · https://github.com/agent-next/agent-ready · https://gist.github.com/gmoigneu/a963b595ac238ad2d2260ebb8b29f048 · https://github.com/MuhammadUsmanGM/claude-code-best-practices (guides/benchmarks.md) · https://github.com/thedotmack/claude-mem

Repo-knowledge vendors [B/C]
* https://www.augmentcode.com/blog/context-engine-mcp-now-live (via summary) · https://www.greptile.com/agent (via summary) · https://github.com/Aider-AI/aider/blob/main/aider/website/docs/repomap.md · arXiv:2408.05344 (Cody)

Not found / not verified: Jules configuration docs (site blocked); Antigravity "knowledge" auto-learning (secondary mention only); any vendor publishing a controlled effect size for its instruction-file generator; Codex `project_doc_max_bytes` default (config page blocked).
