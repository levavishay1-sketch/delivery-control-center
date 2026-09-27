# Does a deterministic diagnosis yield a different, justified set of AI-agent components per repository?

**Answer: yes.** Eleven repositories (ten public, one client clone) were diagnosed with the same script and the same 32 decision rules. The result is 11 distinct component sets; the most similar pair shares 69% of its rules (cline ~ codex), the least similar pair 0% (fastapi-template ~ pydatasci-handbook). Every component carries a reason that quotes a measured fact from that repository.

Files in this folder:

| file | what |
|---|---|
| `diagnose.py` | the deterministic diagnosis (Python, no LLM, no network); `python3 diagnose.py <path> <name>` prints one JSON |
| `diagnosis/<repo>.json` | the 11 diagnoses (kept after cleanup) |
| `rules.json` | 32 decision rules: signal -> components -> reason template |
| `apply_rules.py` | applies the rules; writes `components/<repo>.json` and `components/summary.md` |
| `components/` | the 11 component sets, plus the rule-firing matrix |
| `trials/` | the `claude -p` trial runs (JSON results + `run.sh`) |
| `repos.txt` | the clone list |
| `build_report.py`, `report_text.py` | this report's generator |

Date: 2026-09-27. Clones were deleted after the run; the diagnosis JSON is what remains.

## 1. The repositories

| # | repo | URL | commit | size (clone, depth 200) | kind | AI config | why chosen |
|---|---|---|---|---|---|---|---|
| 1 | cline | https://github.com/cline/cline | 252082b (2026-09-26) | 124 MB, 4135 files | React+TypeScript (VS Code extension webview + Bun monorepo) | AGENTS.md, .claude/, .clinerules, copilot-instructions, .agents/skills (70 files) | the React+TS pick; the richest existing AI configuration in the sample |
| 2 | fastapi-template | https://github.com/fastapi/full-stack-fastapi-template | cb740b6 (2026-09-01) | 4.7 MB, 252 files | Python web service (FastAPI + SQLModel + React frontend) | .claude/skills, .agents/skills (8 files) | the Python service pick; small, tested, 15 CI workflows |
| 3 | gh-cli | https://github.com/cli/cli | 9b03115 (2026-09-25) | 55 MB, 1475 files | Go CLI | AGENTS.md, CLAUDE.md | real CLI with 4344 commits in the clone, 173 authors, acceptance tests |
| 4 | spring-petclinic | https://github.com/spring-projects/spring-petclinic | 818c413 (2026-08-26) | 3.8 MB, 132 files | Java Spring Boot service | none | the canonical Spring sample; Maven **and** Gradle; devcontainer |
| 5 | eshop | https://github.com/dotnet/eShop | b4a4087 (2026-08-28) | 39 MB, 1142 files | .NET 10 microservices (Aspire, EF, gRPC, Blazor, MAUI client) | none | modern .NET with 28 projects and orchestration; contrast to the client repo |
| 6 | terraform-aws-eks | https://github.com/terraform-aws-modules/terraform-aws-eks | 1b45087 (2026-09-25) | 3.7 MB, 185 files | Terraform module | none | IaC with pre-commit (fmt/validate/tflint/docs) and examples as tests |
| 7 | codex | https://github.com/openai/codex | 41f9084 (2026-09-27) | 130 MB, 8609 files | Rust + TypeScript monorepo (cargo workspace + pnpm) | AGENTS.md, .codex/skills (20 files) | the monorepo pick; 164 packages, 29 CI workflows, 764 header-marked generated files |
| 8 | phpmyadmin | https://github.com/phpmyadmin/phpmyadmin | 09b821d (2026-09-27) | 103 MB (blob-filtered), 3035 files | legacy PHP + jQuery + Twig | none | 296 authors; translation dirs and static-analysis baselines dominate the churn |
| 9 | pydatasci-handbook | https://github.com/jakevdp/PythonDataScienceHandbook | d662314 (2023-05-05) | 68 MB, 264 files | data/ML, 136 Jupyter notebooks | none | notebooks only: no tests, no CI, no lint |
| 10 | nowinandroid | https://github.com/android/nowinandroid | a49ed25 (2026-09-22) | 98 MB, 709 files | Android app (Kotlin, Compose, Hilt, 36 Gradle modules) | AGENTS.md | the mobile pick; screenshot tests, 180 authors |
| 11 | altshuler_trade | (client clone, `/home/user/altshuler_trade`, read-only) | 3a3fcc4, 1 commit ("Replace repository with local version") | 3.0 GB on disk (770 MB .git; 666 MB NuGet `packages/`; 3215 dll/exe/pdb tracked) | Dynamics 365 / Dataverse, legacy .NET Framework 4.6.2/4.7.2, 69 projects, PCF controls | none | the real client; single squashed commit so no history signals |

Clones were `--depth 200 --single-branch`; phpmyadmin was re-cloned with `--filter=blob:none` because its 200-commit pack was 509 MB. gh-cli, phpmyadmin and nowinandroid report more than 200 commits because `--depth 200` counts first-parent depth and their merge history widens it.

## 2. Diagnosis summary (deterministic, `diagnose.py`, no LLM)

One row per repository; the full JSON is in `diagnosis/<repo>.json`. Secrets are counts and paths only (never values).

