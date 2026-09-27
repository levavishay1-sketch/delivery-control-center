# Component sets per repository (rules applied to the deterministic diagnosis)

## Rule-firing matrix

| rule | signal | altshuler_trade | cline | codex | eshop | fastapi-template | gh-cli | nowinandroid | phpmyadmin | pydatasci-handbook | spring-petclinic | terraform-aws-eks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R01 | generated code present (path markers or 'auto-generated' headers) | x | x | x | x | x | x |  | x |  |  |  |
| R02 | no test framework detected |  |  |  |  |  |  |  |  | x |  |  |
| R03 | test framework present with a real corpus |  | x | x | x | x | x | x | x |  | x | x |
| R04 | CI present |  | x | x | x | x | x | x | x |  | x | x |
| R05 | no CI | x |  |  |  |  |  |  |  | x |  |  |
| R06 | monorepo / multi-project layout | x | x | x | x | x |  | x |  |  |  |  |
| R07 | hot-spot directory with many contributors |  | x | x | x |  | x | x | x | x | x |  |
| R08 | repeated change shapes (same >=3 files changed together >=3 times) |  | x |  | x | x | x | x | x |  |  | x |
| R09a | secret-looking strings outside test files | x | x | x |  |  |  |  |  |  |  |  |
| R09b | secret-looking strings only in tests/fixtures |  |  |  |  |  | x |  | x |  |  |  |
| R10 | sensitive files tracked (.env, .snk, .pfx, .pem, app/web.config, appsettings.Development) | x | x | x | x | x |  |  |  |  |  |  |
| R11 | Windows-only build (.NET Framework / msbuild / .snk) | x |  |  |  |  |  |  |  |  |  |  |
| R12 | external system: Dataverse / Dynamics 365 | x |  |  |  |  |  |  |  |  |  |  |
| R13 | external system: relational database |  |  |  | x | x |  |  | x |  | x |  |
| R14 | cloud SDK / IaC provider present | x | x |  |  |  |  |  |  |  |  | x |
| R15 | existing tool-specific AI config (cursor / clinerules / copilot-instructions) |  | x |  |  |  |  |  |  |  |  |  |
| R16 | AGENTS.md / CLAUDE.md already present |  | x | x |  |  | x | x |  |  |  |  |
| R17 | no AI configuration at all | x |  |  | x |  |  |  | x | x | x | x |
| R18 | Jupyter notebooks |  |  |  |  |  |  |  |  | x |  |  |
| R19 | Terraform |  |  |  |  |  |  |  |  |  |  | x |
| R20 | formatter / linter configured |  | x | x | x | x | x | x | x |  | x | x |
| R21 | no formatter / linter | x |  |  |  |  |  |  |  | x |  |  |
| R22a | substantial docs (README >= 8 KB or docs/ folder or architecture doc) |  | x | x |  |  | x | x | x |  | x | x |
| R22b | thin docs (no README or < 2 KB, no docs/) | x |  |  |  |  |  |  |  |  |  |  |
| R23 | devcontainer / Dockerfile / compose |  |  | x |  | x | x |  |  |  | x |  |
| R24 | legacy web stack (PHP + vendored jQuery / Twig) |  |  |  |  |  |  |  | x |  |  |  |
| R25 | binaries / package caches / IDE state tracked in git | x |  |  |  |  |  |  |  |  |  |  |
| R26 | Android / mobile app |  |  |  |  |  |  | x |  |  |  |  |
| R27 | several build systems in one repo |  |  |  |  |  |  |  |  |  | x |  |
| R28 | large contributor base |  |  | x |  |  | x | x | x |  | x | x |
| R29 | LLM provider SDK in dependencies |  | x | x | x |  |  |  |  |  |  |  |
| R30 | lock file churn / dependency-bump shape |  |  |  | x | x | x | x | x |  |  |  |
| R31 | Aspire / orchestrated multi-service .NET |  |  |  | x |  |  |  |  |  |  |  |
| R32 | PCF control / web resources beside a CRM backend | x |  |  |  |  |  |  |  |  |  |  |

## Set fingerprints

| repo | rules fired | components | by kind |
|---|---|---|---|
| altshuler_trade | R01, R05, R06, R09a, R10, R11, R12, R14, R17, R21, R22b, R25, R32 | 27 | hook 2, mcp 1, permission 5, report 4, rule 7, runner 1, scaffold 5, skill 2 |
| cline | R01, R03, R04, R06, R07, R08, R09a, R10, R14, R15, R16, R20, R22a, R29 | 26 | agent 1, doc 2, hook 3, permission 4, report 2, rule 7, scaffold 2, skill 5 |
| codex | R01, R03, R04, R06, R07, R09a, R10, R16, R20, R22a, R23, R28, R29 | 23 | agent 1, doc 2, hook 3, permission 3, report 1, rule 6, runner 1, scaffold 1, skill 5 |
| eshop | R01, R03, R04, R06, R07, R08, R10, R13, R17, R20, R29, R30, R31 | 22 | agent 1, doc 1, hook 2, mcp 1, permission 2, rule 8, runner 1, scaffold 2, skill 4 |
| fastapi-template | R01, R03, R04, R06, R08, R10, R13, R20, R23, R30 | 16 | hook 2, mcp 1, permission 1, rule 6, runner 1, scaffold 1, skill 4 |
| gh-cli | R01, R03, R04, R07, R08, R09b, R16, R20, R22a, R23, R28, R30 | 18 | agent 1, doc 2, hook 3, rule 6, runner 1, skill 5 |
| nowinandroid | R03, R04, R06, R07, R08, R16, R20, R22a, R26, R28, R30 | 18 | agent 1, doc 2, hook 1, rule 5, runner 1, scaffold 1, skill 7 |
| phpmyadmin | R01, R03, R04, R07, R08, R09b, R13, R17, R20, R22a, R24, R28, R30 | 22 | agent 2, doc 1, hook 3, mcp 1, permission 1, rule 8, scaffold 1, skill 5 |
| pydatasci-handbook | R02, R05, R07, R17, R18, R21 | 13 | agent 1, doc 1, hook 2, permission 1, report 3, rule 2, scaffold 3 |
| spring-petclinic | R03, R04, R07, R13, R17, R20, R22a, R23, R27, R28 | 15 | agent 1, doc 1, hook 1, mcp 1, rule 5, runner 1, scaffold 1, skill 4 |
| terraform-aws-eks | R03, R04, R08, R14, R17, R19, R20, R22a, R28 | 15 | hook 2, permission 1, rule 5, scaffold 1, skill 6 |

