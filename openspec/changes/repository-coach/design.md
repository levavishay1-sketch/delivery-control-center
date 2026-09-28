# Repository onboarding as a coach — design

## The rule that replaces "what `/init` decided"

A component enters only when there is evidence that its problem exists in
this repository — from the code, the history, the trial, or real work:

| what was seen | kind of component |
|---|---|
| the agent did not know a fact | a rule line, a doc |
| it knew and still did the wrong thing | a hook, a permission |
| it repeats the same procedure | a skill |
| it lacked information outside the repository | an MCP connection, an agent with access |
| it erred and nobody caught it | a reviewing agent |
| it could not verify itself | build/test scripts, a runner |

The rules table (`rules.json`) is data: `when` is a condition over the profile
(`path` + comparison, `fn` for the six helpers in `rules.ts`), each component
carries its Hebrew card text with `{placeholders}` filled from the context the
code computes, and a rule declares nothing the code does not read. A
correction on a fact holds back every rule whose condition reads it, and the
plan says so.

## Where a model is used, and where never

| the code alone | a model |
|---|---|
| diagnosis, the rules, trust grading of sources, judging when checkable, grouping, build order, validation, the report, every stage transition, what gets installed, pass/fail when checkable, writing to the repository, which files are the `/init` draft, whether a path the draft names exists, setting the draft aside | trial tasks (executor), the judge where the code cannot judge (a different model than the executor), breaking processes into steps and answering the agent test, the open marketplace search, authoring text (AGENTS.md purpose, docs, skill bodies, agent checklists), the reviewer's two questions, turning a person's request into a card, the editor's reading of the `/init` draft against ours |

Every model call is a row of the prompt library with a contract in
`prompt-contract.ts`, a capability in `config/model-policy.json`, and a ledger
row carrying its step.

## The `/init` draft: scanned, never merged by itself

`/init` improves over time and reads the code freely, so its draft may say
something better than our templates — or something wrong, generic or unsafe.
Neither side wins by default. The draft is every file the session wrote (from
its transcript) plus every changed file where instructions live. The editor
(`onboarding.init_scan`, the strongest tier, read-only tools in the copy) gets
all the evidence, our AGENTS.md as the build would write it now, our cards, and
the draft, and returns one plan: a verdict (adopt / merge / partial /
keep_ours), a comparison per topic, and items — each with a decision (take,
check, ask), a form (a line, a section of AGENTS.md, a new file), the exact
text, and its need, evidence, alternative, verification and cost — plus which
of our cards are redundant and what of the draft was left out and why.

Knowledge is not authorisation: the editor decides what is true of the code,
never what the agent may do (a client's environment, deployment, production,
an organisation's policy). Such an item is "ask" — a card whose approval is
the answer.

The code then checks every path an item names against the copy (too many
missing → not recommended), refuses a settings file, `.mcp.json` or a hook as
a whole file and never overwrites a file the repository has, and puts every
item in the approval group whatever the automation level. A card of ours the
editor finds redundant gets a note; the person decides. A second scan keeps a
decision already taken on the same text (the key is a hash of it).

Before the build writes anything the draft is set aside — kept under the run's
runtime folder, its files put back to the baseline — so it reaches the pull
request only through an approved card. A card from the draft is built after
ours in the same family: a section appended as written, a line among the
rules, a new file as it is — and validated like every other text.

## The steps as state

`repository_onboarding_step` rows, one per step, the same statuses as before.
A step that costs money or writes outside the copy stops in `WaitingForUser`:
the interview (always — it is the one place we ask before spending), the
trial's cost (unless the level is הפיך = עושה ומדווח), the plan (always), the
delivery (always). `advance()` runs the next step when nobody is needed. A
step interrupted by a restart is failed with a message; its button reruns it.

## Cards

`onboarding_component`: key, kind, family, title/why/what (Hebrew, from the
rule or the source), source + sourceRef, group (by risk and level), risk,
context tokens, how it is verified, status, params (what the builder needs),
files, validation, questions, the decision. The same key from two sources is
merged, the evidence joined. A coach run's cards come from its approved
proposals and are approved at birth.

## Build and verification

`build.ts` is pure on the file system: the catalog renders, shared files are
merged (settings.json deny/hooks/plugins, .mcp.json, AGENTS.md sections,
.gitignore, .gitattributes), and the injected `author` writes what a model
must write. `verify.ts` validates by kind; `passed: null` means "cannot be
verified here", said in words, never a pass. The trial runs again on the same
tasks; the delta belongs to the set. Per-component ablation is the coach's
job when a component is suspected.

## The coach's thresholds

Relative and repeated: a check failing on ≥2 tasks and ≥⅓ of the tasks that
ran it; ≥2 tasks with a second run and an implementation cause; the last five
tasks' cost ≥25% above the earlier window with a component that loads ≥1,500
tokens; a remembered source whose page hash changed since the last run. One
proposal per (component, kind) until it is decided; a declined one rests 60
days.

## What is deliberately not here

- Per-component `claude plugin eval --ablation`: it measures packaged plugins;
  raw files are measured as a set, and the coach proposes removal by measure.
- Live MCP connection during the build: it needs the client's credentials;
  the card says so and the first session measures the context.
- Human-edit counts from developers' sessions: not captured yet; reruns per
  task stand in, and the health score says which measures have data.