| repo | languages (files) | files / code lines | build command (inferred) | tests (framework, files) | lint/format | CI | monorepo | generated code (dirs / header-marked files) | secrets (total / outside tests / sensitive files) | external systems | AI config | docs (README KB / docs files / license) | Windows-only | env | history (authors, hottest dir) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cline | TypeScript 3195, Markdown 195, JSON 173 | 4135 / 995537 | `bun run build` | pkg:test, vitest (946) | @biomejs/biome | github-actions (18 wf) | yes (24 pkgs) | 3 / 8 | 301 / 5 / 1 | gRPC/Protobuf, SAP, OpenAI API, OAuth/OIDC/Identity | .agents/, .claude/, AGENTS.md, clinerules, copilot, other (70 files) | 9 / 160 / Apache-2.0 | no | - | 18 authors; sdk/packages (1460x) |
| fastapi-template | TypeScript 109, Python 43, YAML 23 | 252 / 14101 | `none (uv sync + docker compose build)` | pkg:test, pytest (28) | ruff, black, flake8, mypy, isort | github-actions (15 wf) | yes (3 pkgs) | 0 / 20 | 0 / 0 / 2 | SMTP/email, Docker, PostgreSQL, Sentry | .agents/, .claude/ (8 files) | 3 / 0 / MIT | no | Dockerfile, compose | 11 authors; . (253x) |
| gh-cli | Go 997, JSON 84, Markdown 74 | 1475 / 297650 | `go build ./...` | go test (422) | golangci-lint | github-actions (15 wf) | no | 3 / 25 | 23 / 0 / 0 | gRPC/Protobuf, OAuth/OIDC/Identity, GraphQL | AGENTS.md, CLAUDE.md (2 files) | 6 / 70 / MIT | no | devcontainer, Makefile | 173 authors; pkg/cmd (18773x) |
| spring-petclinic | Java 50, HTML 12, YAML 8 | 132 / 4558 | `./mvnw package` | junit (20) | checkstyle, spring-javaformat | github-actions (3 wf) | no | 0 / 2 | 0 / 0 / 0 | MySQL/MariaDB, PostgreSQL, Docker, OAuth/OIDC/Identity | none | 10 / 0 / Apache-2.0 | no | devcontainer, Dockerfile, compose | 66 authors; src/main (330x) |
| eshop | C# 547, Markdown 50, JSON 45 | 1142 / 27530 | `dotnet build eShop.Web.slnf` | @playwright/test, xunit (54) | editorconfig | github-actions (4 wf) | yes (28 pkgs) | 2 / 15 | 0 / 0 / 9 | PostgreSQL, OAuth/OIDC/Identity, gRPC/Protobuf, RabbitMQ/AMQP | none | 6 / 0 / MIT | no | - | 33 authors; src/ClientApp (511x) |
| terraform-aws-eks | HCL/Terraform 90, Markdown 34, YAML 11 | 185 / 16757 | `terraform init && terraform validate` | examples/ as integration checks (6) (20) | pre-commit, terraform_fmt, terraform_val | github-actions (6 wf) | no | 0 / 0 | 0 / 0 / 0 | OAuth/OIDC/Identity, AWS SDK, Kubernetes/Helm | none | 95 / 17 / Apache-2.0 | no | - | 58 authors; . (268x) |
| codex | Rust 4903, TypeScript 758, JSON 367 | 8609 / 2017043 | `cargo build` | cargo test (1955) | prettier, ruff, rustfmt/clippy (toolchai | github-actions (29 wf) | yes (164 pkgs) | 15 / 764 | 84 / 10 / 4 | OpenAI API, OAuth/OIDC/Identity, Sentry, gRPC/Protobuf | AGENTS.md, other (20 files) | 3 / 15 / Apache-2.0 | no | Dockerfile, Makefile | 54 authors; codex-rs/tui (2863x) |
| phpmyadmin | PHP 1235, Twig 274, TypeScript 105 | 3035 / 299543 | `yarn run build` | pkg:test, jest (494) | eslint, phpstan, psalm, psalm.xml, phpcs | github-actions (12 wf) | no | 0 / 9 | 6 / 0 / 0 | MySQL/MariaDB | none | 1 / 43 / GPL | no | - | 296 authors; libraries/classes (12263x) |
| pydatasci-handbook | Jupyter 136, Python 10, HTML 10 | 264 / 121432 | `none inferable` | none (0) | none | none | no | 0 / 0 | 0 / 0 / 0 | none | none | 3 / 0 / none | no | - | 18 authors; notebooks (595x) |
| nowinandroid | Kotlin 350, XML 65, Markdown 44 | 709 / 31017 | `./gradlew build` | junit, roborazzi-screenshot (69) | spotless, ktlint | github-actions (3 wf) | yes (36 pkgs) | 0 / 0 | 0 / 0 / 0 | gRPC/Protobuf, OAuth/OIDC/Identity | AGENTS.md (1 files) | 10 / 9 / Apache-2.0 | no | - | 180 authors; core/designsystem (1488x) |
| altshuler_trade | C# 804, JavaScript 59, JSON 30 | 1333 / 184097 | `msbuild Altshuler.sln /t:Build` | MSTest (6) | none | none | yes (67 pkgs) | 0 / 3 | 2 / 1 / 40 | Dataverse/Dynamics 365, SOAP/WCF web services, Azure SDK, RabbitMQ/AMQP | none | 0 / 0 / none | YES (msbuild, .NET Framework) | - | 1 authors; Shared/Framework (1680x) |

## 3. Decision rules (`rules.json`)

A rule is a boolean condition over the diagnosis JSON, a list of components, and a reason template that is filled from the same JSON, so every recommendation is traceable to a measured fact. Component kinds: **rule** (a line in CLAUDE.md/AGENTS.md), **hook** (Claude Code hook), **permission** (allow/deny), **skill**, **agent** (subagent), **mcp** (MCP server), **scaffold** (a generated file, once), **doc**, **report** (said to the owner, not installed), **runner** (infrastructure the agent needs).

Several rules deliberately recommend *against* a component: R02 says "not a test-writer agent" when there is no test framework; R21 says no formatter hook when there is no formatter config; R15 says merge rather than add a second instruction file; R11 says declare "cannot build here" rather than guess.


| id | signal (condition on the diagnosis) | components (kind: name) | reason template |
|---|---|---|---|
| R01 | generated code present (path markers or 'auto-generated' headers) | **hook**: PreToolUse deny Edit/Write under generated dirs; **rule**: rule line: these paths are generated; change the source and regenerate | generated code in {gen_dirs}; editing it by hand is silently overwritten on the next build |
| R02 | no test framework detected | **scaffold**: first-tests scaffold (one smoke test in the native framework); **hook**: Stop hook: build/compile gate (no test gate yet); **report**: explicitly NOT a test-writer agent: nothing to run it against | no test framework found ({test_files} test-like files) - an agent that 'adds tests' would invent a harness |
| R03 | test framework present with a real corpus | **skill**: run-affected-tests skill ({test_cmd}); **rule**: rule line: test command + where tests live | {test_frameworks} with {test_files} test files - the agent should run the existing suite, not write a new one |
| R04 | CI present | **skill**: verify skill = the CI commands run locally; **rule**: rule line: 'done' means the CI commands pass | CI ({ci_systems}, {ci_n} workflows) already encodes the project's definition of green: {ci_cmds} |
| R05 | no CI | **scaffold**: local verify script (build + tests) as the only gate; **report**: report: no CI - agent output cannot be machine-checked before merge | no CI config found - nothing defines green, so a minimal local gate must be created before agents change code |
| R06 | monorepo / multi-project layout | **scaffold**: per-package CLAUDE.md / AGENTS.md (build+test per package); **skill**: which-package skill (maps a request to the owning package); **rule**: rule line: run commands from the package dir, not the root | {mono_ws} ({mono_n} packages) - one root instruction file cannot state the right build/test command for each |
| R07 | hot-spot directory with many contributors | **doc**: architecture note for {hot_dir}; **agent**: reviewer subagent scoped to {hot_dir} | {hot_dir} changed {hot_changes} times by {hot_authors} authors in the sampled history - highest regression risk, no single owner |
| R08 | repeated change shapes (same >=3 files changed together >=3 times) | **skill**: change-recipe skill for: {shape_example} | {shape_n} recurring file-sets in history - a recipe makes the agent touch all of them, not just the obvious one |
| R09a | secret-looking strings outside test files | **permission**: deny Read on the flagged files until reviewed; **hook**: PreToolUse secret-scan on Write/Edit and on git commit; **report**: report to owner: {sec_outside} hits in {sec_files_outside} | {sec_outside} credential-shaped hits outside tests ({sec_kinds}) - an agent must neither read nor propagate them |
| R09b | secret-looking strings only in tests/fixtures | **rule**: rule line: test fixtures contain fake keys - do not 'fix' or redact them; **hook**: PreToolUse secret-scan on Write/Edit with a test-path allowlist | {sec_total} hits, all in test files - fake keys; without an allowlist a naive scan hook blocks every test edit |
| R10 | sensitive files tracked (.env, .snk, .pfx, .pem, app/web.config, appsettings.Development) | **permission**: deny Read/Edit on {sens_n} sensitive files ({sens_sample}) | {sens_n} sensitive-by-name files - out of the agent's context by default |
| R11 | Windows-only build (.NET Framework / msbuild / .snk) | **rule**: rule line: 'this repository cannot be built here' - no build or test claims; **runner**: Windows build runner (msbuild + VS build tools) reachable by a build-on-runner skill; **skill**: build-on-runner skill (submit, wait, fetch log) | {sln_n} .sln, {tfm} targets, {snk_n} .snk - msbuild on Windows only; an agent on Linux must say so instead of guessing |
| R12 | external system: Dataverse / Dynamics 365 | **mcp**: Dataverse MCP server candidate (official Power Platform MCP, read-only scope first); **rule**: rule line: entity/attribute names come from Dataverse metadata, never guessed; **permission**: deny plugin registration / solution import commands | {dv_n} Dataverse/CRM SDK references - schema lives in the environment, not in the repo |
| R13 | external system: relational database | **rule**: rule line: schema changes go through the migration tool ({db_kinds}); no ad-hoc SQL; **mcp**: read-only DB MCP candidate - only if a local/compose DB exists ({compose}) | {db_kinds} referenced in manifests/compose |
| R14 | cloud SDK / IaC provider present | **permission**: deny mutating cloud CLI (aws/az/gcloud create|delete|deploy); **rule**: rule line: cloud credentials are never in the repo or the agent's env | {cloud} referenced - an agent with a shell must not be able to touch live infrastructure |
| R15 | existing tool-specific AI config (cursor / clinerules / copilot-instructions) | **scaffold**: merge {ai_kinds} into one AGENTS.md; CLAUDE.md = '@AGENTS.md' import; **report**: report: do not duplicate - {ai_n} AI files already exist | {ai_kinds} present ({ai_n} files) - a second, disagreeing instruction file is worse than none |
| R16 | AGENTS.md / CLAUDE.md already present | **doc**: delta only: append diagnosis facts missing from the existing file ({ai_missing}) | instruction file exists ({ai_files}) - generate only what the diagnosis proves and the file lacks |
| R17 | no AI configuration at all | **scaffold**: CLAUDE.md from the diagnosis: build={build_cmd}; test={test_cmd}; lint={lint}; layout | no CLAUDE.md/AGENTS.md/cursor/copilot - the agent starts from zero facts; the diagnosis provides them |
| R18 | Jupyter notebooks | **rule**: rule line: edit cells with NotebookEdit, never the raw .ipynb JSON; keep outputs as committed; **hook**: PostToolUse: nbformat validate on any .ipynb write; **permission**: deny bulk reformatters over notebooks/ | {nb_n} notebooks - a JSON-level edit corrupts them and the diff is unreviewable |
| R19 | Terraform | **hook**: PreToolUse: allow terraform fmt/validate/plan; deny apply/destroy/import/state; **skill**: terraform-docs regen skill (README tables are generated from variables.tf); **rule**: rule line: plan is the deliverable; apply is a human's | {tf_n} .tf files; pre-commit runs {tf_lint} - README/variables co-change {tf_pair} times in history |
| R20 | formatter / linter configured | **hook**: PostToolUse: run {formatter} on the edited file | {lint} configured - style is mechanical; a hook removes it from review |
| R21 | no formatter / linter | **rule**: rule line: match the surrounding style; no reformatting of untouched lines; **report**: report: no lint config - style drift is not machine-checked | no lint/format config - a formatter hook would reformat files nobody formatted before |
| R22a | substantial docs (README >= 8 KB or docs/ folder or architecture doc) | **rule**: rule line: read {doc_pointer} before planning; **skill**: docs-sync skill: a change that alters behaviour updates {doc_pointer} | README {readme_kb} KB, {docs_files} docs files, arch docs: {arch} - the answers exist; the agent must be pointed at them |
| R22b | thin docs (no README or < 2 KB, no docs/) | **scaffold**: onboarding doc from the diagnosis (layout, build, test, external systems) | README {readme_kb} KB and no docs/ - nothing for the agent (or a new hire) to read |
| R23 | devcontainer / Dockerfile / compose | **runner**: run the agent inside {env_kind}; same toolchain as CI | {env_kind} present - the reproducible environment already exists |
| R24 | legacy web stack (PHP + vendored jQuery / Twig) | **agent**: security reviewer subagent (XSS / SQL injection / CSRF) on every PHP or JS change; **rule**: rule line: no framework migrations or jQuery removal; smallest change that fits; **permission**: deny edits under translation dirs ({i18n_dir}) - owned by the translation platform | PHP ({php_files} files) with jQuery; hot dirs include {i18n_dir} ({i18n_changes} changes) which is machine-synced |
| R25 | binaries / package caches / IDE state tracked in git | **permission**: deny Read/Edit under packages/, bin/, obj/, .vs/ ({bin_n} binaries, {pkg_n} package files tracked); **report**: report: repository hygiene - tracked binaries inflate every agent context and clone | {bin_n} dll/exe/pdb, {pkg_n} package-cache files, {ide_n} IDE files in git - the agent would read them as code |
| R26 | Android / mobile app | **skill**: emulator-free verification skill: JVM unit tests + screenshot tests ({screenshot}); **runner**: Android SDK on the runner; full ./gradlew build is minutes, not seconds | mobile toolchain ({mobile}) - instrumented tests need a device; the agent verifies with what runs on JVM |
| R27 | several build systems in one repo | **rule**: rule line: keep {build_systems} in sync ({build_pair_times} co-changes in history) | {build_systems} both present - a dependency added to one and not the other breaks CI on the other |
| R28 | large contributor base | **skill**: contribution-style skill: PR format, commit convention, CONTRIBUTING ({contrib}) | {authors} authors in the sample - output must look like everyone else's PR to be merged |
| R29 | LLM provider SDK in dependencies | **rule**: rule line: tests never call live model APIs; provider keys are not in the agent's env; **permission**: deny reading *_API_KEY env / .env | {llm} referenced - a test run that hits the real API costs money and is non-deterministic |
| R30 | lock file churn / dependency-bump shape | **rule**: rule line: dependency bumps = {dep_files} together; never edit a lock file by hand | {dep_files} co-change {dep_times} times - the most frequent change shape in history is a dependency bump |
| R31 | Aspire / orchestrated multi-service .NET | **rule**: rule line: run through the AppHost project; services are not started individually; **runner**: Docker on the runner (Aspire containers: {containers}) | Aspire AppHost orchestrates {containers}; 'dotnet run' on one service is not the system |
| R32 | PCF control / web resources beside a CRM backend | **rule**: rule line: PCF controls build with `npm run build` in their own folder (pac pcf); CRM plugins do not; **scaffold**: per-area CLAUDE.md: Pcf/ (node) vs CrmEntryPoints/ (msbuild) | two toolchains in one solution - a node build works here, the .NET one does not |

## 4. Per-repository component sets (the core result)

### 4.1 Which rules fired where

| rule | cline | fastapi-template | gh-cli | spring-petclinic | eshop | terraform-aws-eks | codex | phpmyadmin | pydatasci-handbook | nowinandroid | altshuler_trade |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R01 generated code present (path markers o | x | x | x |  | x |  | x | x |  |  | x |
| R02 no test framework detected |  |  |  |  |  |  |  |  | x |  |  |
| R03 test framework present with a real cor | x | x | x | x | x | x | x | x |  | x |  |
| R04 CI present | x | x | x | x | x | x | x | x |  | x |  |
| R05 no CI |  |  |  |  |  |  |  |  | x |  | x |
| R06 monorepo / multi-project layout | x | x |  |  | x |  | x |  |  | x | x |
| R07 hot-spot directory with many contribut | x |  | x | x | x |  | x | x | x | x |  |
| R08 repeated change shapes (same >=3 files | x | x | x |  | x | x |  | x |  | x |  |
| R09a secret-looking strings outside test fi | x |  |  |  |  |  | x |  |  |  | x |
| R09b secret-looking strings only in tests/f |  |  | x |  |  |  |  | x |  |  |  |
| R10 sensitive files tracked (.env, .snk, . | x | x |  |  | x |  | x |  |  |  | x |
| R11 Windows-only build (.NET Framework / m |  |  |  |  |  |  |  |  |  |  | x |
| R12 external system: Dataverse / Dynamics  |  |  |  |  |  |  |  |  |  |  | x |
| R13 external system: relational database |  | x |  | x | x |  |  | x |  |  |  |
| R14 cloud SDK / IaC provider present | x |  |  |  |  | x |  |  |  |  | x |
| R15 existing tool-specific AI config (curs | x |  |  |  |  |  |  |  |  |  |  |
| R16 AGENTS.md / CLAUDE.md already present | x |  | x |  |  |  | x |  |  | x |  |
| R17 no AI configuration at all |  |  |  | x | x | x |  | x | x |  | x |
| R18 Jupyter notebooks |  |  |  |  |  |  |  |  | x |  |  |
| R19 Terraform |  |  |  |  |  | x |  |  |  |  |  |
| R20 formatter / linter configured | x | x | x | x | x | x | x | x |  | x |  |
| R21 no formatter / linter |  |  |  |  |  |  |  |  | x |  | x |
| R22a substantial docs (README >= 8 KB or do | x |  | x | x |  | x | x | x |  | x |  |
| R22b thin docs (no README or < 2 KB, no doc |  |  |  |  |  |  |  |  |  |  | x |
| R23 devcontainer / Dockerfile / compose |  | x | x | x |  |  | x |  |  |  |  |
| R24 legacy web stack (PHP + vendored jQuer |  |  |  |  |  |  |  | x |  |  |  |
| R25 binaries / package caches / IDE state  |  |  |  |  |  |  |  |  |  |  | x |
| R26 Android / mobile app |  |  |  |  |  |  |  |  |  | x |  |
| R27 several build systems in one repo |  |  |  | x |  |  |  |  |  |  |  |
| R28 large contributor base |  |  | x | x |  | x | x | x |  | x |  |
| R29 LLM provider SDK in dependencies | x |  |  |  | x |  | x |  |  |  |  |
| R30 lock file churn / dependency-bump shap |  | x | x |  | x |  |  | x |  | x |  |
| R31 Aspire / orchestrated multi-service .N |  |  |  |  | x |  |  |  |  |  |  |
| R32 PCF control / web resources beside a C |  |  |  |  |  |  |  |  |  |  | x |

**Distinct rule sets: 11 of 11 repositories.** No two repositories got the same set.

Most similar pairs (Jaccard over rules fired): cline ~ codex = 0.69; gh-cli ~ phpmyadmin = 0.67; gh-cli ~ nowinandroid = 0.64; fastapi-template ~ eshop = 0.64. Least similar: nowinandroid ~ altshuler_trade = 0.04; gh-cli ~ altshuler_trade = 0.04; fastapi-template ~ pydatasci-handbook = 0.00.

| repo | components | by kind | rules |
|---|---|---|---|
| cline | 26 | agent 1, doc 2, hook 3, permission 4, report 2, rule 7, scaffold 2, skill 5 | R01, R03, R04, R06, R07, R08, R09a, R10, R14, R15, R16, R20, R22a, R29 |
| fastapi-template | 16 | hook 2, mcp 1, permission 1, rule 6, runner 1, scaffold 1, skill 4 | R01, R03, R04, R06, R08, R10, R13, R20, R23, R30 |
| gh-cli | 18 | agent 1, doc 2, hook 3, rule 6, runner 1, skill 5 | R01, R03, R04, R07, R08, R09b, R16, R20, R22a, R23, R28, R30 |
| spring-petclinic | 15 | agent 1, doc 1, hook 1, mcp 1, rule 5, runner 1, scaffold 1, skill 4 | R03, R04, R07, R13, R17, R20, R22a, R23, R27, R28 |
| eshop | 22 | agent 1, doc 1, hook 2, mcp 1, permission 2, rule 8, runner 1, scaffold 2, skill 4 | R01, R03, R04, R06, R07, R08, R10, R13, R17, R20, R29, R30, R31 |
| terraform-aws-eks | 15 | hook 2, permission 1, rule 5, scaffold 1, skill 6 | R03, R04, R08, R14, R17, R19, R20, R22a, R28 |
| codex | 23 | agent 1, doc 2, hook 3, permission 3, report 1, rule 6, runner 1, scaffold 1, skill 5 | R01, R03, R04, R06, R07, R09a, R10, R16, R20, R22a, R23, R28, R29 |
| phpmyadmin | 22 | agent 2, doc 1, hook 3, mcp 1, permission 1, rule 8, scaffold 1, skill 5 | R01, R03, R04, R07, R08, R09b, R13, R17, R20, R22a, R24, R28, R30 |
| pydatasci-handbook | 13 | agent 1, doc 1, hook 2, permission 1, report 3, rule 2, scaffold 3 | R02, R05, R07, R17, R18, R21 |
| nowinandroid | 18 | agent 1, doc 2, hook 1, rule 5, runner 1, scaffold 1, skill 7 | R03, R04, R06, R07, R08, R16, R20, R22a, R26, R28, R30 |
| altshuler_trade | 27 | hook 2, mcp 1, permission 5, report 4, rule 7, runner 1, scaffold 5, skill 2 | R01, R05, R06, R09a, R10, R11, R12, R14, R17, R21, R22b, R25, R32 |

### 4.2 The eleven sets, side by side

Each line: rule - component kind - component - _why (filled from this repository's diagnosis)_. Kinds: rule = line in CLAUDE.md/AGENTS.md; hook = Claude Code hook; permission = allow/deny; skill; agent = subagent; mcp = MCP server; scaffold = one-time generated file; doc; report = told to the owner, not installed; runner = infrastructure requirement.

#### cline

- **R01** `hook` PreToolUse deny Edit/Write under generated dirs - _generated code in apps/vscode/src/types, sdk/packages/llms/src/catalog, sdk/packages/llms/src/providers; editing it by hand is silently overwritten on the next build_
- **R01** `rule` rule line: these paths are generated; change the source and regenerate
- **R03** `skill` run-affected-tests skill (bun run test) - _package.json:test -> bun --parallel -F './sdk/packages/**' -F @cline/cli -F @cline/cline-hub -F @clin, vitest with 946 test files - the agent should run the existing suite, not write a new one_
- **R03** `rule` rule line: test command + where tests live
- **R04** `skill` verify skill = the CI commands run locally - _CI (github-actions, 18 workflows) already encodes the project's definition of green: bun run build:sdk; NODE_FILE="node_modules/better-sqlite3/build/Release/better_sqlite3.node"; npm install -g @vscode/vsce ovsx_
- **R04** `rule` rule line: 'done' means the CI commands pass
- **R06** `scaffold` per-package CLAUDE.md / AGENTS.md (build+test per package) - _sdk/packages/*; apps/* (24 packages) - one root instruction file cannot state the right build/test command for each_
- **R06** `skill` which-package skill (maps a request to the owning package)
- **R06** `rule` rule line: run commands from the package dir, not the root
- **R07** `doc` architecture note for sdk/packages - _sdk/packages changed 1460 times by 14 authors in the sampled history - highest regression risk, no single owner_
- **R07** `agent` reviewer subagent scoped to sdk/packages
- **R08** `skill` change-recipe skill for: CHANGELOG.md + package.json + tauri.conf.json (12x) - _1 recurring file-sets in history - a recipe makes the agent touch all of them, not just the obvious one_
- **R09a** `permission` deny Read on the flagged files until reviewed - _5 credential-shaped hits outside tests (password_assignment, slack_token, aws_access_key) - an agent must neither read nor propagate them_
- **R09a** `hook` PreToolUse secret-scan on Write/Edit and on git commit
- **R09a** `report` report to owner: 5 hits in 
- **R10** `permission` deny Read/Edit on 1 sensitive files (.env.example) - _1 sensitive-by-name files - out of the agent's context by default_
- **R14** `permission` deny mutating cloud CLI (aws/az/gcloud create|delete|deploy) - _AWS SDK referenced - an agent with a shell must not be able to touch live infrastructure_
- **R14** `rule` rule line: cloud credentials are never in the repo or the agent's env
- **R15** `scaffold` merge clinerules, copilot into one AGENTS.md; CLAUDE.md = '@AGENTS.md' import - _clinerules, copilot present (70 files) - a second, disagreeing instruction file is worse than none_
- **R15** `report` report: do not duplicate - 70 AI files already exist
- **R16** `doc` delta only: append diagnosis facts missing from the existing file (build/test commands, generated paths, external systems - whichever the file lacks) - _instruction file exists (.agents/skills/cline-sdk/SKILL.md, .agents/skills/cline-sdk/references/agent/REFERENCE.md) - generate only what the diagnosis proves and the file lacks_
- **R20** `hook` PostToolUse: run @biomejs/biome on the edited file - _@biomejs/biome, biome.json configured - style is mechanical; a hook removes it from review_
- **R22a** `rule` rule line: read apps/examples/desktop-app/sidecar/ARCHITECTURE.md before planning - _README 9.0 KB, 160 docs files, arch docs: apps/examples/desktop-app/sidecar/ARCHITECTURE.md, evals/ARCHITECTURE.md - the answers exist; the agent must be pointed at them_
- **R22a** `skill` docs-sync skill: a change that alters behaviour updates apps/examples/desktop-app/sidecar/ARCHITECTURE.md
- **R29** `rule` rule line: tests never call live model APIs; provider keys are not in the agent's env - _OpenAI API, Anthropic API referenced - a test run that hits the real API costs money and is non-deterministic_
- **R29** `permission` deny reading *_API_KEY env / .env

#### fastapi-template

- **R01** `hook` PreToolUse deny Edit/Write under generated dirs - _generated code in frontend/src/client/core, frontend/src/client, frontend/src/client/client, backend/app/alembic/versions; editing it by hand is silently overwritten on the next build_
- **R01** `rule` rule line: these paths are generated; change the source and regenerate
- **R03** `skill` run-affected-tests skill (docker compose run --rm playwright bunx playwright test --fail-on-flaky-tests --trace=retain-on-fail) - _package.json:test -> bun run --filter frontend test, pytest with 28 test files - the agent should run the existing suite, not write a new one_
- **R03** `rule` rule line: test command + where tests live
- **R04** `skill` verify skill = the CI commands run locally - _CI (github-actions, 15 workflows) already encodes the project's definition of green: docker compose build; docker compose -f compose.yml -f compose.deploy.yml build; bun run --filter frontend build_
- **R04** `rule` rule line: 'done' means the CI commands pass
- **R06** `scaffold` per-package CLAUDE.md / AGENTS.md (build+test per package) - _frontend; packages/* (3 packages) - one root instruction file cannot state the right build/test command for each_
- **R06** `skill` which-package skill (maps a request to the owning package)
- **R06** `rule` rule line: run commands from the package dir, not the root
- **R08** `skill` change-recipe skill for: pyproject.toml + pyproject.toml + uv.lock (4x) - _1 recurring file-sets in history - a recipe makes the agent touch all of them, not just the obvious one_
- **R10** `permission` deny Read/Edit on 2 sensitive files (.env, .env) - _2 sensitive-by-name files - out of the agent's context by default_
- **R13** `rule` rule line: schema changes go through the migration tool (PostgreSQL); no ad-hoc SQL - _PostgreSQL referenced in manifests/compose_
- **R13** `mcp` read-only DB MCP candidate - only if a local/compose DB exists (compose present)
- **R20** `hook` PostToolUse: run ruff on the edited file - _ruff, black, flake8, mypy configured - style is mechanical; a hook removes it from review_
- **R23** `runner` run the agent inside Dockerfile, compose; same toolchain as CI - _Dockerfile, compose present - the reproducible environment already exists_
- **R30** `rule` rule line: dependency bumps = pyproject.toml + uv.lock together; never edit a lock file by hand - _pyproject.toml + uv.lock co-change 16 times - the most frequent change shape in history is a dependency bump_

#### gh-cli

- **R01** `hook` PreToolUse deny Edit/Write under generated dirs - _generated code in internal/codespaces/rpc/codespace, internal/codespaces/rpc/jupyter, internal/codespaces/rpc/ssh, internal/barista/observability, internal/gh/mock, pkg/cmd/codespace; editing it by hand is silently overwritten on the next build_
- **R01** `rule` rule line: these paths are generated; change the source and regenerate
- **R03** `skill` run-affected-tests skill (go test -tags=acceptance ./acceptance) - _go test with 422 test files - the agent should run the existing suite, not write a new one_
- **R03** `rule` rule line: test command + where tests live
- **R04** `skill` verify skill = the CI commands run locally - _CI (github-actions, 15 workflows) already encodes the project's definition of green: make; go test -tags=acceptance ./acceptance; echo "GOROOT=$(go env GOROOT)" >> "$GITHUB_ENV"_
- **R04** `rule` rule line: 'done' means the CI commands pass
- **R07** `doc` architecture note for pkg/cmd - _pkg/cmd changed 18773 times by 121 authors in the sampled history - highest regression risk, no single owner_
- **R07** `agent` reviewer subagent scoped to pkg/cmd
- **R08** `skill` change-recipe skill for: third-party-licenses.darwin.md + third-party-licenses.linux.md + third-party-licenses.windows.md (32x) - _8 recurring file-sets in history - a recipe makes the agent touch all of them, not just the obvious one_
- **R09b** `rule` rule line: test fixtures contain fake keys - do not 'fix' or redact them - _23 hits, all in test files - fake keys; without an allowlist a naive scan hook blocks every test edit_
- **R09b** `hook` PreToolUse secret-scan on Write/Edit with a test-path allowlist
- **R16** `doc` delta only: append diagnosis facts missing from the existing file (build/test commands, generated paths, external systems - whichever the file lacks) - _instruction file exists (AGENTS.md, CLAUDE.md) - generate only what the diagnosis proves and the file lacks_
- **R20** `hook` PostToolUse: run golangci-lint on the edited file - _golangci-lint, .golangci.yml configured - style is mechanical; a hook removes it from review_
- **R22a** `rule` rule line: read docs/ before planning - _README 6.1 KB, 70 docs files, arch docs: none - the answers exist; the agent must be pointed at them_
- **R22a** `skill` docs-sync skill: a change that alters behaviour updates docs/
- **R23** `runner` run the agent inside devcontainer; same toolchain as CI - _devcontainer present - the reproducible environment already exists_
- **R28** `skill` contribution-style skill: PR format, commit convention, CONTRIBUTING (.github/CONTRIBUTING.md) - _173 authors in the sample - output must look like everyone else's PR to be merged_
- **R30** `rule` rule line: dependency bumps = go.mod + go.sum together; never edit a lock file by hand - _go.mod + go.sum co-change 211 times - the most frequent change shape in history is a dependency bump_

#### spring-petclinic

- **R03** `skill` run-affected-tests skill (./mvnw -B verify) - _junit with 20 test files - the agent should run the existing suite, not write a new one_
- **R03** `rule` rule line: test command + where tests live
- **R04** `skill` verify skill = the CI commands run locally - _CI (github-actions, 3 workflows) already encodes the project's definition of green: ./gradlew build; ./mvnw -B verify_
- **R04** `rule` rule line: 'done' means the CI commands pass
- **R07** `doc` architecture note for src/main - _src/main changed 330 times by 40 authors in the sampled history - highest regression risk, no single owner_
- **R07** `agent` reviewer subagent scoped to src/main
- **R13** `rule` rule line: schema changes go through the migration tool (PostgreSQL, MySQL/MariaDB); no ad-hoc SQL - _PostgreSQL, MySQL/MariaDB referenced in manifests/compose_
- **R13** `mcp` read-only DB MCP candidate - only if a local/compose DB exists (compose present)
- **R17** `scaffold` CLAUDE.md from the diagnosis: build=./mvnw package; ./gradlew build; test=./mvnw -B verify; lint=checkstyle, spring-javaformat, .editorconfig; layout - _no CLAUDE.md/AGENTS.md/cursor/copilot - the agent starts from zero facts; the diagnosis provides them_
- **R20** `hook` PostToolUse: run spring-javaformat on the edited file - _checkstyle, spring-javaformat, .editorconfig configured - style is mechanical; a hook removes it from review_
- **R22a** `rule` rule line: read README.md before planning - _README 10.3 KB, 0 docs files, arch docs: none - the answers exist; the agent must be pointed at them_
- **R22a** `skill` docs-sync skill: a change that alters behaviour updates README.md
- **R23** `runner` run the agent inside devcontainer, Dockerfile, compose; same toolchain as CI - _devcontainer, Dockerfile, compose present - the reproducible environment already exists_
- **R27** `rule` rule line: keep maven + gradle in sync (23 co-changes in history) - _maven + gradle both present - a dependency added to one and not the other breaks CI on the other_
- **R28** `skill` contribution-style skill: PR format, commit convention, CONTRIBUTING (no CONTRIBUTING) - _66 authors in the sample - output must look like everyone else's PR to be merged_

#### eshop

- **R01** `hook` PreToolUse deny Edit/Write under generated dirs - _generated code in src/Ordering.Infrastructure/Migrations, src/Catalog.API/Infrastructure/Migrations, src/ClientApp/Services/Basket/Protos, src/Identity.API/Data/Migrations, src/Webhooks.API/Migrations; editing it by hand is silently overwritten on the next build_
- **R01** `rule` rule line: these paths are generated; change the source and regenerate
- **R03** `skill` run-affected-tests skill (npm run test:e2e) - _@playwright/test, xunit with 54 test files - the agent should run the existing suite, not write a new one_
- **R03** `rule` rule line: test command + where tests live
- **R04** `skill` verify skill = the CI commands run locally - _CI (github-actions, 4 workflows) already encodes the project's definition of green: npm ci; npx playwright install --with-deps chromium; npm run test:e2e_
- **R04** `rule` rule line: 'done' means the CI commands pass
- **R06** `scaffold` per-package CLAUDE.md / AGENTS.md (build+test per package) - _28 .NET projects in 4 solution(s) (28 packages) - one root instruction file cannot state the right build/test command for each_
- **R06** `skill` which-package skill (maps a request to the owning package)
- **R06** `rule` rule line: run commands from the package dir, not the root
- **R07** `doc` architecture note for src/ClientApp - _src/ClientApp changed 511 times by 10 authors in the sampled history - highest regression risk, no single owner_
- **R07** `agent` reviewer subagent scoped to src/ClientApp
- **R08** `skill` change-recipe skill for: ClientApp.csproj + HybridApp.csproj + ClientApp.UnitTests.csproj (5x) - _1 recurring file-sets in history - a recipe makes the agent touch all of them, not just the obvious one_
- **R10** `permission` deny Read/Edit on 9 sensitive files (appsettings.Development.json, appsettings.Development.json, appsettings.Development.json) - _9 sensitive-by-name files - out of the agent's context by default_
- **R13** `rule` rule line: schema changes go through the migration tool (PostgreSQL); no ad-hoc SQL - _PostgreSQL referenced in manifests/compose_
- **R13** `mcp` read-only DB MCP candidate - only if a local/compose DB exists (no compose - skip the MCP)
- **R17** `scaffold` CLAUDE.md from the diagnosis: build=dotnet build eShop.Web.slnf; test=npm run test:e2e; lint=editorconfig, .editorconfig; layout - _no CLAUDE.md/AGENTS.md/cursor/copilot - the agent starts from zero facts; the diagnosis provides them_
- **R20** `hook` PostToolUse: run editorconfig on the edited file - _editorconfig, .editorconfig configured - style is mechanical; a hook removes it from review_
- **R29** `rule` rule line: tests never call live model APIs; provider keys are not in the agent's env - _OpenAI API referenced - a test run that hits the real API costs money and is non-deterministic_
- **R29** `permission` deny reading *_API_KEY env / .env
- **R30** `rule` rule line: dependency bumps = Directory.Packages.props + ClientApp.UnitTests.csproj together; never edit a lock file by hand - _Directory.Packages.props + ClientApp.UnitTests.csproj co-change 14 times - the most frequent change shape in history is a dependency bump_
- **R31** `rule` rule line: run through the AppHost project; services are not started individually - _Aspire AppHost orchestrates PostgreSQL, Redis, RabbitMQ/AMQP; 'dotnet run' on one service is not the system_
- **R31** `runner` Docker on the runner (Aspire containers: PostgreSQL, Redis, RabbitMQ/AMQP)

#### terraform-aws-eks

- **R03** `skill` run-affected-tests skill (examples/ as integration checks (6)) - _examples/ as integration checks (6) with 20 test files - the agent should run the existing suite, not write a new one_
- **R03** `rule` rule line: test command + where tests live
- **R04** `skill` verify skill = the CI commands run locally - _CI (github-actions, 6 workflows) already encodes the project's definition of green: npm install \_
- **R04** `rule` rule line: 'done' means the CI commands pass
- **R08** `skill` change-recipe skill for: README.md + main.tf + variables.tf (5x) - _2 recurring file-sets in history - a recipe makes the agent touch all of them, not just the obvious one_
- **R14** `permission` deny mutating cloud CLI (aws/az/gcloud create|delete|deploy) - _AWS SDK referenced - an agent with a shell must not be able to touch live infrastructure_
- **R14** `rule` rule line: cloud credentials are never in the repo or the agent's env
- **R17** `scaffold` CLAUDE.md from the diagnosis: build=terraform init && terraform validate   # no compile; plan needs cloud creds; test=examples/ as integration checks (6); lint=pre-commit, terraform_fmt, terraform_validate, terraform_docs; layout - _no CLAUDE.md/AGENTS.md/cursor/copilot - the agent starts from zero facts; the diagnosis provides them_
- **R19** `hook` PreToolUse: allow terraform fmt/validate/plan; deny apply/destroy/import/state - _90 .tf files; pre-commit runs terraform_fmt, terraform_validate, terraform_docs, tflint - README/variables co-change 15 times in history_
- **R19** `skill` terraform-docs regen skill (README tables are generated from variables.tf)
- **R19** `rule` rule line: plan is the deliverable; apply is a human's
- **R20** `hook` PostToolUse: run terraform_fmt on the edited file - _pre-commit, terraform_fmt, terraform_validate, terraform_docs configured - style is mechanical; a hook removes it from review_
- **R22a** `rule` rule line: read docs/ before planning - _README 95.6 KB, 17 docs files, arch docs: none - the answers exist; the agent must be pointed at them_
- **R22a** `skill` docs-sync skill: a change that alters behaviour updates docs/
- **R28** `skill` contribution-style skill: PR format, commit convention, CONTRIBUTING (no CONTRIBUTING) - _58 authors in the sample - output must look like everyone else's PR to be merged_

#### codex

- **R01** `hook` PreToolUse deny Edit/Write under generated dirs - _generated code in codex-rs/tui/src/chatwidget/snapshots, codex-rs/tui/src/bottom_pane/snapshots, codex-rs/tui/src/snapshots, codex-rs/tui/src/history_cell/snapshots, codex-rs/tui/src/app/snapshots, codex-rs/tui/src/chatwidget/tests/snapshots; editing it by hand is silently overwritten on the next build_
- **R01** `rule` rule line: these paths are generated; change the source and regenerate
- **R03** `skill` run-affected-tests skill (cargo test) - _cargo test with 1955 test files - the agent should run the existing suite, not write a new one_
- **R03** `rule` rule line: test command + where tests live
- **R04** `skill` verify skill = the CI commands run locally - _CI (github-actions, 29 workflows) already encodes the project's definition of green: pnpm install --frozen-lockfile; cargo fmt -- --config imports_granularity=Item --check; cargo shear --deny-warnings_
- **R04** `rule` rule line: 'done' means the CI commands pass
- **R06** `scaffold` per-package CLAUDE.md / AGENTS.md (build+test per package) - _pnpm-workspace.yaml; cargo workspace: codex-rs/Cargo.toml (164 packages) - one root instruction file cannot state the right build/test command for each_
- **R06** `skill` which-package skill (maps a request to the owning package)
- **R06** `rule` rule line: run commands from the package dir, not the root
- **R07** `doc` architecture note for codex-rs/tui - _codex-rs/tui changed 2863 times by 14 authors in the sampled history - highest regression risk, no single owner_
- **R07** `agent` reviewer subagent scoped to codex-rs/tui
- **R09a** `permission` deny Read on the flagged files until reviewed - _10 credential-shaped hits outside tests (private_key_block, password_assignment, openai_key, aws_access_key, github_token) - an agent must neither read nor propagate them_
- **R09a** `hook` PreToolUse secret-scan on Write/Edit and on git commit
- **R09a** `report` report to owner: 10 hits in codex-rs/memories/write/src/phase1.rs, codex-rs/model-provider/src/amazon_bedrock/mod.rs, codex-rs/agent-identity/src/lib.rs
- **R10** `permission` deny Read/Edit on 4 sensitive files (.npmrc, test-ca-trusted.pem, test-ca.pem) - _4 sensitive-by-name files - out of the agent's context by default_
- **R16** `doc` delta only: append diagnosis facts missing from the existing file (build/test commands, generated paths, external systems - whichever the file lacks) - _instruction file exists (AGENTS.md) - generate only what the diagnosis proves and the file lacks_
- **R20** `hook` PostToolUse: run prettier on the edited file - _prettier, ruff, rustfmt/clippy (toolchain pinned), ruff.toml configured - style is mechanical; a hook removes it from review_
- **R22a** `rule` rule line: read docs/ before planning - _README 3.3 KB, 15 docs files, arch docs: none - the answers exist; the agent must be pointed at them_
- **R22a** `skill` docs-sync skill: a change that alters behaviour updates docs/
- **R23** `runner` run the agent inside Dockerfile; same toolchain as CI - _Dockerfile present - the reproducible environment already exists_
- **R28** `skill` contribution-style skill: PR format, commit convention, CONTRIBUTING (no CONTRIBUTING) - _54 authors in the sample - output must look like everyone else's PR to be merged_
- **R29** `rule` rule line: tests never call live model APIs; provider keys are not in the agent's env - _OpenAI API referenced - a test run that hits the real API costs money and is non-deterministic_
- **R29** `permission` deny reading *_API_KEY env / .env

#### phpmyadmin

- **R01** `hook` PreToolUse deny Edit/Write under generated dirs - _generated code in src/Command; editing it by hand is silently overwritten on the next build_
- **R01** `rule` rule line: these paths are generated; change the source and regenerate
- **R03** `skill` run-affected-tests skill (composer run phpunit -- --testsuite unit --display-all-issues) - _package.json:test -> yarn node --experimental-vm-modules $(yarn bin jest), jest, phpunit with 494 test files - the agent should run the existing suite, not write a new one_
- **R03** `rule` rule line: test command + where tests live
- **R04** `skill` verify skill = the CI commands run locally - _CI (github-actions, 12 workflows) already encodes the project's definition of green: yarn install --non-interactive; composer run phpunit -- --testsuite unit --display-all-issues; ./bin/internal/check-release-excludes.sh release/phpMyAdmin-${{ matrix.version }}+snapshot-all-langu_
- **R04** `rule` rule line: 'done' means the CI commands pass
- **R07** `doc` architecture note for libraries/classes - _libraries/classes changed 12263 times by 53 authors in the sampled history - highest regression risk, no single owner_
- **R07** `agent` reviewer subagent scoped to libraries/classes
- **R08** `skill` change-recipe skill for: composer.lock + phpstan-baseline.neon + psalm-baseline.xml (9x) - _8 recurring file-sets in history - a recipe makes the agent touch all of them, not just the obvious one_
- **R09b** `rule` rule line: test fixtures contain fake keys - do not 'fix' or redact them - _6 hits, all in test files - fake keys; without an allowlist a naive scan hook blocks every test edit_
- **R09b** `hook` PreToolUse secret-scan on Write/Edit with a test-path allowlist
- **R13** `rule` rule line: schema changes go through the migration tool (MySQL/MariaDB); no ad-hoc SQL - _MySQL/MariaDB referenced in manifests/compose_
- **R13** `mcp` read-only DB MCP candidate - only if a local/compose DB exists (no compose - skip the MCP)
- **R17** `scaffold` CLAUDE.md from the diagnosis: build=yarn run build   # -> webpack; composer install; test=composer run phpunit -- --testsuite unit --display-all-issues; lint=eslint, phpstan, psalm, .eslintrc.json; layout - _no CLAUDE.md/AGENTS.md/cursor/copilot - the agent starts from zero facts; the diagnosis provides them_
- **R20** `hook` PostToolUse: run eslint on the edited file - _eslint, phpstan, psalm, .eslintrc.json configured - style is mechanical; a hook removes it from review_
- **R22a** `rule` rule line: read docs/ before planning - _README 1.5 KB, 43 docs files, arch docs: none - the answers exist; the agent must be pointed at them_
- **R22a** `skill` docs-sync skill: a change that alters behaviour updates docs/
- **R24** `agent` security reviewer subagent (XSS / SQL injection / CSRF) on every PHP or JS change - _PHP (1235 files) with jQuery; hot dirs include resources/po (10834 changes) which is machine-synced_
- **R24** `rule` rule line: no framework migrations or jQuery removal; smallest change that fits
- **R24** `permission` deny edits under translation dirs (resources/po) - owned by the translation platform
- **R28** `skill` contribution-style skill: PR format, commit convention, CONTRIBUTING (CONTRIBUTING.md) - _296 authors in the sample - output must look like everyone else's PR to be merged_
- **R30** `rule` rule line: dependency bumps = package.json + yarn.lock together; never edit a lock file by hand - _package.json + yarn.lock co-change 23 times - the most frequent change shape in history is a dependency bump_

#### pydatasci-handbook

- **R02** `scaffold` first-tests scaffold (one smoke test in the native framework) - _no test framework found (0 test-like files) - an agent that 'adds tests' would invent a harness_
- **R02** `hook` Stop hook: build/compile gate (no test gate yet)
- **R02** `report` explicitly NOT a test-writer agent: nothing to run it against
- **R05** `scaffold` local verify script (build + tests) as the only gate - _no CI config found - nothing defines green, so a minimal local gate must be created before agents change code_
- **R05** `report` report: no CI - agent output cannot be machine-checked before merge
- **R07** `doc` architecture note for notebooks - _notebooks changed 595 times by 13 authors in the sampled history - highest regression risk, no single owner_
- **R07** `agent` reviewer subagent scoped to notebooks
- **R17** `scaffold` CLAUDE.md from the diagnosis: build=(none inferable); test=-; lint=-; layout - _no CLAUDE.md/AGENTS.md/cursor/copilot - the agent starts from zero facts; the diagnosis provides them_
- **R18** `rule` rule line: edit cells with NotebookEdit, never the raw .ipynb JSON; keep outputs as committed - _136 notebooks - a JSON-level edit corrupts them and the diff is unreviewable_
- **R18** `hook` PostToolUse: nbformat validate on any .ipynb write
- **R18** `permission` deny bulk reformatters over notebooks/
- **R21** `rule` rule line: match the surrounding style; no reformatting of untouched lines - _no lint/format config - a formatter hook would reformat files nobody formatted before_
- **R21** `report` report: no lint config - style drift is not machine-checked

#### nowinandroid

- **R03** `skill` run-affected-tests skill (./gradlew testDemoDebug :lint:test) - _junit, roborazzi-screenshot with 69 test files - the agent should run the existing suite, not write a new one_
- **R03** `rule` rule line: test command + where tests live
- **R04** `skill` verify skill = the CI commands run locally - _CI (github-actions, 3 workflows) already encodes the project's definition of green: ./gradlew :build-logic:convention:check; ./gradlew :benchmarks:pixel6Api33Setup; ./gradlew spotlessCheck_
- **R04** `rule` rule line: 'done' means the CI commands pass
- **R06** `scaffold` per-package CLAUDE.md / AGENTS.md (build+test per package) - _36 gradle modules (36 packages) - one root instruction file cannot state the right build/test command for each_
- **R06** `skill` which-package skill (maps a request to the owning package)
- **R06** `rule` rule line: run commands from the package dir, not the root
- **R07** `doc` architecture note for core/designsystem - _core/designsystem changed 1488 times by 44 authors in the sampled history - highest regression risk, no single owner_
- **R07** `agent` reviewer subagent scoped to core/designsystem
- **R08** `skill` change-recipe skill for: releaseRuntimeClasspath.txt + prodReleaseRuntimeClasspath.txt + libs.versions.toml (5x) - _6 recurring file-sets in history - a recipe makes the agent touch all of them, not just the obvious one_
- **R16** `doc` delta only: append diagnosis facts missing from the existing file (build/test commands, generated paths, external systems - whichever the file lacks) - _instruction file exists (AGENTS.md) - generate only what the diagnosis proves and the file lacks_
- **R20** `hook` PostToolUse: run spotless on the edited file - _spotless, ktlint, .editorconfig configured - style is mechanical; a hook removes it from review_
- **R22a** `rule` rule line: read docs/ArchitectureLearningJourney.md before planning - _README 10.7 KB, 9 docs files, arch docs: docs/ArchitectureLearningJourney.md - the answers exist; the agent must be pointed at them_
- **R22a** `skill` docs-sync skill: a change that alters behaviour updates docs/ArchitectureLearningJourney.md
- **R26** `skill` emulator-free verification skill: JVM unit tests + screenshot tests (roborazzi-screenshot) - _mobile toolchain (android, jetpack-compose) - instrumented tests need a device; the agent verifies with what runs on JVM_
- **R26** `runner` Android SDK on the runner; full ./gradlew build is minutes, not seconds
- **R28** `skill` contribution-style skill: PR format, commit convention, CONTRIBUTING (CONTRIBUTING.md) - _180 authors in the sample - output must look like everyone else's PR to be merged_
- **R30** `rule` rule line: dependency bumps = build.gradle.kts + libs.versions.toml together; never edit a lock file by hand - _build.gradle.kts + libs.versions.toml co-change 28 times - the most frequent change shape in history is a dependency bump_

#### altshuler_trade

- **R01** `hook` PreToolUse deny Edit/Write under generated dirs - _generated code in Shared/DataModel/Crm/Alt.DataModel.Crm/EBG; editing it by hand is silently overwritten on the next build_
- **R01** `rule` rule line: these paths are generated; change the source and regenerate
- **R05** `scaffold` local verify script (build + tests) as the only gate - _no CI config found - nothing defines green, so a minimal local gate must be created before agents change code_
- **R05** `report` report: no CI - agent output cannot be machine-checked before merge
- **R06** `scaffold` per-package CLAUDE.md / AGENTS.md (build+test per package) - _69 .NET projects in 1 solution(s) (67 packages) - one root instruction file cannot state the right build/test command for each_
- **R06** `skill` which-package skill (maps a request to the owning package)
- **R06** `rule` rule line: run commands from the package dir, not the root
- **R09a** `permission` deny Read on the flagged files until reviewed - _1 credential-shaped hits outside tests (connection_string_with_password) - an agent must neither read nor propagate them_
- **R09a** `hook` PreToolUse secret-scan on Write/Edit and on git commit
- **R09a** `report` report to owner: 1 hits in Stuff/OneTimeConsole/Program.cs
- **R10** `permission` deny Read/Edit on 40 sensitive files (Alt.BusinessLogicLayer.Crm.External.snk, app.config, Alt.BusinessLogicLayer.Crm.snk) - _40 sensitive-by-name files - out of the agent's context by default_
- **R11** `rule` rule line: 'this repository cannot be built here' - no build or test claims - _1 .sln, netframework v4.6.2, netframework v4.7.2 targets, 58 .snk - msbuild on Windows only; an agent on Linux must say so instead of guessing_
- **R11** `runner` Windows build runner (msbuild + VS build tools) reachable by a build-on-runner skill
- **R11** `skill` build-on-runner skill (submit, wait, fetch log)
- **R12** `mcp` Dataverse MCP server candidate (official Power Platform MCP, read-only scope first) - _251 Dataverse/CRM SDK references - schema lives in the environment, not in the repo_
- **R12** `rule` rule line: entity/attribute names come from Dataverse metadata, never guessed
- **R12** `permission` deny plugin registration / solution import commands
- **R14** `permission` deny mutating cloud CLI (aws/az/gcloud create|delete|deploy) - _Azure SDK referenced - an agent with a shell must not be able to touch live infrastructure_
- **R14** `rule` rule line: cloud credentials are never in the repo or the agent's env
- **R17** `scaffold` CLAUDE.md from the diagnosis: build=msbuild Altshuler.sln /t:Build   # requires Windows / Visual Studio build tools; test=MSTest; lint=-; layout - _no CLAUDE.md/AGENTS.md/cursor/copilot - the agent starts from zero facts; the diagnosis provides them_
- **R21** `rule` rule line: match the surrounding style; no reformatting of untouched lines - _no lint/format config - a formatter hook would reformat files nobody formatted before_
- **R21** `report` report: no lint config - style drift is not machine-checked
- **R22b** `scaffold` onboarding doc from the diagnosis (layout, build, test, external systems) - _README 0.0 KB and no docs/ - nothing for the agent (or a new hire) to read_
- **R25** `permission` deny Read/Edit under packages/, bin/, obj/, .vs/ (3215 binaries, 2963 package files tracked) - _3215 dll/exe/pdb, 2963 package-cache files, 1020 IDE files in git - the agent would read them as code_
- **R25** `report` report: repository hygiene - tracked binaries inflate every agent context and clone
- **R32** `rule` rule line: PCF controls build with `npm run build` in their own folder (pac pcf); CRM plugins do not - _two toolchains in one solution - a node build works here, the .NET one does not_
- **R32** `scaffold` per-area CLAUDE.md: Pcf/ (node) vs CrmEntryPoints/ (msbuild)

## 5. Trial tasks (`claude -p`, read-only, `--allowedTools Read,Grep,Glob --max-turns 10 --max-budget-usd 0.5`)

Three repositories: **cline** (the React+TS app, has AI config), **fastapi-template** (the Python service, has `.claude/skills`), **eshop** (no AI config). Two tasks each: (a) "how do I run the tests and what is the build command; cite files", (b) a planning task typical for the repo. Each answer was checked against the diagnosis and by opening the cited files. Failure classes: **F1 didn't know a fact**, **F2 knew but would violate a rule**, **F3 needed external info**, **F4 could not verify / could not finish**.

### 5.1 Findings per run

| run | cost | result | judged against the repo | failure class -> component kind |
|---|---|---|---|---|
| cline (a) run tests / build | $0.34, 7 turns | `bun run build`, `bun run build:sdk`, `bun run test`, per-package `bun run test:unit`, VS Code `bun run test:integration`; cites `package.json:16-25`, `AGENTS.md`, `CONTRIBUTING.md:47-51`, `apps/vscode/package.json:376-389` | **Correct** and complete; matches the diagnosis (`bun run build`, root test script) and adds the SDK-must-be-built-first rule that AGENTS.md states | none. The existing AGENTS.md did the work: 4 of 7 turns were reading it and package.json files |
| cline (b) add a setting end-to-end | run 1: $0.50, **budget exhausted** (spawned a background research agent, no answer); run 2: $0.21, **max_turns 10, no answer** (tried `Bash find /` to locate `@cline/core`, denied); run 3: $0.28, **max_turns 10, no answer**; run 4 (`--max-turns 25`): $0.23, 16 turns, **answer** | Run 4 is right: `shared/AutoApprovalSettings.ts` -> `proto/cline/state.proto` -> `scripts/build-proto.mjs` -> `updateAutoApprovalSettings.ts` -> `getStateToPostToWebview.ts` -> webview `auto-approve-menu/constants.ts` -> `sdk/sdk-tool-policies.ts::isToolAutoApproved` -> tests. All 10 cited files exist; the enforcement point is the real one. One slip: it named `scripts/build-proto.mjs` at the root; it lives in `apps/vscode/scripts/` (`apps/vscode/package.json:353`) | **F4 could not finish** x3: in a 24-package, 4135-file monorepo the agent spends its turns locating the package. Maps to R06 (which-package skill, per-package CLAUDE.md) and to R08 (the change-recipe: this exact settings shape - shared type + proto + controller + webview metadata + policy - is a recurring 5-file change). With a recipe the plan is a lookup, not 16 turns |
| fastapi-template (a) | $0.31, 14 turns | Backend: `sh ./scripts/test.sh` (compose) or from `backend/`: `uv sync; uv run bash scripts/test.sh`; frontend: `bun run test` (Playwright); build: `bun run build` in `frontend/` (tsc + vite), backend has no build step; lint: `backend/scripts/lint.sh`, `bun run lint`; cites `scripts/test.sh`, `backend/scripts/test.sh`, `development.md:61-91`, `frontend/package.json:8-13` | **Correct.** The diagnosis could not infer a build command (no root script; `build.commands` empty) - the agent found the real answer: there is none for the backend, `docker compose build` for the stack. The 14 turns were file reads, no wasted probing | none. Note the deterministic pass *underdiagnosed* here (empty build command); R04's "verify = CI commands" (`docker compose build`, `bun run --filter frontend build`) would have stated it |
| fastapi-template (b) add a Project entity | $0.24, 4 turns | `models.py` -> `crud.py` -> alembic revision -> `api/routes/projects.py` -> `api/main.py` -> `tests/api/routes/test_projects.py` -> regenerate client -> `components/Projects/*` -> `routes/_layout/projects.tsx` -> Sidebar -> Playwright | Order and files are right (mirrors `items.py`, `_layout/items.tsx`, `components/Sidebar/AppSidebar.tsx`, `alembic/versions/`). It correctly hedged that items routes may not use `crud.py` (they do not). **One wrong fact**: it says `npm run generate-client`; the repo is Bun-only (`frontend/README.md:65`: `bun run generate-client`; diagnosis `package_managers: [bun, uv]`) | **F1 didn't know a fact** (package manager). Maps to R17/R16: a rule line "package manager: bun; never npm" - the diagnosis has the fact (`bun.lock`), the repo's `.claude/skills` are library skills (fastapi, sqlmodel) that do not state it. Also R01: it correctly treated `frontend/src/client/*` as generated (20 header-marked files) |
| eshop (a) | $0.28, 6 turns | `dotnet build eShop.Web.slnf`; `dotnet test --solution eShop.Web.slnf`; Playwright `npm ci; npx playwright install chromium; npm run test:e2e`; `aspire run`; Docker needed for functional tests; MAUI tests excluded via `paths-ignore`; cites `pr-validation.yml:16-19`, `README.md:80-92`, `global.json`, `tests/README.md` | **Correct and better than the first diagnosis pass**, which had picked `src/ClientApp/ClientApp.sln` because it did not know `.slnx`/`.slnf` (fixed in `diagnose.py` afterwards; it now reports `dotnet build eShop.Web.slnf`). The answer echoed the CI's demo password `PASSWORD=Pass123$` from `playwright.yml:38` into its output | **F2 knew but would violate a rule** (mild): reproducing a credential-shaped value from CI config in an answer. It is a demo value, but the behaviour is what R09's secret-scan hook and the "never repeat credential values" rule line exist for. Also: **the diagnosis, not the agent, was wrong first** - a detector gap (.slnx) that the trial exposed |
| eshop (b) wishlist feature | $0.32, 9 turns | New `src/Wishlist.API` mirroring `Basket.API` (proto, Redis repository, gRPC service, identity from `ServerCallContextIdentityExtensions.cs`); AppHost `Program.cs` wiring "after the basketApi block (line ~35)" and `.WithReference(wishlistApi)` "(line ~73)"; WebApp `Services/WishlistService.cs`, `WishlistState.cs`, `Extensions.cs`, a `/wishlist` page; unit + functional test projects; verify with `dotnet run --project src/eShop.AppHost` | Every cited file exists; the AppHost line numbers are exact (`basketApi` at 31-35, `.WithReference(basketApi)` at 73). Two gaps: "add to the solution file (`eShop.slnx`/whatever ... didn't find `eShop.sln`, need to check)" - it never confirmed `eShop.slnx`/`eShop.Web.slnf`; and it verifies with `dotnet run --project src/eShop.AppHost` whereas README says `aspire run`, and hedges "if Playwright e2e tests exist (`e2e/`)" without checking (`playwright.config.ts` is at the root) | **F4 could not verify** x2 (solution file, e2e location) and **F1** (run command). Maps to R31 (rule line: run through AppHost with `aspire run`; Docker required) and R17 (CLAUDE.md from the diagnosis: solution = `eShop.Web.slnf`, tests = `dotnet test --solution eShop.Web.slnf`, e2e = `npm run test:e2e`) |

### 5.2 What the trials say about component kinds

- Where an instruction file already stated the facts (cline AGENTS.md), task (a) was perfect and cheap. Where the facts were only in the diagnosis (eshop, fastapi package manager), the agent either found them at a cost (eshop: 6 turns, fine) or got one wrong (fastapi: `npm`). This is the case for **rule lines generated from the diagnosis** (R17/R16), the cheapest component.
- The one repeated hard failure (cline (b), 3 of 4 runs produced nothing) was not a knowledge failure but a **navigation** failure in a large monorepo: this is exactly R06 (which-package skill) and R08 (change recipe). A rule line would not have fixed it; a recipe would.
- The two verification gaps in eshop (b) are facts the diagnosis already holds (`eShop.Web.slnf`, `playwright.config.ts`); they map to a scaffolded CLAUDE.md, not to a subagent.
- One F2 (credential echo) supports the secret-scan hook even in a repo with zero real secrets: CI files contain credential-shaped demo values and the agent repeats them.
- No trial needed external information (F3); the client repository would (Dataverse metadata is not in the repo - R12), but it was not run through the trials (read-only, cannot build, and its tests need a CRM environment).


### 5.3 Run log (`trials/*.json`)

| run | cost USD | turns | outcome |
|---|---|---|---|
| cline-a | 0.34 | 7 | success |
| cline-b | 0.50 | 2 | success |
| cline-b2 | 0.21 | 11 | error_max_turns |
| cline-b3 | 0.28 | 11 | error_max_turns |
| cline-b4 | 0.23 | 16 | success (max_turns 25) |
| eshop-a | 0.28 | 6 | success |
| eshop-b | 0.32 | 9 | success |
| fastapi-template-a | 0.31 | 14 | success |
| fastapi-template-b | 0.24 | 4 | success |

Total model spend for the trials: **$2.71** (all `claude-sonnet-5`, `--max-budget-usd 0.5` per run). The diagnosis and rule application cost nothing.

## 6. Caveats

- **Detector gaps found during the study** and fixed: `.slnx`/`.slnf` solution formats (eshop); `packages.config` as a dependency source (the client's MSTest reference lives there); sub-package `package.json` dependencies (React in cline lives under `apps/vscode/webview-ui`). A deterministic diagnosis is only as good as its detectors; the trials are a cheap way to find the gaps.
- **Secrets are regex-shaped, not verified.** 301 hits in cline are test fixtures with fake keys; the 10 "outside tests" hits in codex are in source that handles credentials (redaction, bedrock auth), i.e. patterns, not values. The rule set therefore splits "in tests only" (R09b: allowlist) from "outside tests" (R09a: report + deny), and the report shows paths and counts only. The client repo's two hits are real connection strings with passwords in `Stuff/OneTimeConsole/Program.cs` and `Test/ParserTester/Program.cs` (values not recorded anywhere here).
- **History signals depend on clone depth.** Hot spots and change shapes come from at most 200 first-parent commits (more where merges widen it). The client clone has one squashed commit, so R07/R08/R30 cannot fire for it - the diagnosis says so (`git.commits_in_clone: 1`) rather than guessing.
- **`--depth 200` size trap:** phpmyadmin's 200 commits weighed 509 MB of packs; `--filter=blob:none` keeps history for `git log --name-only` at 103 MB.
- **Rule thresholds are choices** (hot spot = >=100 changes and >=10 authors; change shape = same >=3 files >=3 times; notebooks >=3; binaries >20). They are in `rules.json`/`apply_rules.py` and can be tuned; the point of the study is that the mapping is explicit and reproducible, not that these numbers are final.
- **The trials are six plus three retries on three repositories with one model** (`claude-sonnet-5`) - enough to show which failure kinds map to which component kinds, not a benchmark. The cline (b) retries changed the prompt (no subagents, no shell, then 25 turns) and are reported as such.
- **`--max-turns 10` is tight for a 4000-file monorepo** and generous for a 250-file one; the same budget produced a perfect answer on fastapi-template and three empty answers on cline.
- The client clone was read only; nothing under `/home/user/altshuler_trade` was modified, and no build or test was attempted there (Windows-only, R11).
- `/home/user/delivery-control-center` was not touched.

## 7. Ten-line summary

1. Same script, same rules, eleven repos -> eleven different component sets (11/11 distinct; closest pair 0.69 Jaccard, farthest 0.00).
2. **altshuler_trade** (client): 27 components - Windows runner + "cannot build here" rule, Dataverse MCP, deny on 40 sensitive files and on `packages/`/`bin/`/`.vs/` (3215 tracked binaries), no CI -> local gate scaffold, no docs -> onboarding doc. Nothing about tests-first agents or formatter hooks.
3. **cline**: 26 - merge 5 kinds of AI config into one AGENTS.md (R15), which-package skill for 24 packages, fixture-key allowlist, LLM-key deny; no scaffolded CLAUDE.md (one exists).
4. **codex**: 23 - generated-code deny on 764 header-marked files, reviewer for `codex-rs/tui` (2863 changes, 14 authors), contribution-style skill (54 authors).
5. **eshop**: 22 - Aspire AppHost rule + Docker runner, EF migrations as generated, dependency-bump recipe (`Directory.Packages.props` co-changes 14x), CLAUDE.md from the diagnosis.
6. **phpmyadmin**: 22 - security reviewer (PHP+jQuery), deny on `resources/po` (10834 machine-synced changes), read-only DB MCP, no AI config -> scaffold.
7. **pydatasci-handbook**: 13 - notebook rules + nbformat hook, first-tests scaffold + build gate, explicitly *not* a test-writer agent, no formatter hook.
8. **terraform-aws-eks**: 15 - plan-only hook (deny apply/destroy), terraform-docs regen skill (README/variables co-change 15x), cloud-CLI deny.
9. **nowinandroid / spring-petclinic / gh-cli / fastapi-template**: 18 / 15 / 18 / 16 - mobile emulator-free verification; Maven+Gradle sync rule; delta-only doc on top of an existing CLAUDE.md; compose runner + `frontend/src/client` generated deny.
10. Trials: the failures observed (wrong package manager, unverified solution file, credential echo, three timeouts navigating a monorepo) each map to a component the rules had already selected for that repo (R17 rule line, R31/R17 scaffold, R09 hook, R06/R08 skill) - at $2.71 total model spend.