Distinct rule sets: 11 of 11 repositories.

Most similar pairs (Jaccard on rules fired): cline~codex 0.69; gh-cli~phpmyadmin 0.67; gh-cli~nowinandroid 0.64; eshop~fastapi-template 0.64

## altshuler_trade

- **R01** generated code present (path markers or 'auto-generated' headers) - _generated code in Shared/DataModel/Crm/Alt.DataModel.Crm/EBG; editing it by hand is silently overwritten on the next build_
  - `hook` PreToolUse deny Edit/Write under generated dirs
  - `rule` rule line: these paths are generated; change the source and regenerate
- **R05** no CI - _no CI config found - nothing defines green, so a minimal local gate must be created before agents change code_
  - `scaffold` local verify script (build + tests) as the only gate
  - `report` report: no CI - agent output cannot be machine-checked before merge
- **R06** monorepo / multi-project layout - _69 .NET projects in 1 solution(s) (67 packages) - one root instruction file cannot state the right build/test command for each_
  - `scaffold` per-package CLAUDE.md / AGENTS.md (build+test per package)
  - `skill` which-package skill (maps a request to the owning package)
  - `rule` rule line: run commands from the package dir, not the root
- **R09a** secret-looking strings outside test files - _1 credential-shaped hits outside tests (connection_string_with_password) - an agent must neither read nor propagate them_
  - `permission` deny Read on the flagged files until reviewed
  - `hook` PreToolUse secret-scan on Write/Edit and on git commit
  - `report` report to owner: 1 hits in Stuff/OneTimeConsole/Program.cs
- **R10** sensitive files tracked (.env, .snk, .pfx, .pem, app/web.config, appsettings.Development) - _40 sensitive-by-name files - out of the agent's context by default_
  - `permission` deny Read/Edit on 40 sensitive files (Alt.BusinessLogicLayer.Crm.External.snk, app.config, Alt.BusinessLogicLayer.Crm.snk)
- **R11** Windows-only build (.NET Framework / msbuild / .snk) - _1 .sln, netframework v4.6.2, netframework v4.7.2 targets, 58 .snk - msbuild on Windows only; an agent on Linux must say so instead of guessing_
  - `rule` rule line: 'this repository cannot be built here' - no build or test claims
  - `runner` Windows build runner (msbuild + VS build tools) reachable by a build-on-runner skill
  - `skill` build-on-runner skill (submit, wait, fetch log)
- **R12** external system: Dataverse / Dynamics 365 - _251 Dataverse/CRM SDK references - schema lives in the environment, not in the repo_
  - `mcp` Dataverse MCP server candidate (official Power Platform MCP, read-only scope first)
  - `rule` rule line: entity/attribute names come from Dataverse metadata, never guessed
  - `permission` deny plugin registration / solution import commands
- **R14** cloud SDK / IaC provider present - _Azure SDK referenced - an agent with a shell must not be able to touch live infrastructure_
  - `permission` deny mutating cloud CLI (aws/az/gcloud create|delete|deploy)
  - `rule` rule line: cloud credentials are never in the repo or the agent's env
- **R17** no AI configuration at all - _no CLAUDE.md/AGENTS.md/cursor/copilot - the agent starts from zero facts; the diagnosis provides them_
  - `scaffold` CLAUDE.md from the diagnosis: build=msbuild Altshuler.sln /t:Build   # requires Windows / Visual Studio build tools; test=MSTest; lint=-; layout
- **R21** no formatter / linter - _no lint/format config - a formatter hook would reformat files nobody formatted before_
  - `rule` rule line: match the surrounding style; no reformatting of untouched lines
  - `report` report: no lint config - style drift is not machine-checked
- **R22b** thin docs (no README or < 2 KB, no docs/) - _README 0.0 KB and no docs/ - nothing for the agent (or a new hire) to read_
  - `scaffold` onboarding doc from the diagnosis (layout, build, test, external systems)
- **R25** binaries / package caches / IDE state tracked in git - _3215 dll/exe/pdb, 2963 package-cache files, 1020 IDE files in git - the agent would read them as code_
  - `permission` deny Read/Edit under packages/, bin/, obj/, .vs/ (3215 binaries, 2963 package files tracked)
  - `report` report: repository hygiene - tracked binaries inflate every agent context and clone
- **R32** PCF control / web resources beside a CRM backend - _two toolchains in one solution - a node build works here, the .NET one does not_
  - `rule` rule line: PCF controls build with `npm run build` in their own folder (pac pcf); CRM plugins do not
  - `scaffold` per-area CLAUDE.md: Pcf/ (node) vs CrmEntryPoints/ (msbuild)

