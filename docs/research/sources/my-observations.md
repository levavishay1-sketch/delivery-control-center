# First-hand observations (Fable, 2026-09-27) — before agent reports

## A. Architecture facts established by reading code
- Claude is invoked by spawning the local `claude -p … --output-format json` CLI under the user's own login (ai-assist.ts:30-56). No API key, no Agent SDK. Consequences: DCC server must run on a machine with a logged-in Claude Code; Windows-specific hacks (claude.cmd via shell, NO_TOOLS="NoTools", short-name TEMP path bug); cost comes from the CLI's own report; identity = whoever is logged in on that machine, NOT the acting DCC user (the ledger records the DCC user, but the Anthropic account is the machine's).
- Prompts live in the DB (`prompt_template`, 22 rows), editable from the Prompts screen; code declares a "contract" (vars/keeps) per prompt (prompt-contract.ts). Good idea; but the Prompts screen is a top-level nav item visible to every user (incl. non-developers).
- Model routing = rules in config/model-policy.json (tiers haiku/sonnet/opus; no Fable; `chat` on haiku with effort:low which Haiku ignores). "escalateOn" rules reference signals (ambiguity/breadth/novelty) — need to check whether anything actually computes them (survey).
- Event log append-only; Context Brief is ASSEMBLED (no LLM) from structured state (brief/generate.ts) and injected by SessionStart hook. Good and cheap.
- Tenancy: client → workitem tree (no project layer, comment in tenancy.ts says "There is no project layer" — but openspec/project.md still says client → project → workitem: doc/code drift on a foundational decision's wording).
- `service_connection` table exists (kind + config JSON) — currently used for ADO.
- Onboarding: 4 stages (prepare/init/review/deliver) around a live PTY `/init` session; automation presets step_by_step/guided/automatic/custom; model+effort per run; cost per stage from status line. Three generations in ~2 weeks: v1 (many stages) → v2 (fewer stages, DCC prompts) → v3 (native /init). Research doc 09-23 (after v3) says: /init as candidate generator only, Measure before Generate, Validate with Δ, P0 first.
- Requirement flow in code: assess (prompt → gaps, sets phase=shaping) → gaps ping-pong (chat "gaps" topic, stateless, action blocks resolve/dismiss) → breakdown (prompt → hierarchy with ADO rungs, `prompt` per node, compiledComponents call-graph, standard checks added) → approve tasks → materialize to ADO → start (phase=building, does NOT block on open gaps; startedWithOpenBlocker flag) → implement per task (claude -p in isolated checkout, build recipe deterministic first, checks) → review/PR.
- Task status is COMPUTED from facts (task-status.ts) — 17 status keys; flow steps computed with "rounds" when a dependency arrives later (rollback + rerun is a person's action).
- 161 API routes in one server.ts file. apps/web is hash-routed single App.tsx with an if/else chain; screens call api.ts.
- Chat: one global chat (claude-in-dcc §4.1), topic per screen record; step zero answers from glossary/facts with no model call; Haiku otherwise; roll-over by tokens/age; actions as proposal cards; "helpful?" + re-ask detection; insights cluster repeated questions per screen (SQL, threshold 5) → Sonnet names finding → "open improvement task" on the internal client.

## B. Live test of the chat (real calls)
- "מה זה פער?" → glossary answer, no model. Correct.
- "מה השלב הבא?" → facts answer ("בחינת בשלות הדרישה"). Correct.
- "למה הדרישה במצב 'בבנייה' אם עוד לא פורקה למשימות?" → step zero matched the glossary term "דרישה" with certainty and answered with the page description — NOT an answer. The cheap path misfires on any question that contains a glossary word. This is measurable: every step-zero answer is logged with payload.from=glossary; the "re-asked within a minute" signal would catch it only if the user re-asks. Precision cost of "the cheapest token is the one not sent".

## C. UX observations from screenshots (1440×900, RTL)
1. Requirement screen: 5-step stepper (בחינת בשלות → פערים → פירוק → אישור ב-TFS → התחלת עבודה). Demo record is phase=building, yet step 1 is highlighted as current and step 5 shows ✓ — statuses contradict each other on one screen (owner's complaint exactly). Cause: phase is a stored field the demo set directly; the stepper derives from other facts.
2. Language mix on a screen for a Hebrew non-developer: tabs "Overview / Timeline / Dependencies", card "REPOSITORIES", tiles "Risk/Priority/Phase/AI budget/Executor/TFS", "CONTEXT BRIEF — WHAT THE NEXT CLAUDE SESSION LOADS", nav items "Azure DevOps", "Repositories", "Audit Trail" screen fully English with "min ago 1" broken bidi.
3. Developer artifacts exposed to the end user: the Context Brief raw markdown in a monospace block (bidi-broken: "_.Load the full timeline…"); model names (Haiku/Sonnet/Opus) as the choice in "מה אתה מצפה מהבדיקה?"; Model policy card on Settings ("Gaps: sonnet → opus כשהעמימות גבוהה"); Prompts screen (22 prompt bodies) at top level.
4. Destructive actions in primary positions: "מחיקה" red button in the requirement header next to "עריכה"; "מחק" inline link on every row of the requirements list.
5. Terminology drift visible: "דרישות" screen lists "דרישות-על" (epics) with a "תת-דרישות" column; dashboard has "דרישות-על פעילות" and "דרישות פתוחות"; "עבודות" screen (#/work) lists the same items as "דרישות בכל הלקוחות". The word for the top entity changes between screens (דרישה / דרישת-על / עבודה / Epic / Feature / Customer Portal).
6. Navigation: 11 items; "משתמשים" is a stub; "פרומפטים" and "הגדרות" are admin-level but sit among daily screens; wishlist already says "reorganize navbar".
7. Empty states are decent (explain what to do). The "i" is everywhere (dozens per screen) — consistent, but on dense screens (Claude center) it becomes visual noise: ~30 "i" glyphs on one page.
8. Chat: floating "שאל את קלוד Ctrl K" bottom-left; opens as an overlay panel on the left with "עגן ליד המסך" (dock) option; 6 suggestion chips; a 2-line disclaimer under the input. Reasonable. But the panel covers the screen's content it is supposed to talk about unless docked.
9. Flow page (#/flow/:id): toggles "היררכיה/תלויות" × "רשימה/קוביות" + spec pane — 4 view combinations of the same tasks; with zero tasks the page is two empty boxes.
10. Onboarding pre-start page: clear explanation of 4 stages, automation presets (4), model & effort selector (Sonnet 5 default). Good copy. But it promises "rules לפי נתיב, hooks, skills לפי דרישה, CLAUDE.md" as outputs of /init — and the only verified run wrote 1 file (CLAUDE.md +22 −7).
11. Claude center: rich (5 tabs, ~20 tiles), mostly zeros with one client; the "insights" concept ("שאלה שחוזרת היא פער במוצר") is implemented and visible.
12. Audit Trail screen: English title/labels, but content Hebrew-ready; "Person" as actor for delegated Claude actions.

## D. Prompt quality (read the actual texts)
- assess.readiness.* : DoR/INVEST criteria; 5 tiers (quick/standard/thorough/audit/custom) that differ mainly in depth wording + model; shared output contract enforces JSON, Hebrew, question-shaped gaps with whoAnswers/options/impactIfWrong/blocking/confidence. Solid. Weakness: one-shot, no memory of previous assessments, "baked" is binary.
- breakdown.tasks (6.5k chars): hierarchy rules mapping to ADO rungs, appetite, affectedPaths, compiledComponents via call-graph walk (very specific to compiled .NET/CRM world), kind task|check, `prompt` per node "the most important field". The prompt bakes organisational rules (Feature above >1 User Story) into the text — configuration living in a prompt.
- gaps.conversation: stateless second opinion with action blocks; read-only code tools; letter to the requester. Good design; each turn re-sends all facts (cost grows with files up to 40k chars).
- chat.system 4.3k chars on Haiku.
- Standard checks (build/tests/regression/e2e) are separate prompts run via claude -p; build has a deterministic recipe first (build-recipe.ts, msbuild detection).

## E. Things that look like real risks
- PGlite single-process constraint has cost two full resets; production is meant to be Postgres but "real-Postgres proof" is still an open Phase-0 task (1.13/1.14).
- `claude -p` under one machine login = identity and concurrency bottleneck: every DCC user's Claude calls run under the server machine's account; two users' runs = two CLI processes on the same machine; no queue visible (check survey).
- 3 onboarding redesigns in 2 weeks + a research doc that contradicts the shipped design = the "lost" feeling is structural: no decision record about which model of onboarding is the target.
- Foundational decision 4 says client→project→workitem; code says no project layer. Small, but it is one of "the five".
