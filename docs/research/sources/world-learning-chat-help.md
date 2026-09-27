# World research: a learning system (A), the chat form (B), the "i" help mechanism (C)

Date: 2026-09-27. Web research only; no code was changed.

## How to read this file

- Evidence grades: **[A]** controlled study or official vendor/standards documentation; **[B]** observational study, benchmark, survey or industry paper; **[C]** practitioner report, blog, vendor marketing or comparison site.
- Access notes. The network proxy blocked many primary domains: arxiv.org, alphaxiv.org, huggingface.co/papers, aclanthology.org, dl.acm.org, cacm.acm.org, lmsys.org, cursor.com, docs.cursor.com, nngroup.com, wattenberger.com, maggieappleton.com, simonwillison.net, atlassian.com, atlassian.design, learn.microsoft.com, fluent2.microsoft.design, m3.material.io, design-system.service.gov.uk, intercom.com, fin.ai, support.zendesk.com, eesel.ai, docs.renovatebot.com, docs.github.com, github.blog, research.google, launchdarkly.com, statsig.com, dev.to, superhuman.com, linear.app, notion.com, figma.com, salesforce.com, pendo.io, braintrust.dev, docs.smith.langchain.com, dspy.ai, decagon.ai, openrouter.ai, docs.notdiamond.ai, swimm.io, mintlify (learn.), docs.gitlab.com, dittowords.com, uxcontent.com, survey.stackoverflow.co, stackoverflow.blog, shapeof.ai, radix-ui.com, floating-ui.com, i18next.com, zenml.io, formatjs.github.io, web.archive.org.
  - Where a page could not be opened, the claim is taken from the search engine's excerpt of that page and marked **(snippet)**. Where it comes from memory and could not be verified at all it is marked **(recalled, unverified)**. Everything else was read from the page (or a GitHub/raw-GitHub copy of it).
  - Reachable and used directly: platform.claude.com, code.claude.com, claude.com, anthropic.com, github.com, raw.githubusercontent.com, microsoft.com.
- The WebSearch budget for the session ran out after topic 6 was searched; the last verifications (topics 6–7 and a few vendor pages) were done with WebFetch only.

---

## 1. Self-improving AI products

### 1.1 Prompt-optimization loops and eval-driven development

| Finding | Grade | Source |
|---|---|---|
| **GEPA (reflective prompt evolution)** — an LLM reads full execution traces (errors, scores, textual feedback) and proposes revised instructions; keeps a Pareto frontier of candidates. Paper claims: beats GRPO (RL) by ~10% on average, up to 20%, with up to 35x fewer rollouts; beats MIPROv2 (the previous best DSPy optimizer) by >10%. Accepted at ICLR 2026 (oral, per search excerpt). The GEPA README states "100–500 evaluations vs. 5,000–25,000+ for GRPO" and frames the textual feedback as "the text-optimization analogue of a gradient" (Actionable Side Information). | [B] (self-reported benchmark results in a peer-reviewed paper) | https://arxiv.org/abs/2507.19457 (blocked; abstract via excerpts) · https://github.com/gepa-ai/gepa (read) |
| **MIPROv2** jointly optimizes instructions and few-shot demonstrations with Bayesian search; was the strongest DSPy optimizer before GEPA. Secondary sources put MIPROv2's aggregate gain at roughly half of GEPA's. | [C] | https://futureagi.com/blog/dspy-optimizers-explained/ · https://deepeval.com/docs/prompt-optimization-miprov2 |
| **Decagon** reports using GEPA in production with a "test-driven" approach (evals as unit tests, human review of proposed prompts). | [C] (page blocked; title/excerpt only) | https://decagon.ai/blog/optimizing-gepa-for-production |
| **Anthropic prompt improver + Evaluations tab** (Console, Oct 14 2024): improver applies 5 techniques (chain-of-thought, example standardization to XML, example enrichment, rewriting, prefill); Evaluations tab has an "ideal output" column and 5-point grading; the intended loop is "give Claude additional feedback in the prompt improver on what's still not working and repeat". Vendor-reported: 30% accuracy gain on a classification task, 100% word-count adherence on summarization. | [A] vendor docs / [C] for the numbers | https://claude.com/blog/prompt-improver (read) · https://docs.anthropic.com/en/docs/test-and-evaluate/eval-tool |
| **Anthropic, "Demystifying evals for AI agents" (Jan 9 2026)**: start with 20–50 tasks drawn from real failures, not hundreds; three grader types (code-based, model-based, human — humans calibrate model graders); run automated evals pre-launch and in CI/CD "on each agent change and model upgrade"; production monitoring surfaces failures that become new regression tests ("no single evaluation layer catches every issue"); a complete picture "includes production monitoring, user feedback, A/B testing, manual transcript review, and systematic human evaluation". | [A] vendor guidance | https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents (read) |
| **promptfoo**: open-source CLI/library; declarative YAML test cases and assertions; side-by-side model/prompt comparison; "automate checks in CI/CD"; red-teaming; runs locally. | [A] project docs | https://github.com/promptfoo/promptfoo (read) |
| **Braintrust / LangSmith**: comparison sites characterize Braintrust as datasets + scorers + experiments + CI gates + online scoring ("evaluation results applied before changes reach production"), and LangSmith as tracing/observability with annotation queues and dataset curation from production traces. Vendor docs were blocked. | [C] | https://www.braintrust.dev/articles/langsmith-vs-braintrust · https://arize.com/blog/best-prompt-testing-optimization-tools/ · https://blog.promptlayer.com/braintrust-vs-langsmith/ |
| **Prompts/models as runtime configuration with experiments** — LaunchDarkly AI Configs (GA): prompts, parameters and model selection pulled out of code into flags; A/B tests on prompts and models with the experimentation engine; instant rollback; guardrail metrics defined before the experiment (hallucination rate, toxicity, PII leakage, p95 latency); canary 1–5% then ramp; "limit who can modify prompts and define rollback conditions". Statsig argues offline evals are insufficient and pushes online experiments on prompt/model changes. | [A] vendor docs (snippet) / [C] | https://launchdarkly.com/blog/ai-configs-ga-runtime-control-prompts-models/ · https://launchdarkly.com/blog/ai-experimentation/ · https://www.statsig.com/blog/llm-optimization-online-experimentation · https://atlan.com/know/ab-testing-llm-applications/ |

### 1.2 Learning-based model routing and evidence of savings