## cline

- **R01** generated code present (path markers or 'auto-generated' headers) - _generated code in apps/vscode/src/types, sdk/packages/llms/src/catalog, sdk/packages/llms/src/providers; editing it by hand is silently overwritten on the next build_
  - `hook` PreToolUse deny Edit/Write under generated dirs
  - `rule` rule line: these paths are generated; change the source and regenerate
- **R03** test framework present with a real corpus - _package.json:test -> bun --parallel -F './sdk/packages/**' -F @cline/cli -F @cline/cline-hub -F @clin, vitest with 946 test files - the agent should run the existing suite, not write a new one_
  - `skill` run-affected-tests skill (bun run test)
  - `rule` rule line: test command + where tests live
- **R04** CI present - _CI (github-actions, 18 workflows) already encodes the project's definition of green: bun run build:sdk; NODE_FILE="node_modules/better-sqlite3/build/Release/better_sqlite3.node"; npm install -g @vscode/vsce ovsx_
  - `skill` verify skill = the CI commands run locally
  - `rule` rule line: 'done' means the CI commands pass
- **R06** monorepo / multi-project layout - _sdk/packages/*; apps/* (24 packages) - one root instruction file cannot state the right build/test command for each_
  - `scaffold` per-package CLAUDE.md / AGENTS.md (build+test per package)
  - `skill` which-package skill (maps a request to the owning package)
  - `rule` rule line: run commands from the package dir, not the root
- **R07** hot-spot directory with many contributors - _sdk/packages changed 1460 times by 14 authors in the sampled history - highest regression risk, no single owner_
  - `doc` architecture note for sdk/packages
  - `agent` reviewer subagent scoped to sdk/packages
- **R08** repeated change shapes (same >=3 files changed together >=3 times) - _1 recurring file-sets in history - a recipe makes the agent touch all of them, not just the obvious one_
  - `skill` change-recipe skill for: CHANGELOG.md + package.json + tauri.conf.json (12x)
- **R09a** secret-looking strings outside test files - _5 credential-shaped hits outside tests (password_assignment, slack_token, aws_access_key) - an agent must neither read nor propagate them_
  - `permission` deny Read on the flagged files until reviewed
  - `hook` PreToolUse secret-scan on Write/Edit and on git commit
  - `report` report to owner: 5 hits in 
- **R10** sensitive files tracked (.env, .snk, .pfx, .pem, app/web.config, appsettings.Development) - _1 sensitive-by-name files - out of the agent's context by default_
  - `permission` deny Read/Edit on 1 sensitive files (.env.example)
- **R14** cloud SDK / IaC provider present - _AWS SDK referenced - an agent with a shell must not be able to touch live infrastructure_
  - `permission` deny mutating cloud CLI (aws/az/gcloud create|delete|deploy)
  - `rule` rule line: cloud credentials are never in the repo or the agent's env
- **R15** existing tool-specific AI config (cursor / clinerules / copilot-instructions) - _clinerules, copilot present (70 files) - a second, disagreeing instruction file is worse than none_
  - `scaffold` merge clinerules, copilot into one AGENTS.md; CLAUDE.md = '@AGENTS.md' import
  - `report` report: do not duplicate - 70 AI files already exist
- **R16** AGENTS.md / CLAUDE.md already present - _instruction file exists (.agents/skills/cline-sdk/SKILL.md, .agents/skills/cline-sdk/references/agent/REFERENCE.md) - generate only what the diagnosis proves and the file lacks_
  - `doc` delta only: append diagnosis facts missing from the existing file (build/test commands, generated paths, external systems - whichever the file lacks)
- **R20** formatter / linter configured - _@biomejs/biome, biome.json configured - style is mechanical; a hook removes it from review_
  - `hook` PostToolUse: run @biomejs/biome on the edited file
- **R22a** substantial docs (README >= 8 KB or docs/ folder or architecture doc) - _README 9.0 KB, 160 docs files, arch docs: apps/examples/desktop-app/sidecar/ARCHITECTURE.md, evals/ARCHITECTURE.md - the answers exist; the agent must be pointed at them_
  - `rule` rule line: read apps/examples/desktop-app/sidecar/ARCHITECTURE.md before planning
  - `skill` docs-sync skill: a change that alters behaviour updates apps/examples/desktop-app/sidecar/ARCHITECTURE.md
- **R29** LLM provider SDK in dependencies - _OpenAI API, Anthropic API referenced - a test run that hits the real API costs money and is non-deterministic_
  - `rule` rule line: tests never call live model APIs; provider keys are not in the agent's env
  - `permission` deny reading *_API_KEY env / .env

## codex

- **R01** generated code present (path markers or 'auto-generated' headers) - _generated code in codex-rs/tui/src/chatwidget/snapshots, codex-rs/tui/src/bottom_pane/snapshots, codex-rs/tui/src/snapshots, codex-rs/tui/src/history_cell/snapshots, codex-rs/tui/src/app/snapshots, codex-rs/tui/src/chatwidget/tests/snapshots; editing it by hand is silently overwritten on the next build_
  - `hook` PreToolUse deny Edit/Write under generated dirs
  - `rule` rule line: these paths are generated; change the source and regenerate
- **R03** test framework present with a real corpus - _cargo test with 1955 test files - the agent should run the existing suite, not write a new one_
  - `skill` run-affected-tests skill (cargo test)
  - `rule` rule line: test command + where tests live
- **R04** CI present - _CI (github-actions, 29 workflows) already encodes the project's definition of green: pnpm install --frozen-lockfile; cargo fmt -- --config imports_granularity=Item --check; cargo shear --deny-warnings_
  - `skill` verify skill = the CI commands run locally
  - `rule` rule line: 'done' means the CI commands pass
- **R06** monorepo / multi-project layout - _pnpm-workspace.yaml; cargo workspace: codex-rs/Cargo.toml (164 packages) - one root instruction file cannot state the right build/test command for each_
  - `scaffold` per-package CLAUDE.md / AGENTS.md (build+test per package)
  - `skill` which-package skill (maps a request to the owning package)
  - `rule` rule line: run commands from the package dir, not the root
- **R07** hot-spot directory with many contributors - _codex-rs/tui changed 2863 times by 14 authors in the sampled history - highest regression risk, no single owner_
  - `doc` architecture note for codex-rs/tui
  - `agent` reviewer subagent scoped to codex-rs/tui
- **R09a** secret-looking strings outside test files - _10 credential-shaped hits outside tests (private_key_block, password_assignment, openai_key, aws_access_key, github_token) - an agent must neither read nor propagate them_
  - `permission` deny Read on the flagged files until reviewed
  - `hook` PreToolUse secret-scan on Write/Edit and on git commit
  - `report` report to owner: 10 hits in codex-rs/memories/write/src/phase1.rs, codex-rs/model-provider/src/amazon_bedrock/mod.rs, codex-rs/agent-identity/src/lib.rs
- **R10** sensitive files tracked (.env, .snk, .pfx, .pem, app/web.config, appsettings.Development) - _4 sensitive-by-name files - out of the agent's context by default_
  - `permission` deny Read/Edit on 4 sensitive files (.npmrc, test-ca-trusted.pem, test-ca.pem)
- **R16** AGENTS.md / CLAUDE.md already present - _instruction file exists (AGENTS.md) - generate only what the diagnosis proves and the file lacks_
  - `doc` delta only: append diagnosis facts missing from the existing file (build/test commands, generated paths, external systems - whichever the file lacks)
- **R20** formatter / linter configured - _prettier, ruff, rustfmt/clippy (toolchain pinned), ruff.toml configured - style is mechanical; a hook removes it from review_
  - `hook` PostToolUse: run prettier on the edited file
- **R22a** substantial docs (README >= 8 KB or docs/ folder or architecture doc) - _README 3.3 KB, 15 docs files, arch docs: none - the answers exist; the agent must be pointed at them_
  - `rule` rule line: read docs/ before planning
  - `skill` docs-sync skill: a change that alters behaviour updates docs/
- **R23** devcontainer / Dockerfile / compose - _Dockerfile present - the reproducible environment already exists_
  - `runner` run the agent inside Dockerfile; same toolchain as CI
- **R28** large contributor base - _54 authors in the sample - output must look like everyone else's PR to be merged_
  - `skill` contribution-style skill: PR format, commit convention, CONTRIBUTING (no CONTRIBUTING)
- **R29** LLM provider SDK in dependencies - _OpenAI API referenced - a test run that hits the real API costs money and is non-deterministic_
  - `rule` rule line: tests never call live model APIs; provider keys are not in the agent's env
  - `permission` deny reading *_API_KEY env / .env

## eshop

- **R01** generated code present (path markers or 'auto-generated' headers) - _generated code in src/Ordering.Infrastructure/Migrations, src/Catalog.API/Infrastructure/Migrations, src/ClientApp/Services/Basket/Protos, src/Identity.API/Data/Migrations, src/Webhooks.API/Migrations; editing it by hand is silently overwritten on the next build_
  - `hook` PreToolUse deny Edit/Write under generated dirs
  - `rule` rule line: these paths are generated; change the source and regenerate
- **R03** test framework present with a real corpus - _@playwright/test, xunit with 54 test files - the agent should run the existing suite, not write a new one_
  - `skill` run-affected-tests skill (npm run test:e2e)
  - `rule` rule line: test command + where tests live
- **R04** CI present - _CI (github-actions, 4 workflows) already encodes the project's definition of green: npm ci; npx playwright install --with-deps chromium; npm run test:e2e_
  - `skill` verify skill = the CI commands run locally
  - `rule` rule line: 'done' means the CI commands pass
- **R06** monorepo / multi-project layout - _28 .NET projects in 4 solution(s) (28 packages) - one root instruction file cannot state the right build/test command for each_
  - `scaffold` per-package CLAUDE.md / AGENTS.md (build+test per package)
  - `skill` which-package skill (maps a request to the owning package)
  - `rule` rule line: run commands from the package dir, not the root
- **R07** hot-spot directory with many contributors - _src/ClientApp changed 511 times by 10 authors in the sampled history - highest regression risk, no single owner_
  - `doc` architecture note for src/ClientApp
  - `agent` reviewer subagent scoped to src/ClientApp
- **R08** repeated change shapes (same >=3 files changed together >=3 times) - _1 recurring file-sets in history - a recipe makes the agent touch all of them, not just the obvious one_
  - `skill` change-recipe skill for: ClientApp.csproj + HybridApp.csproj + ClientApp.UnitTests.csproj (5x)
- **R10** sensitive files tracked (.env, .snk, .pfx, .pem, app/web.config, appsettings.Development) - _9 sensitive-by-name files - out of the agent's context by default_
  - `permission` deny Read/Edit on 9 sensitive files (appsettings.Development.json, appsettings.Development.json, appsettings.Development.json)
- **R13** external system: relational database - _PostgreSQL referenced in manifests/compose_
  - `rule` rule line: schema changes go through the migration tool (PostgreSQL); no ad-hoc SQL
  - `mcp` read-only DB MCP candidate - only if a local/compose DB exists (no compose - skip the MCP)
- **R17** no AI configuration at all - _no CLAUDE.md/AGENTS.md/cursor/copilot - the agent starts from zero facts; the diagnosis provides them_
  - `scaffold` CLAUDE.md from the diagnosis: build=dotnet build eShop.Web.slnf; test=npm run test:e2e; lint=editorconfig, .editorconfig; layout
- **R20** formatter / linter configured - _editorconfig, .editorconfig configured - style is mechanical; a hook removes it from review_
  - `hook` PostToolUse: run editorconfig on the edited file
- **R29** LLM provider SDK in dependencies - _OpenAI API referenced - a test run that hits the real API costs money and is non-deterministic_
  - `rule` rule line: tests never call live model APIs; provider keys are not in the agent's env
  - `permission` deny reading *_API_KEY env / .env
- **R30** lock file churn / dependency-bump shape - _Directory.Packages.props + ClientApp.UnitTests.csproj co-change 14 times - the most frequent change shape in history is a dependency bump_
  - `rule` rule line: dependency bumps = Directory.Packages.props + ClientApp.UnitTests.csproj together; never edit a lock file by hand
- **R31** Aspire / orchestrated multi-service .NET - _Aspire AppHost orchestrates PostgreSQL, Redis, RabbitMQ/AMQP; 'dotnet run' on one service is not the system_
  - `rule` rule line: run through the AppHost project; services are not started individually
  - `runner` Docker on the runner (Aspire containers: PostgreSQL, Redis, RabbitMQ/AMQP)

## fastapi-template

- **R01** generated code present (path markers or 'auto-generated' headers) - _generated code in frontend/src/client/core, frontend/src/client, frontend/src/client/client, backend/app/alembic/versions; editing it by hand is silently overwritten on the next build_
  - `hook` PreToolUse deny Edit/Write under generated dirs
  - `rule` rule line: these paths are generated; change the source and regenerate
- **R03** test framework present with a real corpus - _package.json:test -> bun run --filter frontend test, pytest with 28 test files - the agent should run the existing suite, not write a new one_
  - `skill` run-affected-tests skill (docker compose run --rm playwright bunx playwright test --fail-on-flaky-tests --trace=retain-on-fail)
  - `rule` rule line: test command + where tests live
- **R04** CI present - _CI (github-actions, 15 workflows) already encodes the project's definition of green: docker compose build; docker compose -f compose.yml -f compose.deploy.yml build; bun run --filter frontend build_
  - `skill` verify skill = the CI commands run locally
  - `rule` rule line: 'done' means the CI commands pass
- **R06** monorepo / multi-project layout - _frontend; packages/* (3 packages) - one root instruction file cannot state the right build/test command for each_
  - `scaffold` per-package CLAUDE.md / AGENTS.md (build+test per package)
  - `skill` which-package skill (maps a request to the owning package)
  - `rule` rule line: run commands from the package dir, not the root
- **R08** repeated change shapes (same >=3 files changed together >=3 times) - _1 recurring file-sets in history - a recipe makes the agent touch all of them, not just the obvious one_
  - `skill` change-recipe skill for: pyproject.toml + pyproject.toml + uv.lock (4x)
- **R10** sensitive files tracked (.env, .snk, .pfx, .pem, app/web.config, appsettings.Development) - _2 sensitive-by-name files - out of the agent's context by default_
  - `permission` deny Read/Edit on 2 sensitive files (.env, .env)
- **R13** external system: relational database - _PostgreSQL referenced in manifests/compose_
  - `rule` rule line: schema changes go through the migration tool (PostgreSQL); no ad-hoc SQL
  - `mcp` read-only DB MCP candidate - only if a local/compose DB exists (compose present)
- **R20** formatter / linter configured - _ruff, black, flake8, mypy configured - style is mechanical; a hook removes it from review_
  - `hook` PostToolUse: run ruff on the edited file
- **R23** devcontainer / Dockerfile / compose - _Dockerfile, compose present - the reproducible environment already exists_
  - `runner` run the agent inside Dockerfile, compose; same toolchain as CI
- **R30** lock file churn / dependency-bump shape - _pyproject.toml + uv.lock co-change 16 times - the most frequent change shape in history is a dependency bump_
  - `rule` rule line: dependency bumps = pyproject.toml + uv.lock together; never edit a lock file by hand

## gh-cli

- **R01** generated code present (path markers or 'auto-generated' headers) - _generated code in internal/codespaces/rpc/codespace, internal/codespaces/rpc/jupyter, internal/codespaces/rpc/ssh, internal/barista/observability, internal/gh/mock, pkg/cmd/codespace; editing it by hand is silently overwritten on the next build_
  - `hook` PreToolUse deny Edit/Write under generated dirs
  - `rule` rule line: these paths are generated; change the source and regenerate
- **R03** test framework present with a real corpus - _go test with 422 test files - the agent should run the existing suite, not write a new one_
  - `skill` run-affected-tests skill (go test -tags=acceptance ./acceptance)
  - `rule` rule line: test command + where tests live
- **R04** CI present - _CI (github-actions, 15 workflows) already encodes the project's definition of green: make; go test -tags=acceptance ./acceptance; echo "GOROOT=$(go env GOROOT)" >> "$GITHUB_ENV"_
  - `skill` verify skill = the CI commands run locally
  - `rule` rule line: 'done' means the CI commands pass
- **R07** hot-spot directory with many contributors - _pkg/cmd changed 18773 times by 121 authors in the sampled history - highest regression risk, no single owner_
  - `doc` architecture note for pkg/cmd
  - `agent` reviewer subagent scoped to pkg/cmd
- **R08** repeated change shapes (same >=3 files changed together >=3 times) - _8 recurring file-sets in history - a recipe makes the agent touch all of them, not just the obvious one_
  - `skill` change-recipe skill for: third-party-licenses.darwin.md + third-party-licenses.linux.md + third-party-licenses.windows.md (32x)
- **R09b** secret-looking strings only in tests/fixtures - _23 hits, all in test files - fake keys; without an allowlist a naive scan hook blocks every test edit_
  - `rule` rule line: test fixtures contain fake keys - do not 'fix' or redact them
  - `hook` PreToolUse secret-scan on Write/Edit with a test-path allowlist
- **R16** AGENTS.md / CLAUDE.md already present - _instruction file exists (AGENTS.md, CLAUDE.md) - generate only what the diagnosis proves and the file lacks_
  - `doc` delta only: append diagnosis facts missing from the existing file (build/test commands, generated paths, external systems - whichever the file lacks)
- **R20** formatter / linter configured - _golangci-lint, .golangci.yml configured - style is mechanical; a hook removes it from review_
  - `hook` PostToolUse: run golangci-lint on the edited file
- **R22a** substantial docs (README >= 8 KB or docs/ folder or architecture doc) - _README 6.1 KB, 70 docs files, arch docs: none - the answers exist; the agent must be pointed at them_
  - `rule` rule line: read docs/ before planning
  - `skill` docs-sync skill: a change that alters behaviour updates docs/
- **R23** devcontainer / Dockerfile / compose - _devcontainer present - the reproducible environment already exists_
  - `runner` run the agent inside devcontainer; same toolchain as CI
- **R28** large contributor base - _173 authors in the sample - output must look like everyone else's PR to be merged_
  - `skill` contribution-style skill: PR format, commit convention, CONTRIBUTING (.github/CONTRIBUTING.md)
- **R30** lock file churn / dependency-bump shape - _go.mod + go.sum co-change 211 times - the most frequent change shape in history is a dependency bump_
  - `rule` rule line: dependency bumps = go.mod + go.sum together; never edit a lock file by hand

## nowinandroid

- **R03** test framework present with a real corpus - _junit, roborazzi-screenshot with 69 test files - the agent should run the existing suite, not write a new one_
  - `skill` run-affected-tests skill (./gradlew testDemoDebug :lint:test)
  - `rule` rule line: test command + where tests live
- **R04** CI present - _CI (github-actions, 3 workflows) already encodes the project's definition of green: ./gradlew :build-logic:convention:check; ./gradlew :benchmarks:pixel6Api33Setup; ./gradlew spotlessCheck_
  - `skill` verify skill = the CI commands run locally
  - `rule` rule line: 'done' means the CI commands pass
- **R06** monorepo / multi-project layout - _36 gradle modules (36 packages) - one root instruction file cannot state the right build/test command for each_
  - `scaffold` per-package CLAUDE.md / AGENTS.md (build+test per package)
  - `skill` which-package skill (maps a request to the owning package)
  - `rule` rule line: run commands from the package dir, not the root
- **R07** hot-spot directory with many contributors - _core/designsystem changed 1488 times by 44 authors in the sampled history - highest regression risk, no single owner_
  - `doc` architecture note for core/designsystem
  - `agent` reviewer subagent scoped to core/designsystem
- **R08** repeated change shapes (same >=3 files changed together >=3 times) - _6 recurring file-sets in history - a recipe makes the agent touch all of them, not just the obvious one_
  - `skill` change-recipe skill for: releaseRuntimeClasspath.txt + prodReleaseRuntimeClasspath.txt + libs.versions.toml (5x)
- **R16** AGENTS.md / CLAUDE.md already present - _instruction file exists (AGENTS.md) - generate only what the diagnosis proves and the file lacks_
  - `doc` delta only: append diagnosis facts missing from the existing file (build/test commands, generated paths, external systems - whichever the file lacks)
- **R20** formatter / linter configured - _spotless, ktlint, .editorconfig configured - style is mechanical; a hook removes it from review_
  - `hook` PostToolUse: run spotless on the edited file
- **R22a** substantial docs (README >= 8 KB or docs/ folder or architecture doc) - _README 10.7 KB, 9 docs files, arch docs: docs/ArchitectureLearningJourney.md - the answers exist; the agent must be pointed at them_
  - `rule` rule line: read docs/ArchitectureLearningJourney.md before planning
  - `skill` docs-sync skill: a change that alters behaviour updates docs/ArchitectureLearningJourney.md
- **R26** Android / mobile app - _mobile toolchain (android, jetpack-compose) - instrumented tests need a device; the agent verifies with what runs on JVM_
  - `skill` emulator-free verification skill: JVM unit tests + screenshot tests (roborazzi-screenshot)
  - `runner` Android SDK on the runner; full ./gradlew build is minutes, not seconds
- **R28** large contributor base - _180 authors in the sample - output must look like everyone else's PR to be merged_
  - `skill` contribution-style skill: PR format, commit convention, CONTRIBUTING (CONTRIBUTING.md)
- **R30** lock file churn / dependency-bump shape - _build.gradle.kts + libs.versions.toml co-change 28 times - the most frequent change shape in history is a dependency bump_
  - `rule` rule line: dependency bumps = build.gradle.kts + libs.versions.toml together; never edit a lock file by hand

## phpmyadmin

- **R01** generated code present (path markers or 'auto-generated' headers) - _generated code in src/Command; editing it by hand is silently overwritten on the next build_
  - `hook` PreToolUse deny Edit/Write under generated dirs
  - `rule` rule line: these paths are generated; change the source and regenerate
- **R03** test framework present with a real corpus - _package.json:test -> yarn node --experimental-vm-modules $(yarn bin jest), jest, phpunit with 494 test files - the agent should run the existing suite, not write a new one_
  - `skill` run-affected-tests skill (composer run phpunit -- --testsuite unit --display-all-issues)
  - `rule` rule line: test command + where tests live
- **R04** CI present - _CI (github-actions, 12 workflows) already encodes the project's definition of green: yarn install --non-interactive; composer run phpunit -- --testsuite unit --display-all-issues; ./bin/internal/check-release-excludes.sh release/phpMyAdmin-${{ matrix.version }}+snapshot-all-langu_
  - `skill` verify skill = the CI commands run locally
  - `rule` rule line: 'done' means the CI commands pass
- **R07** hot-spot directory with many contributors - _libraries/classes changed 12263 times by 53 authors in the sampled history - highest regression risk, no single owner_
  - `doc` architecture note for libraries/classes
  - `agent` reviewer subagent scoped to libraries/classes
- **R08** repeated change shapes (same >=3 files changed together >=3 times) - _8 recurring file-sets in history - a recipe makes the agent touch all of them, not just the obvious one_
  - `skill` change-recipe skill for: composer.lock + phpstan-baseline.neon + psalm-baseline.xml (9x)
- **R09b** secret-looking strings only in tests/fixtures - _6 hits, all in test files - fake keys; without an allowlist a naive scan hook blocks every test edit_
  - `rule` rule line: test fixtures contain fake keys - do not 'fix' or redact them
  - `hook` PreToolUse secret-scan on Write/Edit with a test-path allowlist
- **R13** external system: relational database - _MySQL/MariaDB referenced in manifests/compose_
  - `rule` rule line: schema changes go through the migration tool (MySQL/MariaDB); no ad-hoc SQL
  - `mcp` read-only DB MCP candidate - only if a local/compose DB exists (no compose - skip the MCP)
- **R17** no AI configuration at all - _no CLAUDE.md/AGENTS.md/cursor/copilot - the agent starts from zero facts; the diagnosis provides them_
  - `scaffold` CLAUDE.md from the diagnosis: build=yarn run build   # -> webpack; composer install; test=composer run phpunit -- --testsuite unit --display-all-issues; lint=eslint, phpstan, psalm, .eslintrc.json; layout
- **R20** formatter / linter configured - _eslint, phpstan, psalm, .eslintrc.json configured - style is mechanical; a hook removes it from review_
  - `hook` PostToolUse: run eslint on the edited file
- **R22a** substantial docs (README >= 8 KB or docs/ folder or architecture doc) - _README 1.5 KB, 43 docs files, arch docs: none - the answers exist; the agent must be pointed at them_
  - `rule` rule line: read docs/ before planning
  - `skill` docs-sync skill: a change that alters behaviour updates docs/
- **R24** legacy web stack (PHP + vendored jQuery / Twig) - _PHP (1235 files) with jQuery; hot dirs include resources/po (10834 changes) which is machine-synced_
  - `agent` security reviewer subagent (XSS / SQL injection / CSRF) on every PHP or JS change
  - `rule` rule line: no framework migrations or jQuery removal; smallest change that fits
  - `permission` deny edits under translation dirs (resources/po) - owned by the translation platform
- **R28** large contributor base - _296 authors in the sample - output must look like everyone else's PR to be merged_
  - `skill` contribution-style skill: PR format, commit convention, CONTRIBUTING (CONTRIBUTING.md)
- **R30** lock file churn / dependency-bump shape - _package.json + yarn.lock co-change 23 times - the most frequent change shape in history is a dependency bump_
  - `rule` rule line: dependency bumps = package.json + yarn.lock together; never edit a lock file by hand

## pydatasci-handbook

- **R02** no test framework detected - _no test framework found (0 test-like files) - an agent that 'adds tests' would invent a harness_
  - `scaffold` first-tests scaffold (one smoke test in the native framework)
  - `hook` Stop hook: build/compile gate (no test gate yet)
  - `report` explicitly NOT a test-writer agent: nothing to run it against
- **R05** no CI - _no CI config found - nothing defines green, so a minimal local gate must be created before agents change code_
  - `scaffold` local verify script (build + tests) as the only gate
  - `report` report: no CI - agent output cannot be machine-checked before merge
- **R07** hot-spot directory with many contributors - _notebooks changed 595 times by 13 authors in the sampled history - highest regression risk, no single owner_
  - `doc` architecture note for notebooks
  - `agent` reviewer subagent scoped to notebooks
- **R17** no AI configuration at all - _no CLAUDE.md/AGENTS.md/cursor/copilot - the agent starts from zero facts; the diagnosis provides them_
  - `scaffold` CLAUDE.md from the diagnosis: build=(none inferable); test=-; lint=-; layout
- **R18** Jupyter notebooks - _136 notebooks - a JSON-level edit corrupts them and the diff is unreviewable_
  - `rule` rule line: edit cells with NotebookEdit, never the raw .ipynb JSON; keep outputs as committed
  - `hook` PostToolUse: nbformat validate on any .ipynb write
  - `permission` deny bulk reformatters over notebooks/
- **R21** no formatter / linter - _no lint/format config - a formatter hook would reformat files nobody formatted before_
  - `rule` rule line: match the surrounding style; no reformatting of untouched lines
  - `report` report: no lint config - style drift is not machine-checked

## spring-petclinic

- **R03** test framework present with a real corpus - _junit with 20 test files - the agent should run the existing suite, not write a new one_
  - `skill` run-affected-tests skill (./mvnw -B verify)
  - `rule` rule line: test command + where tests live
- **R04** CI present - _CI (github-actions, 3 workflows) already encodes the project's definition of green: ./gradlew build; ./mvnw -B verify_
  - `skill` verify skill = the CI commands run locally
  - `rule` rule line: 'done' means the CI commands pass
- **R07** hot-spot directory with many contributors - _src/main changed 330 times by 40 authors in the sampled history - highest regression risk, no single owner_
  - `doc` architecture note for src/main
  - `agent` reviewer subagent scoped to src/main
- **R13** external system: relational database - _PostgreSQL, MySQL/MariaDB referenced in manifests/compose_
  - `rule` rule line: schema changes go through the migration tool (PostgreSQL, MySQL/MariaDB); no ad-hoc SQL
  - `mcp` read-only DB MCP candidate - only if a local/compose DB exists (compose present)
- **R17** no AI configuration at all - _no CLAUDE.md/AGENTS.md/cursor/copilot - the agent starts from zero facts; the diagnosis provides them_
  - `scaffold` CLAUDE.md from the diagnosis: build=./mvnw package; ./gradlew build; test=./mvnw -B verify; lint=checkstyle, spring-javaformat, .editorconfig; layout
- **R20** formatter / linter configured - _checkstyle, spring-javaformat, .editorconfig configured - style is mechanical; a hook removes it from review_
  - `hook` PostToolUse: run spring-javaformat on the edited file
- **R22a** substantial docs (README >= 8 KB or docs/ folder or architecture doc) - _README 10.3 KB, 0 docs files, arch docs: none - the answers exist; the agent must be pointed at them_
  - `rule` rule line: read README.md before planning
  - `skill` docs-sync skill: a change that alters behaviour updates README.md
- **R23** devcontainer / Dockerfile / compose - _devcontainer, Dockerfile, compose present - the reproducible environment already exists_
  - `runner` run the agent inside devcontainer, Dockerfile, compose; same toolchain as CI
- **R27** several build systems in one repo - _maven + gradle both present - a dependency added to one and not the other breaks CI on the other_
  - `rule` rule line: keep maven + gradle in sync (23 co-changes in history)
- **R28** large contributor base - _66 authors in the sample - output must look like everyone else's PR to be merged_
  - `skill` contribution-style skill: PR format, commit convention, CONTRIBUTING (no CONTRIBUTING)

## terraform-aws-eks

- **R03** test framework present with a real corpus - _examples/ as integration checks (6) with 20 test files - the agent should run the existing suite, not write a new one_
  - `skill` run-affected-tests skill (examples/ as integration checks (6))
  - `rule` rule line: test command + where tests live
- **R04** CI present - _CI (github-actions, 6 workflows) already encodes the project's definition of green: npm install \_
  - `skill` verify skill = the CI commands run locally
  - `rule` rule line: 'done' means the CI commands pass
- **R08** repeated change shapes (same >=3 files changed together >=3 times) - _2 recurring file-sets in history - a recipe makes the agent touch all of them, not just the obvious one_
  - `skill` change-recipe skill for: README.md + main.tf + variables.tf (5x)
- **R14** cloud SDK / IaC provider present - _AWS SDK referenced - an agent with a shell must not be able to touch live infrastructure_
  - `permission` deny mutating cloud CLI (aws/az/gcloud create|delete|deploy)
  - `rule` rule line: cloud credentials are never in the repo or the agent's env
- **R17** no AI configuration at all - _no CLAUDE.md/AGENTS.md/cursor/copilot - the agent starts from zero facts; the diagnosis provides them_
  - `scaffold` CLAUDE.md from the diagnosis: build=terraform init && terraform validate   # no compile; plan needs cloud creds; test=examples/ as integration checks (6); lint=pre-commit, terraform_fmt, terraform_validate, terraform_docs; layout
- **R19** Terraform - _90 .tf files; pre-commit runs terraform_fmt, terraform_validate, terraform_docs, tflint - README/variables co-change 15 times in history_
  - `hook` PreToolUse: allow terraform fmt/validate/plan; deny apply/destroy/import/state
  - `skill` terraform-docs regen skill (README tables are generated from variables.tf)
  - `rule` rule line: plan is the deliverable; apply is a human's
- **R20** formatter / linter configured - _pre-commit, terraform_fmt, terraform_validate, terraform_docs configured - style is mechanical; a hook removes it from review_
  - `hook` PostToolUse: run terraform_fmt on the edited file
- **R22a** substantial docs (README >= 8 KB or docs/ folder or architecture doc) - _README 95.6 KB, 17 docs files, arch docs: none - the answers exist; the agent must be pointed at them_
  - `rule` rule line: read docs/ before planning
  - `skill` docs-sync skill: a change that alters behaviour updates docs/
- **R28** large contributor base - _58 authors in the sample - output must look like everyone else's PR to be merged_
  - `skill` contribution-style skill: PR format, commit convention, CONTRIBUTING (no CONTRIBUTING)
