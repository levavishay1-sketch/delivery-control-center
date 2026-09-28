# Onboarding proves itself — the process measures what it delivers, and delivers only what it verified

Status: **in progress** — engine, build, diagnosis and screens landing 2026-09-29; see `tasks.md`.

Appetite: **large** (user-directed: fix the process, not the one repository;
any step or sub-step may change; the diagram moves with it; the result is
measured on six repositories before it is called done).

## Why

The onboarding run on the TRADE repository (2026-09-28, `485aa0ad`) cost
$13.45, wrote 37 files, delivered 33, and reported "3/5 → 3/5". An audit of
that run — the code, the run's own records, the session transcripts, every
delivered file against the repository, and the published research on
context files — found that the process could not know whether it had helped,
delivered what it had not checked, handed back decisions it had already
reached, and spent without a ceiling:

- The trial told the agent it had "no instructions and no helpers" before
  **and after** the build, loaded the operator's own `~/.claude` in both
  runs, asked five read-only questions (so hooks, permissions and agents
  could not move the score), judged with Haiku and no repository access
  against eight diagnosis lines as "truth" (a right answer, `dotnet
  vstest`, was failed), and sampled once — 3/5 → 3/5 hid two tasks that
  flipped in opposite directions.
- "Installed · not checked here" was delivered: a skill naming paths that
  do not exist, twelve per-package files that "passed" with nothing to
  check, a rule whose whole-file check passed with a missing path. Three
  agents failed on format (a numbered checklist, a preamble before the
  frontmatter) with no second attempt. The gate script ran `msbuild` while
  `dotnet msbuild` was on the machine.
- The scan of the `/init` draft ran an hour **after** the person had
  approved 48 cards as a set; its six "redundant" verdicts became notes and
  every one was built. The draft's leftovers (a test project's DLLs) misled
  the author into writing a skill for a project that was not in git.
- The interactive draft session was 41% of the cost, uncapped, and its
  $5.55 never reached the ledger after an API restart. The per-call cap the
  policy computed never reached the CLI.
- The deny list covered the first 40 sensitive files alphabetically (of
  138), a file with a password stayed readable, `.gitignore` ignored a
  package folder the repository commits on purpose, and the run's record
  files carried the operator's local path, the interview's answers, the
  costs and the secrets' locations into the client's repository.

The research agrees on the method: measure **with and without** the
delivered set, on real tasks, more than once, with code graders first
(Anthropic's plugin evals and agent-eval guidance); and it warns that
generated context files help little unless short, specific and verified
(Evaluating AGENTS.md, ETH 2026).

## What changes

The seven steps and their names stay. Five things change inside them:

1. **The measurement** (`eval/`): a bank of 9 knowledge and 12 action
   tasks chosen by the profile, run in two detached worktrees — one at the
   baseline, one holding exactly the deliverable set — that load only the
   copy's own configuration; code graders first (what changed, what ran,
   what was blocked, what was claimed), a judge with repository access only
   where the code cannot decide; step 4 runs the "without" arm, the build
   runs the "with" arm and a second run of the tasks whose arms disagree;
   pass^k per arm, a delta **per component** from the tasks that exercise
   it, "proposed for removal" for a component with no gain.
2. **Nothing unverified ships**: a text component is verified or failed
   (missing path, unverified command, zero checkable claims, relative
   paths resolved, tolerance 0, a rule checks its own line); connections
   are `configured`; one fix attempt with the validator's message; shared
   files composed from the cards that passed; a failed card's files deleted;
   names from stable keys, a collision is a failure; one sanitised
   `.dcc/onboarding.json`; deliverable = verified | configured.
3. **The plan step's order**: cards drawn, then the (capped) draft session,
   set aside on exit including what it built, scanned against the clean
   copy, the scan's verdicts **applied** as undoable declines — and only
   then one decision round. The author runs apart from the copy's
   instructions.
4. **The money**: every onboarding call carries its cap to the CLI; the
   draft session has a dollar and minute cap the monitor enforces; its
   spend reaches the ledger on exit, restart, build, delivery and cancel;
   a cost envelope precedes the measurement and the build.
5. **The diagnosis tells the truth about what it does not know**: no
   silent caps on sensitive files or packages, no "hot spots" from one
   commit, the tools on this host, test projects from git, a large generated
   file, corrected external-system classes; the templates follow (deny by
   pattern, a gate script from the tools present, per-package files only
   when a package differs, hooks that cover PowerShell and `git add … &&
   git commit`, no `-diff` on generated paths).

## What does not change

The five foundational decisions; the seven steps and their names; the
interview and its bank; the rules table as a structure; the chat; the
coach's mechanism (it reads `configured` as installed and gets the
per-component delta as one more signal).

## How it is proven

Unit tests for the pure modules (bank, graders, report, verification,
build, diagnosis); `prove:onboarding` with the stand-in emitting tool
events; the standalone `eval:onboarding` on TRADE's current set (the "old
process" number), a new run on TRADE, and the process on five public
repositories of different stacks plus DCC itself — the criterion per
repository: ≤ 12 delivered files, no unchecked file, no task worse with
the set, cost per session ≤ +20%, on average ≥ +2 tasks; a repository that
fails is a finding about the mechanism.