| Finding | Grade | Source |
|---|---|---|
| **RouteLLM (LMSYS, 2024)**: routers trained on Chatbot Arena human-preference data (matrix factorization, BERT, causal-LLM, weighted-Elo); "reduce costs by up to 85% while maintaining 95% GPT-4 performance on widely-used benchmarks like MT Bench"; also 45% on MMLU and 35% on GSM8K; ">40% cheaper" than commercial routers at equal quality. Caveats from the README: trained specifically on the GPT-4 / Mixtral-8x7B pair; "threshold calibration results vary based on actual query composition"; figures are benchmark-dependent. Key insight repeated by secondary sources: preference data generalizes better than task labels because it captures when the weak model is "good enough". | [B] (benchmark, self-reported) | https://github.com/lm-sys/RouteLLM (read) · https://arxiv.org/abs/2406.18665 (blocked) · https://www.lmsys.org/blog/2024-07-01-routellm/ (blocked) |
| **Not Diamond**: a learned "meta-model" router trained from your own prompts, candidate responses and evaluation scores; ships a default router across 60+ models and powers OpenRouter's Auto mode. A 2026 blog cites the RouterArena benchmark ranking Not Diamond last of 12 and "frequently selects expensive models" (I could not open RouterArena to confirm). | [C] (unverified benchmark claim) | https://dreaming.press/posts/2026-06-21-routellm-vs-notdiamond-vs-martian.html · https://nomadx.ae/blog/llm-model-routing-routellm-openrouter-notdiamond-2026/ |
| **OpenRouter Auto Router**: exposes a `cost_quality_tradeoff` dial 0 (always most capable) … 10 (always cheapest), default 7, no surcharge. | [C] (snippet; docs blocked) | https://entelligence.ai/blogs/9-best-llm-routers-and-model-routing-tools-in-2026 |
| **Martian**: "model mapping"/interpretability-driven routing; market context: OpenRouter in talks at ~$1.3B, Martian near the same. | [C] | https://www.bestaiweb.ai/openrouter-martian-and-not-diamond-the-2026-llm-router-race-and-where-agent-cost-optimization-is-heading/ |
| Practitioner claims of 30–85% or 60–75% savings from routing are common but all trace back to RouteLLM-style benchmarks; no independent controlled study of production savings was found. | [C] | https://klymentiev.com/blog/llm-router · https://www.digitalapplied.com/blog/llm-model-routing-2026-cost-quality-optimization-engineering-guide |
| **Research list** (Not Diamond's "awesome routing"): FrugalGPT cascades, Hybrid LLM difficulty router, AutoMix — listed without quantified savings. | [B] papers (list read) | https://github.com/Not-Diamond/awesome-ai-model-routing (read) |

### 1.3 Anthropic's current effort / model-selection guidance (what exists as of Sept 2026)

| Finding | Grade | Source |
|---|---|---|
| **Effort docs** (platform.claude.com): five levels (low/medium/high/xhigh/max); "effort is a behavioral signal, not a strict token budget"; defaults high (medium on Opus 5.5). Recurring instruction: "step down to `medium` or `low` for routine or latency-sensitive work **once your evals show quality holds**"; "run an effort sweep on your own evals rather than carrying settings over from an earlier model"; "effort level names don't correspond to the same amount of thinking across models" (Fable 5.1 guide); per-message effort change (beta) preserves the prompt cache; changing top-level effort mid-conversation invalidates cache. Cost metric attribute `effort` is exported per request. | [A] | https://platform.claude.com/docs/en/build-with-claude/effort (read) · https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1 (read) |
| **Claude Code model-vs-effort blog (Jul 7 2026)**: the diagnostic question is "did it not *try* hard enough, or did it not *know* enough?" — raise effort when Claude skipped a file / didn't run tests / didn't double-check; pick a larger model when the problem is "genuinely hard" (subtle bugs, unfamiliar domains, architecture); pick a smaller model for routine mechanical edits; treat effort as a general preference, not a per-task decision. The post does **not** describe a measurement loop. | [A] vendor guidance | https://claude.com/blog/claude-model-and-effort-level-in-claude-code (read) |
| **Claude Code model config**: `opusplan` (Opus plans, Sonnet executes), `ultracode` (xhigh reasoning, Claude decides when to think deeper), `ultrathink` keyword for a one-off deep turn; "In Anthropic's testing, Opus 5.5 at medium matches or exceeds Opus 5 at high"; "Calibrate effort … test different levels against your own work". | [A] | https://code.claude.com/docs/en/model-config (read) |
| I found **no Anthropic document dated September 2026** specifically about "effort/model selection loops"; the closest are the July 2026 blog above and the effort docs' "sweep on your evals" wording. | — | — |

### 1.4 "AI flywheel" case studies (B2B / enterprise)

| Finding | Grade | Source |
|---|---|---|
| **Airbnb, "Agent-in-the-Loop" (EMNLP 2025 Industry track)**: human support agents give four categories of explicit feedback on AI responses inside their normal workflow; feeding it back produced +11.7% retrieval recall, +8.4% response helpfulness, +4.5% agent adoption, and cut retraining cycles "from months to weeks". | [B] | https://arxiv.org/html/2510.06674v2 (blocked) · https://aclanthology.org/2025.emnlp-industry.135.pdf (blocked; numbers from excerpts) |
| **NVIDIA Data Flywheel blueprint**: production prompt/response logs tagged by `workload_id` → deduplicated → stratified eval/fine-tune datasets → candidate smaller models scored by an LLM-judge similarity metric; explicitly "a flashlight, not an autopilot": engineers review high-scoring candidates and decide promotion; internal claim of up to 98.6% cost reduction (Llama 3.2 1B fine-tuned reaching ~98% of a 70B model on tool calling). Marked deprecated April 2026. | [B]/[C] vendor | https://github.com/NVIDIA-AI-Blueprints/data-flywheel (read) |
| **Adaptive Data Flywheel: MAPE control loops for agent improvement** — Monitor-Analyze-Plan-Execute cycles with error attribution, curation, fine-tuning, deployment. | [B] | https://arxiv.org/html/2510.27051v1 (blocked; excerpt) |
| **Cursor Tab online RL (Sept 2025)**: accept/reject on every suggestion is the reward (+0.75 accepted, −0.25 rejected, 0 silence → only show when P(accept) > 25%); result: 21% fewer suggestions with 28% higher accept rate; deploy→collect→retrain cycle 1.5–2 h over 400M+ requests/day. | [C] vendor engineering post (observational) | https://cursor.com/blog/tab-rl (blocked; excerpt) |

---

## 2. Learning from user behavior

### 2.1 Acceptance / rejection and edit signals

| Finding | Grade | Source |
|---|---|---|
| **Ziegler et al., "Measuring GitHub Copilot's Impact on Productivity" (CACM, Mar 2024)**: 2,047 survey responses matched to usage telemetry; **acceptance rate was the usage metric most correlated with perceived productivity**; acceptance is higher off-hours / on less complex tasks; it varies by language. | [B] | https://dl.acm.org/doi/10.1145/3633453 (blocked; excerpt) |
| Typical Copilot acceptance rates across studies: 21–23.5% (CACM), ~30–33% (other field studies), highest for Go/TypeScript/Python/Java. RCT-style speed gains (55% faster in GitHub's controlled task; 42% at ANZ) are task-level, not product-level. | [B] | https://arxiv.org/pdf/2502.13199 · https://arxiv.org/pdf/2601.20112 · https://linearb.io/blog/is-github-copilot-worth-it |
| **Cursor Tab**: accept/reject is the training signal (see 1.4). Rejections and "silence" are treated as first-class signals. | [C] | https://cursor.com/blog/tab-rl |
| **Claude Code telemetry already exports the raw signals a learning loop needs**: `claude_code.code_edit_tool.decision` with `decision=accept|reject` and `source=config|hook|user_permanent|user_temporary|user_abort|user_reject`, `language`; `claude_code.cost.usage` with `model`, `effort`, `agent.name`, `skill.name`, `plugin.name`, `mcp_tool.name`; `lines_of_code.count`; `user_prompt` event (prompt content redacted unless `OTEL_LOG_USER_PROMPTS=1`). | [A] | https://code.claude.com/docs/en/monitoring-usage (read) |
| Google's 2022 internal study of ML code completion reported acceptance 25–34% and a ~6% reduction in coding iteration time — showing teams look **past acceptance** to downstream outcomes. | (recalled, unverified — domain blocked) | https://research.google/blog/ml-enhanced-code-completion-improves-developer-productivity/ |
| **METR RCT (2025)**: 16 experienced OSS developers were 19% *slower* with AI tools while believing they were 20% faster — perceived productivity is not a safe proxy. | [A] | cited in https://tech-insider.org/ie/ai-code-quality-crisis-2026/ and https://www.deviqa.com/blog/state-of-ai-generated-code-2026-the-qa-and-testing-gap/ |

### 2.2 AI usage analytics

| Finding | Grade | Source |
|---|---|---|
| **Pendo Agent Analytics (2025)**: extends product analytics to in-product AI agents: conversation logs, failure signals ("rage prompts", unsupported requests, errors), whether the user accomplished the intent, what they did before/after, adoption trends; Pendo claims 350+ agents and 2.5M prompts/week tracked. | [C] vendor (snippet) | https://support.pendo.io/hc/en-us/articles/44480532063899-What-s-new-in-AI-features · https://www.pendo.io/product/analytics/ |
| **Amplitude** shipped AI Agents (autonomous insight generation, proactive cohort surfacing) in 2026. | [C] | https://www.ideaplan.io/compare/pendo-vs-amplitude |

### 2.3 Support-question clustering to find product/knowledge gaps

| Finding | Grade | Source |
|---|---|---|
| **Intercom Fin — Unresolved questions**: unresolved conversations are automatically clustered into topic groups (Fin had no answer / user asked for a human / abandoned); a side panel shows the related content Fin used. **AI-powered suggestions**: generated by "analyzing failed Fin responses (escalations, poor-quality replies) and comparing them to successful human replies to similar questions"; each suggestion is "ranked by impact so you can prioritize the fixes that improve the most conversations"; a human accepts/edits. This is the closest commercial analogue to DCC's per-screen "insights → improvement task". | [A] vendor docs (snippet) | https://www.intercom.com/help/en/articles/8890980-dig-into-fin-ai-agent-unresolved-questions · https://www.intercom.com/help/en/articles/11394959-use-ai-powered-content-recommendations-to-improve-fin · https://fin.ai/help/en/articles/11420114-use-ai-powered-suggestions-to-improve-fin |
| **Zendesk Content Cues**: reviews incoming tickets daily, clusters common questions/keywords into "support topics", tags tickets with the topic ID; **a topic is suggested only when 11 or more related tickets exist**; humans review the underlying tickets and create/update articles; also flags articles needing update or better discoverability. | [A] vendor docs (snippet) | https://support.zendesk.com/hc/en-us/articles/4408834068890-Understanding-Content-Cues · https://support.zendesk.com/hc/en-us/articles/4408845477402-Reviewing-suggested-support-topics-in-Content-Cues |

### 2.4 How products propose improvements to humans (gated suggestions)

| Finding | Grade | Source |
|---|---|---|
| **Claude Code auto memory**: Claude writes notes to itself from corrections/preferences (4 typed kinds), stored as plain markdown under `~/.claude/projects/<project>/memory/` with a `MEMORY.md` index (first 200 lines / 25 KB loaded); the user can browse, edit or delete via `/memory`; "Claude treats them as context, not enforced configuration. **To block an action regardless of what Claude decides, use a PreToolUse hook instead.**" Explicit asks ("always use pnpm") go to auto memory; "add this to CLAUDE.md" routes to the shared file. | [A] | https://code.claude.com/docs/en/memory (read) |
| **Claude Code `/init` (new flow, `CLAUDE_CODE_NEW_INIT=1`)**: "asks which artifacts to set up: CLAUDE.md files, skills, and hooks … explores your codebase with a subagent, fills in gaps via follow-up questions, and **presents a reviewable proposal before writing any files**"; if CLAUDE.md exists, "/init suggests improvements rather than overwriting it". (DCC's onboarding already drives this.) | [A] | https://code.claude.com/docs/en/memory (read) |
| **Cursor Memories**: generated in the background from conversations; Cursor added user approval for background-generated memories "to ensure trust and control" (v1.2 changelog). | (recalled, unverified — cursor.com blocked) | https://cursor.com/docs/context/memories |
| **GitHub Copilot automations (cloud agent)**: "Suggestions appear in a panel on the issue. From the panel you can: Accept or decline each suggestion individually." "Every supported action records the reason behind it, whether the automation applied the change automatically or proposed it as a suggestion. This gives you an audit trail of what changed and why." And the caveat that matters for DCC: **"Approvals are a workflow convenience, not a security control. They don't enforce a server-side boundary, so an agent with permission to change issues can apply changes directly instead of proposing them."** | [A] | https://github.com/github/docs/blob/main/content/copilot/concepts/agents/cloud-agent/about-automation-rationale-and-approvals.md (read) |
| **Microsoft HAX Guidelines for Human-AI Interaction (CHI 2019; 18 guidelines validated with 49 practitioners against 20 AI products)** — the ones that bear on gated suggestions: G3 time services based on context; G4 show contextually relevant information; G8 support efficient dismissal; G9 support efficient correction; G13 learn from user behavior; G14 update and adapt cautiously; G15 encourage granular feedback; G16 convey the consequences of user actions; G18 notify users about changes. | [A] | https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/ (read; guideline list from the paper) · https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/ |

### 2.5 Proactive suggestions — when they help and when they annoy

| Finding | Grade | Source |
|---|---|---|
| **"Need Help? Designing Proactive AI Assistants for Programming" (CHI 2025)** and **"Assistance or Disruption?" (CHI 2025)**: the same suggestion is perceived as supportive when timed to natural pause points (e.g., after finishing a function) and disruptive when it interrupts active work, even with identical content; a "persistent suggest" condition was rated distracting/annoying; suggestions should be summarized so the user can decide relevance quickly; mistimed frequent help risks learned helplessness. A five-day field study (IUI 2026) reports similar timing effects. | [A] controlled studies | https://dl.acm.org/doi/10.1145/3706598.3714002 · https://dl.acm.org/doi/10.1145/3706598.3713357 · https://dl.acm.org/doi/10.1145/3742413.3789148 · https://arxiv.org/pdf/2410.04596 (all blocked; excerpts) |
| **Process-aware tutors (2026)**: perceived adaptiveness is the strongest positive predictor of accepting an intervention; perceived annoyance the strongest negative one. | [B] | https://arxiv.org/pdf/2604.06178 (blocked; excerpt) |

### 2.6 How products measure that a change helped

- Anthropic: automated evals in CI on every change + production monitoring + A/B tests + human review as calibration (1.1). [A]
- LaunchDarkly/Statsig: online experiment with a primary metric **and** pre-declared guardrails that must all hold; canary 1–5% then ramp; rollback conditions (error rate, latency, cost). [A]/[C]
- Intercom ranks suggestions by expected impact before the change; Zendesk uses a ticket-count threshold (11+) as the gate. [A]
- Microsoft measured its Copilot redesign with 8 interviews + 79 survey responses, load time −50%, and before/after usage lifts (Word +27%, Excel +33%, PowerPoint +43%, Outlook +30%) — a before/after, not a controlled comparison. [B] https://www.microsoft.com/en-us/microsoft-365/blog/2026/05/28/introducing-a-new-design-for-microsoft-365-copilot/ (read)
- Cursor: accept-rate and suggestion-count moved together (fewer, better suggestions) — a paired metric that guards against "just show fewer". [C]

---

## 3. Governance: AI proposes, human approves, audit trail

| Finding | Grade | Source |
|---|---|---|
| **Renovate Dependency Dashboard** — the canonical "bot proposes, human gates" mechanism: with `dependencyDashboardApproval` Renovate does not open a PR until a human ticks the checkbox in an auto-created issue; can be required for all updates, for major versions only, or for named packages; vulnerability-remediation PRs bypass approval; closed/ignored updates are listed and re-ticking regenerates the PR; automerge covers the low-risk classes. Everything is visible in issues/PRs, i.e., an audit trail by construction. | [A] | https://github.com/renovatebot/renovate/blob/main/docs/usage/key-concepts/dashboard.md (read) |
| **Dependabot/Renovate pattern**: the PR carries the change, release notes and a compatibility signal; humans review; scheduled automerge for approved classes. | [C] | https://konvu.com/compare/dependabot-vs-renovate · https://appsecsanta.com/sca-tools/dependabot-vs-renovate |
| **Claude Code GitHub Action (security doc)**: only users with write access can trigger; bots are rejected unless allow-listed; token is short-lived and repo-scoped; by default Claude **does not create the PR** — it commits to a branch and gives "a link to the GitHub PR creation page… The user must click the link and create the PR themselves, ensuring human oversight before any code is proposed for merging"; commits are unsigned by default with optional API/SSH signing; on PR events, Claude config paths (`.claude/`, `CLAUDE.md`, `.mcp.json`…) are restored from the base branch so an untrusted PR can't rewrite the agent's instructions; the docs page adds "review Claude's changes before merging". | [A] | https://github.com/anthropics/claude-code-action/blob/main/docs/security.md (read) · https://code.claude.com/docs/en/github-actions (read) |
| **GitHub Copilot cloud agent automations**: accept/decline per suggestion; reason recorded for every action; approvals are "a workflow convenience, not a security control" — the boundary must be enforced by permissions. | [A] | see 2.4 |
| **Claude Code memory vs hooks**: memory/CLAUDE.md are advisory context; hooks (PreToolUse) are the enforcement layer. Same principle as GitHub's caveat. | [A] | https://code.claude.com/docs/en/memory (read) |
| **Docs bots that open PRs**: Mintlify's Automations agent "watches your codebase, detects when docs have drifted… and opens a pull request with a proposed fix on a schedule or webhook trigger". | [C] (snippet) | https://happysupport.ai/blog/ai-doc-writer · https://www.mintlify.com/library/best-code-documentation-tools |

Pattern that emerges across all of them: (1) the proposal is a first-class artifact in the system of record (issue checkbox, PR, suggestion panel) with its rationale attached; (2) a human with the right permission accepts; (3) low-risk classes can be auto-applied by explicit policy (automerge, vulnerability PRs); (4) the approval UI is not the security boundary — permissions/hooks are.

---

## 4. Chat vs other AI UX forms in work apps

### 4.1 What the big products actually do

| Product | Form | Grade | Source |
|---|---|---|---|
| **Microsoft 365 Copilot (redesign, May 28 2026)** | Three surfaces: a Copilot app with left nav for agents/conversations; "a consistent entry point across apps that sits above your work" opening a **side pane** that acts as "an editing partner that can suggest changes or make them, with clear signals so you always know what it's doing"; and **canvas invocation** "within a paragraph, cell, or slide, so the interaction begins where the work already lives". Rationale: progressive disclosure; design for output "tone, structure, readability, usefulness, and trustworthiness". Evidence: 8 interviews + 79 survey responses; load time −50%; response time −10%; usage lifts 27–43% per app after rollout. | [A] vendor, before/after | https://www.microsoft.com/en-us/microsoft-365/blog/2026/05/28/introducing-a-new-design-for-microsoft-365-copilot/ (read) |
| **Microsoft 365 Copilot extensibility UX guidelines (MCP apps)** | Rule of thumb: "If the task can be completed in a concise, single-turn interaction, use inline mode"; the side pane is for "more complex, multi-turn conversations and cross-application data access". | [A] vendor docs (snippet) | https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-mcp-apps-ui-guidelines |
| **Atlassian (Rovo)** | Design-system page for AI/Rovo patterns exists (atlassian.design/patterns/ai-rovo); Atlassian's engineering blog catalogues non-chat AI UX patterns: form filling, ghost text, proactive triggers, modular memory — "beyond chat". Rovo itself = chat sidebar + agents + inline actions in Jira/Confluence. | [C] (blocked; excerpts) | https://www.atlassian.com/blog/development/ai-user-experience-patterns · https://atlassian.design/patterns/ai-rovo/ |
| **Figma / Copilot / Linear / Notion** | Roundup: Figma generates inside the canvas; Copilot suggests inside the line being written; Linear auto-triages issues without an explicit AI trigger; Notion AI sits inside documents and editing flows — "AI gets adopted faster when it feels embedded into existing behavior instead of layered on top". | [C] | https://hackernoon.com/how-ai-quietly-changed-modern-ux-patterns |
| **Salesforce Agentforce, Superhuman** | Product pages blocked; not verified this session. Superhuman's own palette guidance: see 4.2. | — | — |

### 4.2 Command palettes

| Finding | Grade | Source |
|---|---|---|
| Superhuman's guide to building a command palette; palettes (Cmd+K in Linear, Figma, Notion, Vercel, Raycast, Slack) are "the ARIA combobox pattern: a text input with a listbox popup"; subsequence matching lets "sloppy half-typed queries" work; "shortens the path… allows them to skip the linear information architecture"; "transform users into power users". Note: every source frames palettes as a power-user accelerator, not a discovery tool for novices. | [C] | https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/ (blocked; excerpt) · https://medium.com/design-bootcamp/command-palette-ux-patterns-1-d6b6e68f30c1 · https://www.techinterview.org/post/3233475212/build-command-palette-cmd-k/ |

### 4.3 UX research: conversational vs GUI; "chat is a bad default"

| Finding | Grade | Source |
|---|---|---|
| **NN/g, "AI: First New UI Paradigm in 60 Years" (Nielsen, 2023)**: AI introduces "intent-based outcome specification"; but "current generative AI tools like ChatGPT and Bard have deep-rooted usability problems" — users must articulate intent in prose (the articulation problem hits users with weaker literacy hardest). | [B] (snippet) | https://www.nngroup.com/articles/ai-paradigm/ |
| **NN/g, "The 6 Types of Conversations with Generative AI"**: 425 analysed interactions; six conversation types from vague prompts to precise questions; "different conversation types serve distinct information needs and require varied interfaces". | [B] (snippet) | https://www.nngroup.com/articles/AI-conversation-types/ |
| **NN/g, "Accordion Editing and Apple Picking"** / **"Response Outlining"**: "the conversational UI stops being easy when users must perform significant extra work to modify output, and the current endlessly scrolling chat window offers poor support" for these behaviours. | [B] (snippet) | https://www.nngroup.com/articles/accordion-editing-apple-picking/ · https://www.nngroup.com/articles/response-outlining/ |
| **NN/g, "GenUI in Real Life: Buttons and Checkboxes"**: generative UI is appearing first *inside* chat — buttons, form fields, checkboxes generated contextually when the AI judges them useful. | [B] (snippet) | https://www.nngroup.com/articles/genui-buttons-and-checkboxes/ |
| **Wattenberger, "Why Chatbots Are Not the Future" (2023)**: a text field has "unclear affordances" (the same rectangle could be search, a credit-card field, or a chatbot); chat forces alternation between typing and reading, breaking flow; alternatives are controls embedded in the work (sliders, inline transformations). | [C] essay | https://wattenberger.com/thoughts/boo-chatbots/ (blocked; excerpts) · https://simonwillison.net/2023/May/15/why-chatbots-are-not-the-future/ |
| **Maggie Appleton, "Language Model Sketchbook, or Why I Hate Chatbots"**: chat is "the lazy solution"; bring models into thinking environments as embedded scaffolding (daemons, branches) rather than a destination. | [C] essay | https://maggieappleton.com/lm-sketchbook (blocked; excerpt) |
| **UX Collective, "The chat box isn't a UI paradigm. It's what shipped."** — practitioner synthesis of the same critique (2026). | [C] | https://uxdesign.cc/the-chat-box-isnt-a-ui-paradigm-it-s-what-shipped-96e931d92769 |
| **Counter-evidence**: chat is where adoption actually happened — Pew (June 2025): 34% of US adults have used ChatGPT (double 2023); app-store usability analysis ranks ChatGPT highest among GenAI apps; Microsoft's usage lifts came with a side pane still at the centre. | [B] | https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11623163/ · Microsoft blog above |
| **Design Principles for Generative AI Applications** (Weisz et al., 2024) and the **Survey of UI design techniques in GenAI apps** (2024) — academic catalogues of non-chat patterns (multiple outputs, co-editing, imperfection signalling). | [B] | https://arxiv.org/pdf/2401.14484 · https://arxiv.org/pdf/2410.22370 |

### 4.4 Generative UI

| Finding | Grade | Source |
|---|---|---|
| **Google A2UI** (open standard): agents emit declarative JSON referencing a **trusted catalog of pre-approved components** (buttons, text fields, cards…) rather than executable code; a flat, incrementally-updatable component list "easy for LLMs to generate incrementally"; rationale: security (no arbitrary generated code), portability across Flutter/React/Angular/web components, and LLM-efficiency; targets both chat-embedded responses and "adaptive enterprise dashboards". | [A] project docs | https://github.com/google/A2UI (read) |
| Academic: "Rethinking the UI of GenUI: A Tale of Two Designs" (2026); "Bridging Gulfs in UI Generation through Semantic Guidance" (2026); DIS '25 GenUI study. | [B] | https://arxiv.org/pdf/2606.13843 · https://arxiv.org/pdf/2601.19171 |

### 4.5 Proactive nudges — see 2.5 (CHI 2025 evidence) and HAX G3/G4/G8 (2.4).

### 4.6 Non-technical users

- NN/g's articulation problem (4.3) and HAX G1/G2 ("make clear what the system can do / how well") are the core guidance: a free-text prompt box assumes the user can name what they want; embedded, labelled actions and GenUI elements remove that burden. [B]/[A]
- GOV.UK's content guidance (5.2) is the best-documented standard for plain-language help aimed at the general public. [A]

### 4.7 RTL / Hebrew

| Finding | Grade | Source |
|---|---|---|
| **Material Design bidirectionality**: mirror layouts for RTL; mirror only directional icons/sequences; text alignment follows script. | [A] (snippet) | https://m2.material.io/design/usability/bidirectionality.html |
| Chat-specific practice: messages in Hebrew/Arabic flow RTL, **code blocks stay LTR**, mixed content relies on the Unicode Bidirectional Algorithm; foundation is `dir` on `<html>`, CSS logical properties, direction-aware icons/animations/form fields; test line-height and wrapping with RTL fonts explicitly. | [C] | https://simplelocalize.io/blog/posts/rtl-design-guide-developers/ · https://www.txl.co.il/post/hebrew-arabic-rtl-localization-design-challenges-and-how-to-solve-them · https://arxiv.org/pdf/2101.08070 |
| Even leading AI chat panels ship LTR-only: Claude Code issues #26665 (Feb 18 2026, chat panel "hardcoded to LTR", asks for auto-detect / `chatDirection` setting / code blocks LTR) and #11050. | [C] | https://github.com/anthropics/claude-code/issues/26665 (read) · https://github.com/anthropics/claude-code/issues/11050 |

---

## 5. Contextual help systems

### 5.1 Digital-adoption / in-app guidance vendors

| Finding | Grade | Source |
|---|---|---|
| Pendo (analytics + guides, free tier), Appcues (no-code, fast, thin analytics), WalkMe (enterprise, employee-facing, cross-platform), Chameleon (design-forward, API-first, "look native"), Userpilot (PLG, segmentation), Userflow, UserGuiding, Intro.js, Frigade. All inject tooltips/tours as overlays managed outside the codebase; pricing from ~$69–89/mo to $10K–100K+/yr. Chameleon's pitch ("make in-app prompts look exactly like native UI") is the tell: overlays are not the same as native, code-owned help. | [C] | https://www.pendo.io/pendo-blog/the-top-8-in-app-guidance-tools-in-2025/ · https://www.chameleon.io/alternative/appcues-alternatives · https://www.vibereference.com/product-and-design/product-tour-providers · https://www.worknet.ai/blog/pendo-vs-walkme-vs-appcues-daps-compared-2026 |

### 5.2 Design-system guidance for help text and tooltips

| System | Guidance | Grade | Source |
|---|---|---|---|
| **GOV.UK Design System** | Use hint text only for help that applies to most users ("how their information will be used, or where to find it"); "Keep hint text to a single short sentence, without any full stops"; "Do not use links in hint text" (screen readers don't announce it's a link); screen readers read the whole hint on focus, so long hints frustrate; if a question needs a long explanation, restructure the question instead. | [A] | https://github.com/alphagov/govuk-design-system/blob/main/src/components/text-input/index.md (read) · https://design-system.service.gov.uk/components/text-input/ |
| **Shopify Polaris** | "Use the label to provide instructions critical to using the text field"; help text and placeholder are for "additional, non-critical instructions"; help text is wired with `aria-describedby` so screen readers hear it with the label. | [A] | https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/components/selection-and-input/text-field.mdx (read) |
| **Atlassian** | A tooltip "briefly describes an interactive element on mouse hover or keyboard focus"; "a floating, non-actionable label used to explain a user interface element or feature". | [A] (snippet) | https://atlassian.design/components/tooltip/usage/ |
| **Microsoft Fluent 2** | Tooltips "provide supplemental, contextual information"; "helpful but non-essential, plaintext information"; "additional — not redundant — information"; "limit the content… to just the essentials". | [A] (snippet) | https://fluent2.microsoft.design/components/web/react/core/tooltip/usage |
| **Material 3** | Plain tooltips (a short label) vs rich tooltips (title, text, optional actions); "only include short, descriptive text". | [A] (snippet) | https://m3.material.io/components/tooltips |
| **NN/g Tooltip Guidelines** | Tooltips are for non-essential, supplementary information; keep them brief; never hide information users need to complete the task in a tooltip; make their existence discoverable (e.g., an icon); they are unreliable on touch devices. | [B] (snippet) | https://www.nngroup.com/articles/tooltip-guidelines/ |
| **NN/g Onboarding tutorials vs contextual help** | Contextual, just-in-time hints "when well-timed and clearly differentiated from interactive elements, are more effective than upfront tutorials because they meet users in the actual context of use"; use progressive disclosure inside help ("Learn how" for more). | [B] (snippet) | https://www.nngroup.com/articles/onboarding-tutorials/ |
| **Progressive disclosure** (Nielsen, 1995→) | Show the essentials, reveal detail on demand; contextual help and inline examples are among its standard forms. | [B] | https://en.wikipedia.org/wiki/Progressive_disclosure · https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/ |

Common denominator across all five systems: help/tooltip text is **short, plain, non-essential, non-interactive, and announced to assistive tech**; anything essential belongs in the label or the page, not the tooltip. DCC's "one or two plain sentences, and for a costly button what happens if you press it" already sits inside this envelope; the "what happens if you press it" part is closer to HAX G16 ("convey the consequences of user actions") than to classic tooltips.

### 5.3 Single-source terminology / glossary systems

| Finding | Grade | Source |
|---|---|---|
| **Microsoft Terminology**: Microsoft's product terminology in ~100 languages, published as **TBX** (TermBase eXchange, the ISO standard) for import into CAT tools and other termbases; intended to keep UI and documentation consistent across languages ("base IT glossary"). | [A] (snippet) | https://learn.microsoft.com/en-us/globalization/reference/microsoft-terminology · https://en.wikipedia.org/wiki/TermBase_eXchange |
| **Docusaurus terminology plugin (grnet)**: one markdown file per term with `id`, `title`, `hoverText`; links to a term become inline tooltips in every doc; a glossary page is generated from the same files — "a single source file serves multiple purposes". | [A] project docs | https://github.com/grnet/docusaurus-terminology (read) |
| **docusaurus-plugin-glossary (mcclowes)**: JSON glossary (`term`, `definition`, abbreviations, related, categories); a remark plugin auto-detects terms at build time and wraps them in `<GlossaryTerm>` with dotted underline + tooltip that always shows the **canonical** term; abbreviation expansion on first use; generated glossary page with search. | [A] project docs | https://github.com/mcclowes/docusaurus-plugin-glossary (read) |
| **Material for MkDocs**: `abbr` + `pymdownx.snippets` with `auto_append` of one `includes/abbreviations.md` makes every occurrence of a term a tooltip site-wide; `content.tooltips` feature for styling. | [A] project docs | https://github.com/squidfunk/mkdocs-material/blob/master/docs/reference/tooltips.md (read) |
| **Ditto** (product-copy single source of truth): text as reusable components with keys, variables, plurals; Figma plugin; API/CLI/React SDK; "headless CMS for your team's product text"; approvals and edits tracked. | [C] (snippet; site blocked) | https://developer.dittowords.com/introduction · https://www.dittowords.com/ |
| **UX Content Collective, "3 experiments: creating a copy single source of truth"** — practitioner report on what broke when trying to keep design/copy/code in one place. | [C] (blocked; title only) | https://uxcontent.com/ux-copy-single-source-truth/ |
| **Does anyone drive tooltip + chatbot + docs from ONE registry?** Not as a documented product. Nearest precedents: (a) Intercom — the help-center article base feeds Fin's answers, the "related content" panel, and the content-gap suggestions (one corpus, three consumers) [A snippet]; (b) docs-as-code glossary plugins — one term file → inline tooltips + glossary page [A]; (c) Ditto — one string store → Figma + code [C]; (d) Microsoft Terminology — one termbase → UI + docs localization [A]; (e) the asb-tui project's "UI-element registry + help catalog + CI checker" (see 6.3) [C]. DCC's concept-keyed registry consumed by tooltip, chat and docs, with a lint, is a combination I did not find anywhere else. | — | — |

---

## 6. Packaging the help mechanism as a portable library

### 6.1 Headless tooltip primitives

| Finding | Grade | Source |
|---|---|---|
| **Radix Primitives** (WorkOS-maintained; 19k+ stars): unstyled, WAI-ARIA-compliant, composable parts (Tooltip: Provider/Root/Trigger/Portal/Content); positioning delegates to Floating UI, so a Radix tooltip already depends on Floating UI. | [A] | https://github.com/radix-ui/primitives (read) · https://www.radix-ui.com/primitives/docs/components/tooltip (blocked) |
| **Floating UI**: framework-agnostic anchor positioning (`@floating-ui/dom`) with collision handling; `@floating-ui/react` adds interaction hooks (hover, focus, role, dismiss); Vue and React Native packages; "Platform API" for canvas/WebGL. This is the right layer for a portable, non-React core with React bindings on top. | [A] | https://github.com/floating-ui/floating-ui (read) |

### 6.2 Content registries: i18n formats, JSON/YAML vs code

| Finding | Grade | Source |
|---|---|---|
| **i18next**: JSON resources in namespaces; plurals, context, nesting, interpolation; backends/caching; "use it everywhere" (React, Angular, jQuery, Node, Deno); large plugin ecosystem; Locize as the hosted TMS. A concept-keyed help registry maps naturally onto a dedicated namespace (e.g., `help.<concept>`). | [A] | https://github.com/i18next/i18next (read) |
| **ICU MessageFormat / FormatJS**: logic (plural, select) lives inside the message string; `i18next-icu` bridges the two; `icu-to-json` compiles ICU at build time. Trade-off discussed by practitioners: i18next JSON is simpler for key–value help text; ICU is stronger for grammar-heavy strings. | [C] | https://github.com/i18next/i18next-icu · https://github.com/jantimon/icu-to-json · https://dev.to/eric_allard_97d455ae56a4e/icu-vs-i18next-choosing-the-right-format-for-your-localization-needs-1cel · https://phrase.com/blog/posts/guide-to-the-icu-message-format/ |
| Content in JSON/YAML vs code: every mature system above (i18next, FormatJS extraction, Docusaurus glossary JSON, mkdocs abbreviations file, Ditto, TBX) keeps the **content as data** with a stable key and a typed schema, and keeps **behaviour in code**. Type-safe key access is achieved by generating types from the data (i18next `resources` typing, FormatJS extraction). | [C] synthesis | as above |

### 6.3 Lint-enforced completeness — precedents

| Precedent | What fails | Grade | Source |
|---|---|---|---|
| **eslint-plugin-formatjs `enforce-description`** — every message descriptor must carry a `description` (translator context); option `literal` forces a string literal; newer versions can require a **minimum description length**. Sibling rules: `enforce-default-message`, `enforce-id`, `no-literal-string-in-jsx`. | build (as error) | [A] (snippet; docs site blocked) | https://formatjs.github.io/docs/tooling/linter/ · https://github.com/formatjs/formatjs/blob/main/packages/eslint-plugin-formatjs/CHANGELOG.md |
| **eslint-plugin-i18next `no-literal-string`** — flags user-visible literal text not wrapped in `t()`. | build | [A] | https://github.com/edvardchen/eslint-plugin-i18next (read) |
| **@intlify/eslint-plugin-vue-i18n `no-missing-keys`** — a key used in code that is absent from the locale file is an error; in the `recommended` config. | build | [A] | https://github.com/intlify/eslint-plugin-vue-i18n/blob/master/docs/rules/no-missing-keys.md (read) |
| **eslint-plugin-lingui** — `no-unlocalized-strings`, `require-comment` (translation context required), `require-explicit-id`, `t-call-in-function`. | build | [A] | https://github.com/lingui/eslint-plugin (read) |
| **eslint-plugin-jsx-a11y** — `control-has-associated-label` (every interactive control must have text/aria-label; off by default), `label-has-associated-control`, `alt-text` (in recommended). Same shape as DCC's rule: "an element that names something must open an explanation". | build | [A] | https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/blob/main/docs/rules/control-has-associated-label.md (read) |
| **asb-tui issue #61, "enforce meaningful contextual-help coverage in CI"** — an authoritative UI-element registry (stable ID, route, role, lifecycle), a help catalog, and a CI checker that fails closed on missing/placeholder (`TODO`, `TBD`, `lorem`) or boilerplate entries, requires minimum useful length, covers element states (disabled, empty, loading, error), and tracks exemptions with reasons and owners. The closest precedent to DCC's `audit:stale` + `no-info:` opt-out, in a small OSS project. | CI | [C] | https://github.com/martin-beck/asb-tui/issues/61 (read) |
| **shadcn-ui/lint** — "an agent-first linter for Tailwind design systems. Write design system rules that agents can verify." Precedent for lint rules written so that a coding agent can self-check. | CI | [C] | https://github.com/shadcn-ui/lint |
| Angular ESLint template accessibility rules (labels, alt text, headings) — same analogy in another framework. | build | [C] | https://www.bitovi.com/blog/angular-a11y-eslint-rules |

No published library was found that ships **help text + a lint for its completeness** as one package; the pieces exist separately (i18n extraction + missing-key rules; a11y label rules; glossary plugins).

---

## 7. Machine-generated vs human-written help text

### 7.1 Quality and trust

| Finding | Grade | Source |
|---|---|---|
| **Stack Overflow Developer Survey 2025**: 84% use or plan to use AI tools, but only ~33% trust the accuracy of AI output (down from 43%); 66% name "AI solutions that are almost right, but not quite" as the top frustration; 45% say debugging AI output is more time-consuming than writing it. | [B] survey (snippet; site blocked) | https://survey.stackoverflow.co/2025/ai · https://stackoverflow.blog/2026/02/18/closing-the-developer-ai-trust-gap/ |
| **METR RCT** (2025): experienced developers 19% slower with AI while feeling 20% faster — self-reports overstate AI help. | [A] | see 2.1 |
| **CodeRabbit (Dec 2025)**: AI-authored PRs show ~1.7x more defects than human ones. | [C] vendor analysis | https://tech-insider.org/ie/ai-code-quality-crisis-2026/ |
| **Source-attribution effect**: in a study of AI vs human-authored documents, readers who rated AI documents "fully complete" more often correctly identified them as AI (57%) than readers of human documents did (44%) — perceived completeness and provenance interact. | [B] | https://arxiv.org/pdf/2401.04120 (blocked; excerpt) |
| **MDN "AI Explain" (July 2023)**: MDN added an LLM "explain this" button to reference pages; the community documented confidently wrong explanations within days and Mozilla paused the feature — the canonical cautionary tale for machine-generated help text placed next to authoritative docs without review. | (recalled, unverified — the yari issue search returned nothing this session) | https://github.com/mdn/yari/issues |
| **LLM vs human experts in requirements engineering** (2025): LLM output rated competitive on some criteria but with systematic gaps — supports "AI drafts, expert edits". | [B] | https://arxiv.org/pdf/2501.19297 |

### 7.2 Drift detection when the UI changes

| Finding | Grade | Source |
|---|---|---|
| **Swimm**: docs are anchored to specific lines of code; when those lines change in a PR, Swimm flags the linked doc for review ("living documents"). | [C] (snippet) | https://happysupport.ai/blog/ai-doc-writer · https://slite.com/learn/documentation-automation-tools |
| **Mintlify Automations** (enterprise): an agent watches the codebase, detects drift, and opens a PR with a proposed fix on a schedule/webhook — but it is "tied to specific code patterns and still leaves customer-facing UI documentation exposed". | [C] (snippet) | https://www.mintlify.com/library/best-code-documentation-tools · https://learn.mintlify.com/courses/structure-docs/keeping-docs-current |
| **Screenshot-based doc tools (Scribe, Tango, Guidde)**: drafts are built from screenshots "which silently break the moment the UI ships"; Scribe lists automatic drift detection as "coming soon". A reviewer's verdict: "eight of the ten leading AI doc writers solve drafting beautifully and have no answer for drift". | [C] | https://happysupport.ai/blog/ai-doc-writer · https://ekline.io/blog/documentation-maintenance-tools |
| I found **no product that diffs UI screenshots to update help/tooltip text**. The mechanism that exists is visual regression testing (Radix runs Chromatic for visual diffs) — it detects that a screen changed, not that its help text is now wrong. The closest to DCC's `info:drift` ("explanations on lines a change touched") is Swimm's line-anchoring, applied to code rather than UI. | [A] for Chromatic use | https://github.com/radix-ui/primitives (read) |

### 7.3 Hybrid workflows (AI drafts, human approves) — working examples

- Intercom Fin: AI proposes content fixes ranked by impact; a human accepts/edits (2.3). [A]
- NVIDIA flywheel: "a flashlight, not an autopilot" — humans promote candidates (1.4). [B]
- Claude Code `/init`: reviewable proposal before any file is written; `/init` on an existing CLAUDE.md "suggests improvements rather than overwriting" (2.4). [A]
- GitHub Copilot automations: per-suggestion accept/decline with recorded rationale (2.4). [A]
- Anthropic evals: LLM graders calibrated by systematic human evaluation; human review reserved for what automation can't judge (1.1). [A]
- Anthropic prompt improver: AI rewrites, developer tests against ideal outputs and iterates (1.1). [A]

---

## What the evidence supports

### A. A learning system (proposals from usage signals, human-approved, measured)

1. The industry's working loops all have the same skeleton — collect real failures → convert to test cases → propose a change → gate it → measure in production — and Anthropic's own guidance says to start with 20–50 tasks from real failures, not hundreds ([A] Demystifying evals).
2. Automated prompt optimizers are real and cheap now: GEPA-style reflective optimization reaches RL-level gains with 100–500 evaluations by reading textual feedback, which is exactly the kind of signal DCC's event log already stores ([B] GEPA).
3. A prompt/model/effort change should be treated as **runtime configuration under experiment**, with a primary metric plus pre-declared guardrails (error/escalation rate, latency, cost), canary then ramp, and a rollback condition ([A] LaunchDarkly; [A] Anthropic evals mention A/B testing).
4. Effort is the first lever, model the second: Anthropic says to run an effort sweep on your own evals and to step down only "once your evals show quality holds"; the diagnostic for switching model is "didn't try hard enough vs didn't know enough" ([A] effort docs; [A] Jul 2026 blog). A DCC proposal type "lower effort on task class X" is directly supported; "switch model" needs an eval set to be safe.
5. Learned routing saves money in benchmarks (up to 85% at 95% GPT-4 quality on MT-Bench) but is benchmark- and pair-dependent, and commercial routers are contested; for a small product, per-task-class effort/model rules derived from DCC's own outcome data are better evidenced than a generic router ([B] RouteLLM; [C] RouterArena claims).
6. Acceptance/rejection is a valid but shallow signal: it is the best predictor of *perceived* productivity ([B] Ziegler), it powers Cursor's loop ([C]), and Claude Code already exports it per edit with a `source` attribute ([A] OTel) — but METR shows perception can invert reality ([A]), so proposals should be measured on downstream outcomes (rework, escalation, task completion), not on accept rate alone.
7. Clustering repeated questions into gaps is exactly what Intercom and Zendesk ship; both gate on volume (Zendesk: 11+ tickets) and Intercom ranks proposals by expected impact and compares failed AI answers with successful human answers ([A]). DCC's per-screen insight clustering matches the state of the art; adding a volume threshold and an impact estimate would match it fully.
8. Human agents' structured feedback categories, fed back on a cadence, moved Airbnb's support AI by 4–12 points on core metrics and cut retraining from months to weeks ([B]); "typed" feedback beats free-text thumbs.
9. Proposals must be first-class artifacts with rationale attached (Renovate dashboard item, PR, suggestion panel) and every applied or proposed action should record *why* ([A] Renovate; [A] GitHub automations). This matches DCC's event log and "no silent actions".
10. Approval UIs are not security boundaries: GitHub says so explicitly, and Claude Code says memory/CLAUDE.md are "context, not enforced configuration — use a PreToolUse hook to block" ([A] both). DCC should enforce "proposal-only" at the hook/permission layer, not only in the screen.
11. Reviewable proposals before writing files already exist in the tool DCC wraps (`/init` new flow; `/init` suggests improvements to an existing CLAUDE.md) ([A]) — a DCC "add a skill/hook/agent to a repo" proposal can reuse that mechanism and its diff-style review.
12. Timing and frequency decide whether proactive proposals are welcomed: same content is helpful at a natural pause and annoying mid-task; persistent suggestions were rated distracting ([A] CHI 2025). Batch proposals into a review moment (end of task, weekly digest) rather than interrupting.
13. HAX G13/G14/G15/G18 ([A]): learn from behaviour, but "update and adapt cautiously", ask for granular feedback, and notify users about changes — i.e., announce every applied improvement in-product.
14. Measure "did it help" with before/after on the very signal that triggered the proposal (fewer repeated questions on that screen, fewer rejections on that prompt), plus a guardrail that nothing else got worse; Microsoft's redesign used before/after usage plus a small interview/survey panel ([B]).
15. No "AI flywheel" case study with a controlled design was found in B2B SaaS; the evidence is industry papers and vendor reports ([B]/[C]). Expect to generate DCC's own evidence.

### B. The chat: is it the right form?

1. The strongest vendor evidence (Microsoft, May 2026) keeps a chat **side pane** but demotes it: a consistent entry point "above the work", inline invocation "within a paragraph, cell, or slide", and progressive disclosure; usage rose 27–43% after this change ([A], before/after).
2. Microsoft's explicit rule: single-turn, concise tasks → inline; multi-turn or cross-context → side pane ([A]). Applied to DCC: a glossary answer or a named action is inline material; "explain this whole screen to me" or a multi-step change stays in the pane.
3. Chat's weaknesses are documented, not just argued: unclear affordances of a free text box, flow interruption (Wattenberger [C]), poor support for editing/modifying outputs in an endless scroll (NN/g [B]), and an articulation burden that falls hardest on users with weaker writing skills (NN/g [B]) — i.e., precisely DCC's non-developer Hebrew-speaking managers.
4. Counter-evidence: chat is where adoption actually happened (34% of US adults used ChatGPT by mid-2025; ChatGPT tops usability rankings among GenAI apps [B]). Chat is a safe *fallback*, not a good *default*.
5. NN/g's six conversation types "require varied interfaces" ([B]): the answerable-from-glossary questions DCC already serves without a model call are the "precise question" type and belong closest to the element (the "i"), not in a pane.
6. Command palettes are power-user accelerators (every source frames them so) and assume the user can name the action ([C]); for developers in DCC a Cmd+K over named actions is well supported, for managers it is not the primary surface.
7. Embedding beats layering across the products surveyed (Figma in canvas, Copilot in the line, Linear auto-triage, Notion in the doc) ([C] roundup; [A] Microsoft) — DCC's per-screen scoping is the right direction; the next step is per-element scoping.
8. Generative UI is arriving as *controls generated inside answers* from a trusted catalog (A2UI [A]; NN/g GenUI [B]): a DCC answer can carry buttons for its named actions instead of asking the user to type a command — which also makes approval explicit.
9. Proactive suggestions work when timed to pauses and summarized for quick relevance judgement; persistent ones annoy ([A] CHI 2025). A DCC "suggestions" surface should be pull-first (a badge/inbox) with rare, well-timed pushes.
10. HAX G1/G2/G16 ([A]): make clear what the assistant can do and how well, and convey the consequences of an action — DCC's action approval dialog should show consequence text from the same registry that powers the "i".
11. RTL matters more for chat than for forms: messages must flow RTL while code blocks stay LTR and mixed strings rely on the bidi algorithm; even Claude Code's own panel was LTR-only as of Feb 2026 ([C]) — a chat in Hebrew needs explicit bidi handling and RTL-font testing.
12. No research was found that chat is *worse* for non-technical users when it is scoped and offers suggested prompts/actions; the evidence points to "chat plus structure", not "no chat".

### C. The "i" help mechanism and its portability

1. Every major design system converges on the same rules for tooltip/help text: short, plain, non-essential, non-interactive, announced to assistive tech; essential information goes in the label or page ([A] GOV.UK, Polaris, Atlassian, Fluent, Material; [B] NN/g). DCC's 1–2 sentence rule fits; the "what happens if you press it" clause is a consequence statement (HAX G16) and may deserve its own field.
2. GOV.UK's specifics are the most usable constraints for a plain-language registry: one short sentence, no links, no full stops, only when there is a demonstrated need ([A]).
3. Contextual, just-in-time help beats upfront tutorials ([B] NN/g) — the "i" is the right investment relative to tours/walkthroughs; DAP overlays (Pendo, WalkMe…) are the outsourced version and are managed outside the code ([C]).
4. "One term file → inline tooltips everywhere + generated glossary page" is an established docs-as-code pattern (Docusaurus terminology/glossary plugins, Material for MkDocs) ([A]); DCC's concept registry is the same idea moved into the product UI.
5. No product was found that drives tooltip + chatbot + docs from one registry; the nearest are Intercom (one article base → agent answers, related content, gap suggestions) and Ditto (one string store → design + code) ([A]/[C]). DCC's combination is unusual and worth keeping as a differentiator.
6. Content belongs in data with stable keys and a schema (i18next namespaces, FormatJS descriptors, TBX termbases, glossary JSON) ([A]) — a portable package should ship: a JSON/YAML registry schema, a resolver (`getConcept`), a headless tooltip binding, and the lint, with the Hebrew wording as one locale.
7. Radix Tooltip is already built on Floating UI; for portability beyond React, Floating UI's framework-agnostic core with `@floating-ui/react` bindings is the layer to target ([A]).
8. Lint-enforced completeness has direct precedents: FormatJS `enforce-description` (every message needs a description; minimum length available), vue-i18n `no-missing-keys`, i18next `no-literal-string`, Lingui `require-comment`, jsx-a11y `control-has-associated-label` ([A]); and a fail-closed CI checker over a UI-element registry with placeholder detection and owned exemptions (asb-tui #61 [C]). DCC's audit is in good company; adding placeholder/min-length checks and owned `no-info:` exemptions would match the strongest precedent.
9. Machine-generated help text is trusted less than code: only ~33% of developers trust AI accuracy and "almost right" is the top complaint ([B] SO 2025); METR shows people overrate AI help ([A]); the MDN "AI Explain" episode shows the reputational cost of unreviewed generated explanations next to authoritative content (recalled).
10. The hybrid that works everywhere is "AI drafts, human approves, with the rationale recorded": Intercom, NVIDIA, GitHub automations, Claude Code `/init` ([A]/[B]). For the registry: generate a draft entry for a new concept key, require human sign-off, and record who approved (fits the event log).
11. Drift is the unsolved half of generated docs: screenshot-based tools break silently; only code-anchored approaches (Swimm) and scheduled agent PRs (Mintlify) detect it ([C]). DCC's `info:drift` (re-check explanations on lines a change touched) is ahead of most doc tools; keep it, and consider a "concept touched by this diff" report as a PR check.
12. Non-technical readers get the least benefit from generic generated text and the most from plain, consistent terminology (Microsoft Terminology's whole purpose) ([A]); Hebrew wording should stay human-owned with AI proposing edits, and the English/other-locale versions can be machine-drafted from the approved Hebrew.
13. Accessibility wiring is part of the contract: help text must be reachable by keyboard/focus and announced (`aria-describedby`) — Polaris and GOV.UK document this ([A]); a portable component should own it.
14. Tooltips are unreliable on touch and hover-only devices ([B] NN/g); the "i" should be a click/tap target (as DCC already does), not hover-only.

---

## Gaps and things not found

- No Anthropic document dated September 2026 on "effort/model selection loops"; the July 2026 blog and the effort docs' eval-sweep guidance are the current word.
- No controlled study of routing savings in production; no controlled "AI flywheel" study in B2B SaaS.
- No product that diffs UI screenshots to update help text; no library that ships help text + completeness lint together.
- RouterArena's ranking of commercial routers could not be verified (site not reachable).
- Cursor Memories approval flow, MDN "AI Explain", Google's completion-retention metric are from memory and marked unverified.
- Salesforce Agentforce, Superhuman, Linear, Notion and Figma product pages were blocked; their forms are described only via third-party roundups.
